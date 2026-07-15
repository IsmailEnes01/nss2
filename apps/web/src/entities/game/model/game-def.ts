// The contract every Lobi game implements. Games are pure and deterministic:
// `init` derives all randomness from the room seed (via the seeded RNG in
// @/shared/lib/seeded-rng), `applyMove` returns the next state or `null` to
// reject, and the lobby relays moves without ever interpreting them — every
// client replays the same move stream in lockstep. Most games are fixed at
// two seats (`meta.minPlayers === meta.maxPlayers === 2`); a game may declare
// a wider range (e.g. 2-16) to seat everyone the host marked "playing".

/** A 0-based seat index — one per active player in the match. Most games
 * only ever see 0 or 1; a variable-player game sees up to `maxPlayers - 1`. */
export type PlayerIndex = number;

export type GameStatus =
  | { kind: "ongoing" }
  | { kind: "won"; winner: PlayerIndex }
  | { kind: "draw" };

/** Catalog card data. `name` and `tagline` are Turkish UI copy; `icon` is a
 * lucide-react icon name or an emoji — games use emoji for zero coupling.
 * `minPlayers`/`maxPlayers` gate the host's "start" button and tell the
 * lobby how many seats to fill (both 2 for a classic two-player game). */
export interface GameMeta {
  id: string;
  name: string;
  icon: string;
  tagline: string;
  minPlayers: number;
  maxPlayers: number;
}

export interface GameDef<S, M> {
  meta: GameMeta;
  /** Turkish label for a seat (e.g. index 0 → "X", or "Oyuncu 3"). */
  playerLabel(index: PlayerIndex): string;
  /** `playerCount` is how many seats this match actually has (between
   * `meta.minPlayers` and `meta.maxPlayers`) — fixed-seat games ignore it. */
  init(seed: number, playerCount: number): S;
  /** Next state, or null when the move is invalid (ignored, never thrown). */
  applyMove(state: S, move: M, player: PlayerIndex): S | null;
  status(state: S): GameStatus;
  /** Whose turn; null when the game is over or moves are simultaneous. */
  turn(state: S): PlayerIndex | null;
}

/** Every board is presentational: render `state`, call `onMove`, honor
 * `canMove` — no sockets, no lobby imports. */
export interface BoardProps<S, M> {
  state: S;
  me: PlayerIndex;
  canMove: boolean;
  onMove(move: M): void;
}
