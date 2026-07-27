// Kapmaca — a unique-pick (minority) game. There are exactly as many pots as
// players, worth 1, 2, 3 … N points, and every round every seat secretly
// claims one. When the round resolves, a pot claimed by exactly ONE seat pays
// that seat its full value; a pot two or more seats went for pays nobody. So
// the fat pots are the obvious play and therefore the crowded one — the whole
// game is guessing which value everyone else is guessing.
//
// Each round is one countdown window, then a fixed-length reveal:
//   · picking — everyone claims a pot, seeing nothing but their own claim.
//     The round resolves the moment every seat has claimed (nothing left to
//     wait for) or when the host's countdown elapses, whichever lands first.
//     A seat that never claimed simply scores 0 for the round — no penalty
//     beyond the missed points.
//   · revealing — the round's full result sits on screen for REVEAL_SECONDS
//     so everyone can see who collided with whom, then the next round deals.
//
// Both timed transitions use the house pattern: any client's own clock
// proposes the move (`resolveRound` / `advanceRound`) and the reducer accepts
// it idempotently — a round-number check plus "that transition is actually
// pending" — so it never matters whose proposal arrives first, and stale ones
// from an already-resolved phase are harmless no-ops. There is no randomness
// in this game at all, so `init` ignores the room seed entirely.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_ROUNDS = 5;
export const MIN_ROUNDS = 1;
export const MAX_ROUNDS = 20;

export const DEFAULT_COUNTDOWN_SECONDS = 15;
export const MIN_COUNTDOWN_SECONDS = 5;
export const MAX_COUNTDOWN_SECONDS = 60;

/** How long every client shows a resolved round before proposing the next. */
export const REVEAL_SECONDS = 5;

// ── Game definition ──────────────────────────────────────────────────────────

