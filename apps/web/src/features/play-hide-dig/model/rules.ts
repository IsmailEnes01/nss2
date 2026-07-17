// Sakla Kazma (Hide & Dig): each round is one simultaneous-commit window
// over an N×N grid — every still-alive seat secretly picks a tile to hide
// on, and *as soon as it has*, may also secretly pick a tile to dig (no
// need to wait for anyone else to finish hiding first — hide-then-dig is
// only ever a per-player order, never a whole-table phase gate). A single
// countdown covers the whole round: it starts the moment the FIRST hide
// from ANYONE lands, and once it elapses (or literally everyone still alive
// has both hidden and dug, nothing left to wait for) the round resolves
// into a fixed-length reveal — `revealing` holds that round's full result
// for `REVEAL_SECONDS` while every client shows it, then any client's timer
// proposes `advanceRound` to actually deal the next (smaller) grid, or end
// the match if that round's eliminations left 0-1 seats standing. A seat
// that never hid in time is eliminated outright (hiding is mandatory);
// among seats that did hide, one is eliminated only if some OTHER seat dug
// its exact tile — a seat that never dug in time, or only ever dug its own
// tile, pays no penalty. The grid shrinks each round (5×5, 4×4, 3×3, then
// 2×2 forever) until one seat remains (winner) or a round eliminates
// everyone still standing at once (draw).
//
// Unlike every other game here, nothing about this one derives from the
// room seed — there's no hidden target or word to compute, every bit of
// "hidden information" is a live player choice (which tile), so `init`
// simply ignores `seed`. Hidden state that's genuinely player-committed
// rather than seed-derived just... doesn't need a seed; the same trust
// model as everywhere else (don't render it to the wrong viewer) still
// applies, there's just nothing to *derive*.
//
// Both the round countdown and the reveal pause reuse Spektrum Çarkı's
// proven pattern exactly: a client-side clock, and any client may propose
// the matching idempotent move (`resolveRound` / `advanceRound`) once its
// own local deadline passes — the reducer treats each as fully idempotent
// (round-number + "this phase is actually still pending" checks), so it
// never matters whose proposal lands first, and a stale one from an
// already-resolved phase is a harmless no-op. See rules.ts in play-spectrum
// for the original design rationale.
import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_COUNTDOWN_SECONDS = 15;
export const MIN_COUNTDOWN_SECONDS = 5;
export const MAX_COUNTDOWN_SECONDS = 60;

/** How long every client shows a round's reveal (hide/dig markers) before
 * advancing — fixed, not host-configurable. */
export const REVEAL_SECONDS = 5;

/** Round 0 is 5×5, round 1 is 4×4, round 2 is 3×3, every round after that
 * (and forever) is 2×2 — the grid never shrinks below a 2×2 no matter how
 * many rounds a stubborn stalemate drags on for. */
const GRID_SIZE_BY_ROUND: readonly number[] = [5, 4, 3];
const MIN_GRID_SIZE = 2;

// ── Game definition ──────────────────────────────────────────────────────────

export const hideDigGame: GameDef<HideDigState, HideDigMove> = {
  meta: {
    id: "sakla-kazma",
    name: "Sakla Kazma",
    icon: "⛏️",
    tagline: "Bir kareye saklan, rakiplerinkini kaz — kazılan karede saklanan elenir.",
    minPlayers: 2,
    maxPlayers: 12,
    settings: [
      {
        key: "countdownSeconds",
        label: "Sakla/kaz süresi (sn)",
        min: MIN_COUNTDOWN_SECONDS,
        max: MAX_COUNTDOWN_SECONDS,
        default: DEFAULT_COUNTDOWN_SECONDS,
      },
    ],
  },
  playerLabel: (index) => `Oyuncu ${index + 1}`,
  init,
  applyMove,
  status,
  turn,
};

// ── Rules ────────────────────────────────────────────────────────────────────

function init(
  _seed: number,
  playerCount: number,
  settings: Readonly<Record<string, number>> = {},
): HideDigState {
  return {
    playerCount,
    round: 0,
    gridSize: gridSizeForRound(0),
    roundStartEliminated: Array<boolean>(playerCount).fill(false),
    eliminated: Array<boolean>(playerCount).fill(false),
    hides: Array<number | null>(playerCount).fill(null),
    digs: Array<number | null>(playerCount).fill(null),
    revealing: null,
    countdownSeconds: clampCountdown(settings.countdownSeconds),
    history: [],
  };
}

