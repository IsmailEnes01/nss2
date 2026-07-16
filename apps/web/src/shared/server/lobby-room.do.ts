import { DurableObject } from "cloudflare:workers";
import { isValidLobbyCode } from "@/shared/lib/lobby-code";
import {
  type LobbyErrorReason,
  parseClientMessage,
  type Role,
  type RosterMember,
  type ServerMessage,
} from "@/shared/lib/lobby-protocol";

/** What each socket's hibernation attachment carries: its own roster row,
 * the room-level game pick (mirrored onto every socket so any one of them
 * can rebuild `this.gameId` after a wake-up), and — once a match has
 * started — this socket's own assigned seat. The seat MUST be persisted
 * rather than recomputed, because `ctx.getWebSockets()` is not guaranteed
 * to return sockets in original join order after a hibernation wake-up; a
 * live index recompute would silently reassign the wrong seat to the wrong
 * socket and every move it sends afterward would look like it came from
 * someone else. */
interface RoomAttachment {
  member: RosterMember;
  gameId: string | null;
  seat: number | null;
}

// Game-agnostic relay room — one instance per lobby code (idFromName). Uses
// the WebSocket Hibernation API: every member, the room's current game pick,
// and (once a match is live) the member's own seat are all mirrored into its
// socket's attachment, so the constructor can rebuild `this.members`,
// `this.gameId`, and `this.seats` after a wake-up.
// Up to MAX_MEMBERS people can join a room; each is "playing" or "spectator".
// A member's seat (0..N-1) is assigned once, by `startMatch`, in stable
// roster order — and persisted, not recomputed, because `ctx.getWebSockets()`
// doesn't promise original join order survives hibernation (see
// `RoomAttachment`). The host arranges roles AND picks the game from inside
// the room, then explicitly starts the match — the room never auto-starts on
// a second join, and never starts before a game is chosen. The room never
// interprets moves; every client runs the same pure reducer over the relayed
// stream, seeded by the number broadcast in `start`. The DO doesn't know any
// game's min/max player count (that lives in the client-side GameDef) —
// `randomize-roles` carries the cap it should respect, and `start-match` only
// requires a game to be chosen and two or more playing members. `chat` is the
// one message that ignores phase and host status entirely — it's just
// relayed to everyone, same as a move, and never stored (no history survives
// a hibernation wake-up).
export class LobbyRoom extends DurableObject<Env> {
  /** Live sockets → members; restored from attachments after hibernation. */
  private members = new Map<WebSocket, RosterMember>();
  /** Live sockets → assigned seat, for members who are part of a started
   * match. Set once by `startMatch` (never recomputed from roster order —
   * see `RoomAttachment`) and restored from attachments after hibernation. */
  private seats = new Map<WebSocket, number>();
  /** The host's current game pick — null until `select-game`. Room-level, so
   * it's mirrored into every member's attachment rather than one seat. */
  private gameId: string | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    for (const ws of ctx.getWebSockets()) {
      const attachment = ws.deserializeAttachment() as RoomAttachment | null;
      if (attachment === null) continue;
      this.members.set(ws, attachment.member);
      this.gameId = attachment.gameId;
      if (attachment.seat !== null && attachment.seat !== undefined) {
        this.seats.set(ws, attachment.seat);
      }
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
      return new Response("WebSocket bekleniyor", { status: 426 });
    }

