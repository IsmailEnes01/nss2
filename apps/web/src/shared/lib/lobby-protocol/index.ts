// Wire schema between the lobby client and the LobbyRoom Durable Object.
// Joining is implicit in the WebSocket URL (/lobi/:code?name=…), so no join
// message exists; these are the messages exchanged AFTER the connection.
// A room holds up to 16 members. Each is either "playing" or "spectator";
// among the playing members, stable roster order assigns seats 0..N-1 when
// the host starts the match — most games fix N at 2, some allow more. The
// room itself no longer picks a game up front: the host arranges roles AND
// picks the game (`select-game`) from inside the room, then explicitly
// starts the match once one is chosen.
// Parse-don't-cast: both sides run every inbound message through these
// parsers — ill-typed messages come back null (dropped, never thrown) and
// unknown extra fields are stripped so only the declared shape crosses over.

// ── Parsers ───────────────────────────────────────────────────────────────────

export function parseClientMessage(value: unknown): ClientMessage | null {
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "move":
      return "payload" in value ? { t: "move", payload: value.payload } : null;
    case "assign-role": {
      const memberId = value.memberId;
      const role = parseRole(value.role);
      return typeof memberId === "string" && role !== null
        ? { t: "assign-role", memberId, role }
        : null;
    }
    case "randomize-roles":
      return isSeatCount(value.maxPlaying)
        ? { t: "randomize-roles", maxPlaying: value.maxPlaying }
        : null;
    case "select-game": {
      const gameId = value.gameId;
      if (gameId === null) return { t: "select-game", gameId: null };
      return typeof gameId === "string" && gameId !== ""
        ? { t: "select-game", gameId }
        : null;
    }
    case "start-match":
      return { t: "start-match" };
    case "rematch":
      return { t: "rematch" };
    case "chat": {
      const text = value.text;
      if (typeof text !== "string") return null;
      const trimmed = text.trim().slice(0, CHAT_MAX_LENGTH);
      return trimmed === "" ? null : { t: "chat", text: trimmed };
    }
    case "leave":
      return { t: "leave" };
    default:
      return null;
  }
}

export function parseServerMessage(value: unknown): ServerMessage | null {
  if (!isRecord(value)) return null;
  switch (value.t) {
    case "roster": {
      const members = parseRosterMembers(value.members);
      const youId = value.youId;
      const gameId = value.gameId;
      if (members === null || typeof youId !== "string") return null;
      if (gameId !== null && typeof gameId !== "string") return null;
      return { t: "roster", members, youId, gameId: gameId ?? null };
    }
    case "start": {
      const names = parseNameList(value.names);
      const you = value.you;
      const gameId = value.gameId;
      if (!isSeed(value.seed) || names === null) return null;
      if (you !== null && !isSeatIndex(you)) return null;
      if (typeof gameId !== "string" || gameId === "") return null;
      return { t: "start", seed: value.seed, names, you, gameId };
    }
    case "peer-move": {
      const from = value.from;
      if (!isSeatIndex(from)) return null;
      return "payload" in value
        ? { t: "peer-move", payload: value.payload, from }
        : null;
    }
    case "rematch-start":
      return isSeed(value.seed)
        ? { t: "rematch-start", seed: value.seed }
        : null;
    case "peer-left":
      return { t: "peer-left" };
    case "chat": {
      const from = value.from;
      const fromName = value.fromName;
      const text = value.text;
      const ts = value.ts;
      if (typeof from !== "string" || typeof fromName !== "string") {
        return null;
      }
      if (typeof text !== "string" || text === "") return null;
      if (typeof ts !== "number" || !Number.isFinite(ts)) return null;
      return { t: "chat", from, fromName, text, ts };
    }
    case "error":
      return isErrorReason(value.reason)
        ? { t: "error", reason: value.reason }
        : null;
    default:
      return null;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSeed(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** A non-negative seat index (0, 1, 2, …). */
function isSeatIndex(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** A positive seat count — how many members `randomize-roles` should seat. */
function isSeatCount(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1;
}

/** At least two named seats — a match always has 2+ active players. */
function parseNameList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  return value.every((name) => typeof name === "string")
    ? (value as string[])
    : null;
}

function parseRole(value: unknown): Role | null {
  return value === "playing" || value === "spectator" ? value : null;
}

function parseRosterMembers(value: unknown): RosterMember[] | null {
  if (!Array.isArray(value)) return null;
  const members: RosterMember[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const role = parseRole(item.role);
    if (
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      role === null ||
      typeof item.isHost !== "boolean"
    ) {
      return null;
    }
    members.push({ id: item.id, name: item.name, role, isHost: item.isHost });
  }
  return members;
}

function isErrorReason(value: unknown): value is LobbyErrorReason {
  return value === "not-found" || value === "full" || value === "name-required";
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A joined connection's seat: "playing" members fill seats 0..N-1 in stable
 * roster order when the host starts the match; everyone else spectates. */
export type Role = "playing" | "spectator";

/** One row of the pre-game roster the host arranges. */
export interface RosterMember {
  id: string;
  name: string;
  role: Role;
  isHost: boolean;
}

/** Client → Durable Object (join happens via the URL, not a message). */
export type ClientMessage =
  | { t: "move"; payload: unknown }
  | { t: "assign-role"; memberId: string; role: Role }
  /** `maxPlaying` is the game's `meta.maxPlayers` — the DO is game-agnostic
   * and doesn't know it, so the client (which holds the GameDef) supplies it. */
  | { t: "randomize-roles"; maxPlaying: number }
  /** Host-only: picks (or replaces) the game to play from the client-side
   * catalog — the DO just stores the id it's given. `null` clears the pick,
   * sending everyone back to the game-select screen. */
  | { t: "select-game"; gameId: string | null }
  | { t: "start-match" }
  | { t: "rematch" }
  /** Free-text room chat — allowed from anyone, in any phase; the DO just
   * relays it, same as a peer move. Trimmed and capped at
   * `CHAT_MAX_LENGTH` client-side (and re-validated on the way back). */
  | { t: "chat"; text: string }
  | { t: "leave" };

/** Durable Object → client. */
export type ServerMessage =
  | {
      t: "roster";
      members: RosterMember[];
      youId: string;
      /** The host's current pick, or null before anyone has chosen one. */
      gameId: string | null;
    }
  | {
      t: "start";
      seed: number;
      /** One name per active seat, in seat order. */
      names: string[];
      /** This connection's own seat, or null when spectating. */
      you: number | null;
      gameId: string;
    }
  | { t: "peer-move"; payload: unknown; from: number }
  | { t: "rematch-start"; seed: number }
  | { t: "peer-left" }
  /** Relayed to everyone, including the sender — every client renders chat
   * from this single stream rather than echoing its own text locally. */
  | { t: "chat"; from: string; fromName: string; text: string; ts: number }
  | { t: "error"; reason: LobbyErrorReason };

export type LobbyErrorReason = "not-found" | "full" | "name-required";

/** Longest chat message accepted — enforced by the client parser (trims and
 * slices) and re-checked wherever text length might matter downstream. */
export const CHAT_MAX_LENGTH = 300;