export const kapmacaGame: GameDef<KapmacaState, KapmacaMove> = {
  meta: {
    id: "kapmaca",
    name: "Kapmaca",
    icon: "🍯",
    tagline:
      "Bir kabı kap — ama aynı kaba uzanan iki el olursa ikisi de boş kalır.",
    minPlayers: 2,
    maxPlayers: 16,
    settings: [
      {
        key: "rounds",
        label: "Tur sayısı",
        min: MIN_ROUNDS,
        max: MAX_ROUNDS,
        default: DEFAULT_ROUNDS,
      },
      {
        key: "countdownSeconds",
        label: "Tur süresi (sn)",
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

/** One pot per seat, so `potCount` is just `playerCount` — kept as its own
 * field anyway, because every pot-value calculation reads better against
 * "how many pots" than against "how many people". Settings are re-clamped
 * here even though the settings screen already clamped them: never trust a
 * number that crossed the wire. */
function init(
  _seed: number,
  playerCount: number,
  settings: Readonly<Record<string, number>> = {},
): KapmacaState {
  return {
    playerCount,
    potCount: playerCount,
    totalRounds: clamp(settings.rounds, MIN_ROUNDS, MAX_ROUNDS, DEFAULT_ROUNDS),
    countdownSeconds: clamp(
      settings.countdownSeconds,
      MIN_COUNTDOWN_SECONDS,
      MAX_COUNTDOWN_SECONDS,
      DEFAULT_COUNTDOWN_SECONDS,
    ),
    round: 0,
    picks: Array(playerCount).fill(null),
    scores: Array(playerCount).fill(0),
    revealing: null,
    history: [],
  };
}

function applyMove(
  state: KapmacaState,
  move: KapmacaMove,
  player: PlayerIndex,
): KapmacaState | null {
  // Leaving a reveal is the only legal move while one is on screen.
  if (isAdvanceRoundMove(move)) {
    if (state.revealing === null) return null;
    if (move.round !== state.revealing.round) return null;
    return advanceAfterReveal(state);
  }
  if (state.revealing !== null) return null;
  if (isFinished(state)) return null;

  if (isPickMove(move)) {
    if (!isSeat(player, state.playerCount)) return null;
    // One claim per round: a locked pick is what makes the countdown mean
    // something. Re-picking would also fight the "everyone claimed → resolve
    // now" shortcut, since the last claimer would silently freeze everyone.
    if (state.picks[player] !== null) return null;
    if (!isValidPot(move.pot, state.potCount)) return null;
    const settled = { ...state, picks: replaceAt(state.picks, player, move.pot) };
    return everyoneClaimed(settled) ? resolveRound(settled) : settled;
  }

  if (isResolveRoundMove(move)) {
    // Scoped to the round it was proposed for, so a countdown that fired
    // just as the round resolved on its own can't skip the next one.
    if (move.round !== state.round) return null;
    return resolveRound(state);
  }

  return null;
}

/** The match ends after the configured number of rounds. Top score takes it,
 * and several seats tied at the top genuinely share the win — that's a `won`
 * with more than one holder, not a draw. Only a table where *everybody* tied
 * (including the all-clash, all-zero case) is a real draw, since then nobody
 * outplayed anybody. */
function status(state: KapmacaState): GameStatus {
  if (!isFinished(state)) return { kind: "ongoing" };
  const top = leaders(state);
  return top.length === state.playerCount
    ? { kind: "draw" }
    : { kind: "won", winners: top };
}

/** Always simultaneous — no seat ever "has the turn". */
function turn(_state: KapmacaState): PlayerIndex | null {
  return null;
}

// ── Round transitions ────────────────────────────────────────────────────────

/** Scores the round and opens the reveal. A pot claimed exactly once pays its
 * face value; a contested pot pays nobody, and neither does an unclaimed one
 * (there is no one to pay). */
function resolveRound(state: KapmacaState): KapmacaState {
  const claimants = new Map<number, PlayerIndex[]>();
  for (let seat = 0; seat < state.playerCount; seat += 1) {
    const pot = state.picks[seat];
    if (pot === null) continue;
    const existing = claimants.get(pot);
    if (existing === undefined) claimants.set(pot, [seat]);
    else existing.push(seat);
  }

  const awarded = Array(state.playerCount).fill(0) as number[];
  const contested: number[] = [];
  for (const [pot, seats] of claimants) {
    if (seats.length === 1) awarded[seats[0]] = potValue(pot);
    else contested.push(pot);
  }

  const result: KapmacaRoundResult = {
    round: state.round,
    picks: state.picks,
    awarded,
    contestedPots: contested.sort((left, right) => left - right),
  };
  return {
    ...state,
    scores: state.scores.map((score, seat) => score + awarded[seat]),
    revealing: result,
    history: [...state.history, result],
  };
}

/** Closes the reveal and deals the next round. The round counter keeps
 * climbing past the last round — that overflow is exactly what `isFinished`
 * reads, so the final reveal gets its full time on screen before the match
 * reports as over. */
function advanceAfterReveal(state: KapmacaState): KapmacaState {
  return {
    ...state,
    round: state.round + 1,
    revealing: null,
    picks: Array(state.playerCount).fill(null),
  };
}

// ── Queries (exported for the board) ─────────────────────────────────────────

/** Face value of a 0-based pot index: pots run 1 … potCount. */
export function potValue(pot: number): number {
  return pot + 1;
}

export function isValidPot(pot: number, potCount: number): boolean {
  return Number.isInteger(pot) && pot >= 0 && pot < potCount;
}

export function isFinished(state: KapmacaState): boolean {
  return state.round >= state.totalRounds;
}

/** Every seat sharing the highest score — one entry is an outright winner,
 * several are tied leaders. Sorted by seat so all clients agree on order. */
export function leaders(state: KapmacaState): PlayerIndex[] {
  const best = Math.max(...state.scores);
  return state.scores
    .map((_, seat) => seat)
    .filter((seat) => state.scores[seat] === best);
}

/** How many seats have claimed a pot this round, for a progress line. */
export function claimedCount(state: KapmacaState): number {
  return state.picks.filter((pot) => pot !== null).length;
}

/** Seats ordered by score, highest first, for the scoreboard. Ties keep seat
 * order, which makes the list stable between renders. */
export function standings(state: KapmacaState): PlayerIndex[] {
  return state.scores
    .map((_, seat) => seat)
    .sort((left, right) => state.scores[right] - state.scores[left] || left - right);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function everyoneClaimed(state: KapmacaState): boolean {
  return state.picks.every((pot) => pot !== null);
}

function isSeat(value: number, playerCount: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < playerCount;
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const out = [...items];
  out[index] = value;
  return out;
}

function clamp(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

// ── Move guards ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPickMove(move: unknown): move is PickMove {
  return isRecord(move) && move.t === "pick" && typeof move.pot === "number";
}

function isResolveRoundMove(move: unknown): move is ResolveRoundMove {
  return (
    isRecord(move) && move.t === "resolveRound" && typeof move.round === "number"
  );
}

function isAdvanceRoundMove(move: unknown): move is AdvanceRoundMove {
  return (
    isRecord(move) && move.t === "advanceRound" && typeof move.round === "number"
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

/** One settled round. `picks` is the full per-seat claim list — safe to hold
 * here (and to render) precisely because the round is over. */
export interface KapmacaRoundResult {
  round: number;
  picks: readonly (number | null)[];
  /** Points each seat gained this round — 0 for a clash or a missed claim. */
  awarded: readonly number[];
  /** 0-based pots two or more seats went for, so the reveal can mark them. */
  contestedPots: readonly number[];
}

export interface KapmacaState {
  playerCount: number;
  /** Always equals `playerCount` — one pot per seat, worth 1 … potCount. */
  potCount: number;
  totalRounds: number;
  countdownSeconds: number;
  /** 0-based; climbs to `totalRounds` once the last reveal is dismissed. */
  round: number;
  /** Per seat: the 0-based pot claimed this round, or null. */
  picks: readonly (number | null)[];
  scores: readonly number[];
  /** Non-null only while a settled round is on screen. */
  revealing: KapmacaRoundResult | null;
  history: readonly KapmacaRoundResult[];
}

interface PickMove {
  t: "pick";
  /** 0-based pot index. */
  pot: number;
}
interface ResolveRoundMove {
  t: "resolveRound";
  round: number;
}
interface AdvanceRoundMove {
  t: "advanceRound";
  round: number;
}

export type KapmacaMove = PickMove | ResolveRoundMove | AdvanceRoundMove;