function applyMove(
  state: HideDigState,
  move: HideDigMove,
  player: PlayerIndex,
): HideDigState | null {
  if (isAdvanceRoundMove(move)) {
    if (state.revealing === null) return null;
    if (move.round !== state.revealing.round) return null; // stale timer, harmless no-op
    return advanceAfterReveal(state);
  }

  // Nothing else is legal while a round's result is being shown — the next
  // round hasn't been dealt yet (see `advanceAfterReveal`).
  if (state.revealing !== null) return null;
  if (state.eliminated[player]) return null; // out for the rest of the match

  if (isHideMove(move)) {
    if (state.hides[player] !== null) return null; // one hide per round
    if (!isValidTile(move.tile, state.gridSize)) return null;
    const hides = replaceAt(state.hides, player, move.tile);
    const settled = { ...state, hides };
    return everyoneFullyActed(settled) ? resolveRound(settled) : settled;
  }

  if (isDigMove(move)) {
    if (state.hides[player] === null) return null; // must hide before you can dig
    if (state.digs[player] !== null) return null; // one dig per round
    if (!isValidTile(move.tile, state.gridSize)) return null;
    const digs = replaceAt(state.digs, player, move.tile);
    const settled = { ...state, digs };
    return everyoneFullyActed(settled) ? resolveRound(settled) : settled;
  }

  if (isResolveRoundMove(move)) {
    if (move.round !== state.round) return null;
    if (!state.hides.some((tile) => tile !== null)) return null; // no countdown was ever running
    return resolveRound(state);
  }

  return null;
}

function status(state: HideDigState): GameStatus {
  const remaining = seatsWhere(state.playerCount, (seat) => !state.eliminated[seat]);
  if (remaining.length === 0) return { kind: "draw" };
  if (remaining.length === 1) return { kind: "won", winner: remaining[0] };
  return { kind: "ongoing" };
}

/** Both hiding and digging are simultaneous commits, same as Rock-Paper-
 * Scissors or Spektrum Çarkı's guess phase — nobody has an exclusive
 * "turn". */
function turn(_state: HideDigState): PlayerIndex | null {
  return null;
}

// ── Round resolution ─────────────────────────────────────────────────────────

/** Every non-eliminated seat has done everything it can do this round — no
 * point waiting out the rest of the countdown. */
function everyoneFullyActed(state: HideDigState): boolean {
  return state.eliminated.every(
    (out, seat) => out || (state.hides[seat] !== null && state.digs[seat] !== null),
  );
}

/** Closes the round in one pass: a seat that never hid in time is
 * eliminated outright (hiding is mandatory); among seats that did hide, one
 * is eliminated only if some OTHER seat dug the exact tile it hid on —
 * digging your own hidden tile never counts against you, per the rules
 * ("at least one OTHER player"). Whoever never dug in time simply
 * contributed nothing; no penalty. Doesn't deal the next round yet — that
 * waits for the reveal to actually be shown (`advanceAfterReveal`). */
function resolveRound(state: HideDigState): HideDigState {
  const eliminated = state.eliminated.map((out, seat) => {
    if (out) return true;
    const tile = state.hides[seat];
    if (tile === null) return true; // never hid in time
    return state.digs.some((digTile, digSeat) => digSeat !== seat && digTile === tile);
  });
  const eliminatedThisRound = seatsWhere(
    state.playerCount,
    (seat) => !state.roundStartEliminated[seat] && eliminated[seat],
  );
  const result: HideDigRoundResult = {
    round: state.round,
    gridSize: state.gridSize,
    hides: state.hides,
    digs: state.digs,
    eliminated: eliminatedThisRound,
  };
  return { ...state, eliminated, history: [...state.history, result], revealing: result };
}

/** Once the reveal's been shown, either ends the match (0-1 seats left —
 * `status` already reflects that from `resolveRound`'s `eliminated`, there's
 * simply nothing left to deal) or opens a fresh, smaller-grid round for
 * whoever remains. */
function advanceAfterReveal(state: HideDigState): HideDigState {
  const cleared: HideDigState = { ...state, revealing: null };
  const remaining = seatsWhere(state.playerCount, (seat) => !state.eliminated[seat]);
  if (remaining.length <= 1) return cleared;

  const nextRound = state.round + 1;
  return {
    ...cleared,
    round: nextRound,
    gridSize: gridSizeForRound(nextRound),
    roundStartEliminated: state.eliminated,
    hides: Array<number | null>(state.playerCount).fill(null),
    digs: Array<number | null>(state.playerCount).fill(null),
  };
}

// ── Helpers (shared with the board) ─────────────────────────────────────────

export function gridSizeForRound(round: number): number {
  return GRID_SIZE_BY_ROUND[round] ?? MIN_GRID_SIZE;
}

export function isValidTile(tile: number, gridSize: number): boolean {
  return Number.isInteger(tile) && tile >= 0 && tile < gridSize * gridSize;
}

function seatsWhere(
  playerCount: number,
  predicate: (seat: PlayerIndex) => boolean,
): PlayerIndex[] {
  const seats: PlayerIndex[] = [];
  for (let seat = 0; seat < playerCount; seat += 1) {
    if (predicate(seat)) seats.push(seat);
  }
  return seats;
}