    const url = new URL(request.url);
    const name = url.searchParams.get("name")?.trim() ?? "";
    const joinOnly = url.searchParams.get("join") === "1";

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];

    if (name === "") return rejectSocket(client, server, "name-required");
    if (this.members.size >= MAX_MEMBERS) {
      return rejectSocket(client, server, "full");
    }
    if (this.members.size === 0 && joinOnly) {
      // Strict-join connect to a room whose host is gone (or never existed):
      // refuse instead of silently resurrecting the lobby as its host.
      return rejectSocket(client, server, "not-found");
    }

    const isHost = this.members.size === 0;
    const member: RosterMember = {
      id: crypto.randomUUID(),
      name,
      role: isHost ? "playing" : "spectator",
      isHost,
    };
    this.ctx.acceptWebSocket(server);
    this.members.set(server, member);
    this.persist(server, member);
    this.broadcastRoster();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(
    ws: WebSocket,
    raw: string | ArrayBuffer,
  ): Promise<void> {
    if (typeof raw !== "string") return;
    const self = this.members.get(ws);
    if (self === undefined) return;
    const message = parseClientMessage(parseJson(raw));
    if (message === null) return;

    switch (message.t) {
      case "move": {
        const seat = this.seatOf(ws);
        if (seat === null) return; // spectators can't move
        this.relayMove(ws, seat, message.payload);
        break;
      }
      case "assign-role":
        if (self.isHost) this.assignRole(message.memberId, message.role);
        break;
      case "randomize-roles":
        if (self.isHost) this.randomizeRoles(message.maxPlaying);
        break;
      case "select-game":
        if (self.isHost) this.selectGame(message.gameId);
        break;
      case "start-match":
        if (self.isHost) this.startMatch(message.settings);
        break;
      case "rematch":
        if (this.playingCount() >= 2) {
          this.broadcast({ t: "rematch-start", seed: randomSeed() });
        }
        break;
      case "chat":
        // No host check, no phase check — anyone can chat, any time; the
        // parser already dropped empty/oversized text before this ran.
        this.broadcast({
          t: "chat",
          from: self.id,
          fromName: self.name,
          text: message.text,
          ts: Date.now(),
        });
        break;
      case "leave":
        this.dropMember(ws);
        ws.close(1000, "leave");
        break;
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.dropMember(ws);
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.dropMember(ws);
  }

  /** Host-only: no exclusivity to enforce — "playing" just means "in the
   * lineup", so any number of members can hold it at once. */
  private assignRole(memberId: string, role: Role): void {
    const target = this.findById(memberId);
    if (target === undefined) return;
    this.setRole(target[0], target[1], role);
    this.broadcastRoster();
  }

  /** Host-only: shuffles everyone, seats up to `maxPlaying` of them (the
   * game's `meta.maxPlayers`, supplied by the client), benches the rest. */
  private randomizeRoles(maxPlaying: number): void {
    const shuffled = shuffle([...this.members]);
    const playing = Math.min(shuffled.length, maxPlaying);
    shuffled.forEach(([ws, member], i) => {
      this.setRole(ws, member, i < playing ? "playing" : "spectator");
    });
    this.broadcastRoster();
  }

  /** Host-only: replaces (or, with `null`, clears) the room's game pick and
   * re-broadcasts the roster so everyone's picker/start-button state stays
   * in sync — clearing sends the whole room back to the game-select screen. */
  private selectGame(gameId: string | null): void {
    this.gameId = gameId;
    for (const [ws, member] of this.members) this.persist(ws, member);
    this.broadcastRoster();
  }

  /** Host-only: requires a chosen game and two or more playing members;
   * ignored otherwise (the client only shows the button once both hold).
   * Seats are assigned 0..N-1 in stable roster order — and, unlike before,
   * that assignment is persisted into each socket's attachment right here,
   * so a later hibernation wake-up can't reshuffle it (see `RoomAttachment`,
   * `seatOf`). `settings` is the host's chosen `GameSettingField` values —
   * opaque to the room, just relayed onward so every client's `game.init`
   * sees the same values. */
  private startMatch(settings: Record<string, number>): void {
    const gameId = this.gameId;
    if (gameId === null) return;
    const playing = [...this.members].filter(([, m]) => m.role === "playing");
    if (playing.length < 2) return;
    const seed = randomSeed();
    const names = playing.map(([, member]) => member.name);
    this.seats.clear();
    playing.forEach(([ws, member], seat) => {
      this.seats.set(ws, seat);
      this.persist(ws, member);
      send(ws, { t: "start", seed, names, you: seat, gameId, settings });
    });
    for (const [ws, member] of this.members) {
      if (member.role !== "playing") {
        send(ws, { t: "start", seed, names, you: null, gameId, settings });
      }
    }
  }

  private relayMove(from: WebSocket, fromSeat: number, payload: unknown): void {
    for (const ws of this.members.keys()) {
      if (ws !== from) send(ws, { t: "peer-move", payload, from: fromSeat });
    }
  }

  private broadcastRoster(): void {
    const roster = [...this.members.values()];
    for (const [ws, member] of this.members) {
      send(ws, {
        t: "roster",
        members: roster,
        youId: member.id,
        gameId: this.gameId,
      });
    }
  }

  private broadcast(message: ServerMessage): void {
    for (const ws of this.members.keys()) {
      send(ws, message);
    }
  }

  private dropMember(ws: WebSocket): void {
    const member = this.members.get(ws);
    if (member === undefined) return; // an explicit leave already ran
    this.members.delete(ws);
    this.seats.delete(ws);
    if (member.isHost) this.promoteNextHost();
    // A departed playing member only matters once a match is live; the
    // client's reducer ignores peer-left outside the "playing" phase, so
    // it's always safe to send — the roster broadcast is what actually frees
    // the seat for the host to reassign before a match has started.
    if (member.role === "playing") {
      this.broadcast({ t: "peer-left" });
    }
    this.broadcastRoster();
  }

  /** The oldest remaining member takes over host duties. */
  private promoteNextHost(): void {
    const next = this.members.entries().next().value as
      | [WebSocket, RosterMember]
      | undefined;
    if (next === undefined) return;
    this.setHost(next[0], next[1]);
  }

  private findById(id: string): [WebSocket, RosterMember] | undefined {
    for (const entry of this.members) {
      if (entry[1].id === id) return entry;
    }
    return undefined;
  }

  /** This member's assigned seat, or null when spectating (or before any
   * match has started). Read from `this.seats` — set once by `startMatch`
   * and persisted into the attachment — rather than recomputed from live
   * roster order: `ctx.getWebSockets()` doesn't promise original join order
   * survives a hibernation wake-up, and a recompute here would silently mis-
   * tag every move from a reshuffled socket as coming from the wrong seat. */
  private seatOf(ws: WebSocket): number | null {
    return this.seats.get(ws) ?? null;
  }

  private playingCount(): number {
    let count = 0;
    for (const member of this.members.values()) {
      if (member.role === "playing") count += 1;
    }
    return count;
  }

  private setRole(ws: WebSocket, member: RosterMember, role: Role): void {
    member.role = role;
    this.persist(ws, member);
  }

  private setHost(ws: WebSocket, member: RosterMember): void {
    member.isHost = true;
    this.persist(ws, member);
  }

  /** Mirrors this member, the room's current game pick, and (once assigned)
   * this socket's seat into its attachment — all three must survive a
   * hibernation wake-up. */
  private persist(ws: WebSocket, member: RosterMember): void {
    const attachment: RoomAttachment = {
      member,
      gameId: this.gameId,
      seat: this.seats.get(ws) ?? null,
    };
    ws.serializeAttachment(attachment);
  }
}

