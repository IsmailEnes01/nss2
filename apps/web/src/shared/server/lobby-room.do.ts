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
 * plus the room-level game pick (mirrored onto every socket so any one of
 * them can rebuild `this.gameId` after a wake-up). */
interface RoomAttachment {
  member: RosterMember;
  gameId: string | null;
}

// Game-agnostic relay room — one instance per lobby code (idFromName). Uses
// the WebSocket Hibernation API: every member (plus the room's current game
// pick) is mirrored into its socket's attachment so the constructor can
// rebuild both `this.members` and `this.gameId` after a wake-up.
// Up to MAX_MEMBERS people can join a room; each is "playing" or "spectator".
// A member's seat (0..N-1) is never stored — it's always the member's index
// among "playing" members in stable roster order, recomputed on demand, so
// the room needs no extra bookkeeping when roles change. The host arranges
// roles AND picks the game from inside the room, then explicitly starts the
// match — the room never auto-starts on a second join, and never starts
// before a game is chosen. The room never interprets moves; every client
// runs the same pure reducer over the relayed stream, seeded by the number
// broadcast in `start`. The DO doesn't know any game's min/max player count
// (that lives in the client-side GameDef) — `randomize-roles` carries the
// cap it should respect, and `start-match` only requires a game to be chosen
// and two or more playing members. `chat` is the one message that ignores
// phase and host status entirely — it's just relayed to everyone, same as a
// move, and never stored (no history survives a hibernation wake-up).
export class LobbyRoom extends DurableObject<Env> {
  /** Live sockets → members; restored from attachments after hibernation. */
  private members = new Map<WebSocket, RosterMember>();
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
        if (self.isHost) this.startMatch();
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
   * Seats are assigned 0..N-1 in stable roster order. */
  private startMatch(): void {
    const gameId = this.gameId;
    if (gameId === null) return;
    const playing = [...this.members].filter(([, m]) => m.role === "playing");
    if (playing.length < 2) return;
    const seed = randomSeed();
    const names = playing.map(([, member]) => member.name);
    playing.forEach(([ws], seat) => {
      send(ws, { t: "start", seed, names, you: seat, gameId });
    });
    for (const [ws, member] of this.members) {
      if (member.role !== "playing") {
        send(ws, { t: "start", seed, names, you: null, gameId });
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

  /** This member's 0-based index among "playing" members in stable roster
   * order, or null when spectating. Recomputed on demand — cheap at
   * MAX_MEMBERS scale, and needs no extra state to survive hibernation. */
  private seatOf(ws: WebSocket): number | null {
    let seat = 0;
    for (const [candidate, member] of this.members) {
      if (member.role !== "playing") continue;
      if (candidate === ws) return seat;
      seat += 1;
    }
    return null;
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

  /** Mirrors this member plus the room's current game pick into the socket's
   * attachment — both must survive a hibernation wake-up. */
  private persist(ws: WebSocket, member: RosterMember): void {
    const attachment: RoomAttachment = { member, gameId: this.gameId };
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