function replaceAt<T>(values: readonly T[], index: number, value: T): readonly T[] {
  return values.map((existing, i) => (i === index ? value : existing));
}

/** Same clamp-and-fall-back-to-default treatment every settings value gets
 * regardless of where it came from — see Spektrum Çarkı's identical
 * `clampCountdown` for why. */
function clampCountdown(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_COUNTDOWN_SECONDS;
  }
  return Math.min(
    MAX_COUNTDOWN_SECONDS,
    Math.max(MIN_COUNTDOWN_SECONDS, Math.round(value)),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHideMove(move: HideDigMove): move is { t: "hide"; tile: number } {
  return isRecord(move) && move.t === "hide" && typeof move.tile === "number";
}

function isDigMove(move: HideDigMove): move is { t: "dig"; tile: number } {
  return isRecord(move) && move.t === "dig" && typeof move.tile === "number";
}

function isResolveRoundMove(
  move: HideDigMove,
): move is { t: "resolveRound"; round: number } {
  return (
    isRecord(move) && move.t === "resolveRound" && typeof move.round === "number"
  );
}

function isAdvanceRoundMove(
  move: HideDigMove,
): move is { t: "advanceRound"; round: number } {
  return (
    isRecord(move) && move.t === "advanceRound" && typeof move.round === "number"
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface HideDigRoundResult {
  round: number;
  gridSize: number;
  /** This round's hide picks, indexed by seat — null for a seat that never
   * hid in time (eliminated for it) or was already out before the round
   * began. */
  hides: readonly (number | null)[];
  /** This round's dig picks, indexed by seat — null for a seat that never
   * dug (no penalty either way). */
  digs: readonly (number | null)[];
  /** Seats newly eliminated this round. */
  eliminated: readonly PlayerIndex[];
}

export interface HideDigState {
  playerCount: number;
  /** 0-based. Grid size follows `gridSizeForRound(round)`. Stays pointed at
   * the just-finished round for the whole reveal window — only
   * `advanceAfterReveal` moves it forward. */
  round: number;
  gridSize: number;
  /** A snapshot of `eliminated` taken at the moment the current round
   * began — `resolveRound` diffs against this to know exactly who this
   * round (as opposed to some earlier one) took out. */
  roundStartEliminated: readonly boolean[];
  /** True once a seat is out for the rest of the match — set once, never
   * cleared. */
  eliminated: readonly boolean[];
  /** This round's hide picks so far, indexed by seat — null until that seat
   * commits one. Never rendered to anyone but the seat itself until the
   * round resolves. Reset every new round; frozen (not reset) during the
   * reveal window so the board can still read the round that just ended. */
  hides: readonly (number | null)[];
  /** This round's dig picks so far, indexed by seat — null until that seat
   * commits one (or forever, if they never do). A seat may only dig once
   * its own `hides` entry is set — hide-then-dig is a per-player order, not
   * a whole-table phase gate. Reset every new round (see `hides`). */
  digs: readonly (number | null)[];
  /** Non-null for exactly `REVEAL_SECONDS` (client-clocked) right after a
   * round resolves — while set, hide/dig/resolveRound are all rejected, the
   * only legal move is `advanceRound`. Equal to `history[history.length -
   * 1]` whenever set, kept alongside it purely so the board doesn't have to
   * infer "are we mid-reveal" from history length. */
  revealing: HideDigRoundResult | null;
  /** Seconds after the round's first hide (from anyone) before it
   * auto-resolves — fixed for the whole match from the host's chosen
   * setting at init. Purely informational for the board's own countdown;
   * the reducer itself never checks wall-clock time (see `resolveRound`). */
  countdownSeconds: number;
  /** Settled rounds so far, oldest first — includes the currently-revealing
   * one, if any. */
  history: readonly HideDigRoundResult[];
}

/** A still-alive seat secretly picks a tile to hide on — once per round. */
export type HideDigMove =
  | { t: "hide"; tile: number }
  /** A still-alive seat secretly picks a tile to dig — once per round, only
   * once that same seat has already hidden (no need to wait for anyone
   * else). */
  | { t: "dig"; tile: number }
  /** Proposed by any client once its own local countdown — started the
   * moment the round's first hide (from anyone) landed — reaches zero.
   * Carries the round it was scheduled for so a timer that fires after the
   * round already resolved some other way is a harmless no-op. */
  | { t: "resolveRound"; round: number }
  /** Proposed by any client once its own local `REVEAL_SECONDS` reveal
   * timer elapses. Carries the round it was scheduled for (matching
   * `revealing.round`) so a stale proposal — from a reveal that's already
   * been advanced past — is a harmless no-op. */
  | { t: "advanceRound"; round: number };