// ── Worker-entry routing ──────────────────────────────────────────────────────

/** Routes a `/lobi/:code` WebSocket upgrade to that code's room instance. */
export async function handleLobbyUpgrade(
  request: Request,
  env: Env,
  code: string,
): Promise<Response> {
  const normalized = code.toUpperCase();
  if (!isValidLobbyCode(normalized)) {
    return new Response("Lobi bulunamadı", { status: 404 });
  }
  const stub = env.LOBBY_ROOM.get(env.LOBBY_ROOM.idFromName(normalized));
  return stub.fetch(request);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Accepts the pair just long enough to explain the rejection, then closes. */
function rejectSocket(
  client: WebSocket,
  server: WebSocket,
  reason: LobbyErrorReason,
): Response {
  server.accept();
  send(server, { t: "error", reason });
  server.close(1008, reason);
  return new Response(null, { status: 101, webSocket: client });
}

function send(ws: WebSocket, message: ServerMessage): void {
  try {
    ws.send(JSON.stringify(message));
  } catch {
    // Socket already closing — its close handler reaps the member.
  }
}

function randomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Fisher–Yates over crypto randomness — used for the "distribute randomly"
 * host action, never for game state. */
function shuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = pickIndex(i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function pickIndex(exclusiveMax: number): number {
  return crypto.getRandomValues(new Uint32Array(1))[0] % exclusiveMax;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** 1 host + 15 joiners. */
const MAX_MEMBERS = 16;
