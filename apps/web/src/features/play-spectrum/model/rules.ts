// Spektrum Çarkı — every seated player gets exactly one round as Clue
// Giver, in clockwise rotation from a seed-picked starting seat; the room
// seed also fixes that round's spectrum pair and hidden target (0-100) up
// front, for every round, so lockstep clients never disagree. Two phases
// per round: (1) Clue — only the round's Clue Giver may act, submitting one
// word; (2) Guess — every *other* seated player independently locks in
// their own guess (`guess`), once, whenever they like. A guesser who never
// gets one in scores 0 for the round. The round ends the instant every
// guesser has one in (folded into that final `guess` move itself — no extra
// round-trip needed), or — if some guessers are still undecided — after the
// host's configured countdown from whoever guessed *first* (`resolve`,
// proposed locally by any client's own clock; see its doc comment for why
// that's safe without the reducer ever touching wall-clock time). The
// target is never sent over the wire, but every client can already compute
// it from the seed — same trust model as Amiral Battı's fleets: the board
// just doesn't render a round's target until that round is locked in.
import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";
import { mulberry32, pickIndex } from "@/shared/lib/seeded-rng";
import { type SpectrumPair, SPECTRUMS } from "../config/spectrums";

// ── Constants ────────────────────────────────────────────────────────────────

export const MIN_TARGET = 0;
export const MAX_TARGET = 100;

/** One word, no whitespace — a compound phrase isn't "1 word". */
export const MAX_CLUE_LENGTH = 24;

export const DEFAULT_COUNTDOWN_SECONDS = 15;
export const MIN_COUNTDOWN_SECONDS = 5;
export const MAX_COUNTDOWN_SECONDS = 60;

/** Distance → points, first band the distance still fits inside wins;
 * anything wider than the last one scores 0 — same band a missing guess
 * gets. */
const SCORE_BANDS: readonly { withinDistance: number; points: number }[] = [
  { withinDistance: 3, points: 4 },
  { withinDistance: 7, points: 3 },
  { withinDistance: 12, points: 2 },
  { withinDistance: 18, points: 1 },
];

// ── Game definition ──────────────────────────────────────────────────────────

export const spectrumGame: GameDef<SpectrumState, SpectrumMove> = {
  meta: {
    id: "spektrum-carki",
    name: "Spektrum Çarkı",
    icon: "🎡",
    tagline: "Tek kelimelik ipucu ver, takım gizli noktayı bulsun.",
    minPlayers: 2,
    maxPlayers: 16,
    settings: [
      {
        key: "countdownSeconds",
        label: "Tahmin süresi (sn)",
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

/** One spectrum + one hidden target per player — the full match is fixed at
 * init, so "round `r`'s Clue Giver, spectrum, and target" never has to be
 * derived lazily. `clueGivers` rotates clockwise from a seed-picked start.
 * `settings.countdownSeconds` is the host's chosen value from the pre-game
 * settings screen (already clamped there, but clamped again here too —
 * never trust a number that crossed the wire). */
function init(
  seed: number,
  playerCount: number,
  settings: Readonly<Record<string, number>> = {},
): SpectrumState {
  const rng = mulberry32(seed);
  const spectrums: SpectrumPair[] = [];
  const targets: number[] = [];
  const used = new Set<number>();
  for (let round = 0; round < playerCount; round += 1) {
    spectrums.push(drawSpectrum(rng, used));
    targets.push(MIN_TARGET + pickIndex(rng, MAX_TARGET - MIN_TARGET + 1));
  }
  const firstClueGiver = pickIndex(rng, playerCount);
  const clueGivers = Array.from(
    { length: playerCount },
    (_, round) => (firstClueGiver + round) % playerCount,
  );
  return {
    spectrums,
    targets,
    clueGivers,
    rounds: [],
    current: 0,
    clue: null,
    guesses: Array(playerCount).fill(null),
    countdownSeconds: clampCountdown(settings.countdownSeconds),
    score: Array(playerCount).fill(0),
  };
}

function applyMove(
  state: SpectrumState,
  move: SpectrumMove,
  player: PlayerIndex,
): SpectrumState | null {
  const round = state.current;
  if (round === null) return null; // match already decided
  const clueGiver = state.clueGivers[round];

  if (isClueMove(move)) {
    if (player !== clueGiver) return null; // only this round's Clue Giver
    if (state.clue !== null) return null; // one clue per round
    const text = move.text.trim();
    if (!isValidClueWord(text)) return null;
    return { ...state, clue: text };
  }

  if (isGuessMove(move)) {
    if (player === clueGiver) return null; // Clue Giver doesn't guess
    if (state.clue === null) return null; // no clue yet — nothing to guess
    if (state.guesses[player] !== null) return null; // one guess per seat
    if (!Number.isInteger(move.value)) return null;
    if (move.value < MIN_TARGET || move.value > MAX_TARGET) return null;
    const guesses = state.guesses.map((existing, seat) =>
      seat === player ? move.value : existing,
    );
    const settled = { ...state, guesses };
    // The last guesser to come in ends the round immediately — no separate
    // "everyone's in" move needed, and no need to wait out the countdown.
    return everyoneHasGuessed(settled, clueGiver)
      ? resolveRound(settled, round, clueGiver, state.clue)
      : settled;
  }

  if (isResolveMove(move)) {
    // Stale timer for a round that already ended some other way — a
    // harmless no-op, never the wrong round's business.
    if (move.round !== round) return null;
    if (state.clue === null) return null; // nothing to resolve yet
    if (!state.guesses.some((guess) => guess !== null)) return null; // no countdown was ever running
    return resolveRound(state, round, clueGiver, state.clue);
  }

  return null;
}

function status(state: SpectrumState): GameStatus {
  if (state.current !== null) return { kind: "ongoing" };
  const top = Math.max(...state.score);
  const winners = state.score.flatMap((points, seat) =>
    points === top ? [seat] : [],
  );
  return winners.length === 1 ? { kind: "won", winner: winners[0] } : { kind: "draw" };
}

/** The Clue Giver alone can act during the clue phase (a real "turn"); once
 * the clue lands, every guesser may lock in independently and simultaneously
 * — like RPS's commit phase, so `null` here rather than any one seat. */
function turn(state: SpectrumState): PlayerIndex | null {
  if (state.current === null) return null;
  return state.clue === null ? state.clueGivers[state.current] : null;
}

// ── Helpers (shared with the board) ─────────────────────────────────────────

/** A sane starting position for a guess slider before anyone's dragged it —
 * purely a UI default, the reducer never uses it. */
export function midpoint(): number {
  return Math.round((MIN_TARGET + MAX_TARGET) / 2);
}

/** First score band the distance still fits inside; 0 past the last one —
 * also what a missing guess scores. */
export function pointsForDistance(distance: number): number {
  const band = SCORE_BANDS.find((b) => distance <= b.withinDistance);
  return band?.points ?? 0;
}

function everyoneHasGuessed(
  state: SpectrumState,
  clueGiver: PlayerIndex,
): boolean {
  return state.guesses.every(
    (guess, seat) => seat === clueGiver || guess !== null,
  );
}

/** Scores the round from whatever guesses are in (a missing one is 0) and
 * advances to the next Clue Giver, or ends the match once every seat has
 * had a turn. The Clue Giver earns the average of every guesser's points,
 * missing guesses (0) included — one careless clue tanks the Clue Giver's
 * own score too, same as a genuinely bad one. */
function resolveRound(
  state: SpectrumState,
  round: number,
  clueGiver: PlayerIndex,
  clue: string,
): SpectrumState {
  const target = state.targets[round];
  const guesserPoints = state.guesses.map((guess, seat) =>
    seat === clueGiver || guess === null
      ? 0
      : pointsForDistance(Math.abs(guess - target)),
  );
  const clueGiverPoints = averageOf(
    guesserPoints.filter((_, seat) => seat !== clueGiver),
  );
  const points = guesserPoints.map((p, seat) =>
    seat === clueGiver ? clueGiverPoints : p,
  );

  const resolved: SpectrumRound = {
    spectrum: state.spectrums[round],
    clueGiver,
    clue,
    target,
    guesses: state.guesses,
    points,
  };

  const score = state.score.map((total, seat) => total + points[seat]);
  const nextRound = round + 1;

  return {
    ...state,
    rounds: [...state.rounds, resolved],
    current: nextRound < state.clueGivers.length ? nextRound : null,
    clue: null,
    guesses: Array(state.score.length).fill(null),
    score,
  };
}

/** Rounds to the nearest point — scores are always whole numbers. */
function averageOf(values: readonly number[]): number {
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

/** Draws a spectrum not yet used this match, unless the pool is too small to
 * keep going without repeats (mirrors Adam Asmaca's re-draw-until-different
 * guard). */
function drawSpectrum(
  rng: () => number,
  used: Set<number>,
): SpectrumPair {
  let index = pickIndex(rng, SPECTRUMS.length);
  while (used.has(index) && used.size < SPECTRUMS.length) {
    index = pickIndex(rng, SPECTRUMS.length);
  }
  used.add(index);
  return SPECTRUMS[index];
}

/** Clamps a settings value the same way regardless of where it came from —
 * the settings screen already clamps on entry, but a value that crossed the
 * wire (or an older client with a stale default) gets the same treatment
 * here rather than trusted outright. Missing/non-finite falls back to the
 * default entirely rather than clamping `undefined`. */
function clampCountdown(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_COUNTDOWN_SECONDS;
  }
  return Math.min(
    MAX_COUNTDOWN_SECONDS,
    Math.max(MIN_COUNTDOWN_SECONDS, Math.round(value)),
  );
}

/** Exported so the board can validate a draft before ever calling `onMove` —
 * a rejected move has no way to tell the board *why*, so the UI needs its
 * own copy of this exact rule to give real-time feedback instead of
 * silently eating an invalid submission. */
export function isValidClueWord(text: string): boolean {
  return text.length > 0 && text.length <= MAX_CLUE_LENGTH && !/\s/.test(text);
}

function isClueMove(move: SpectrumMove): move is { t: "clue"; text: string } {
  return (
    isRecord(move) && move.t === "clue" && typeof move.text === "string"
  );
}

function isGuessMove(
  move: SpectrumMove,
): move is { t: "guess"; value: number } {
  return (
    isRecord(move) && move.t === "guess" && typeof move.value === "number"
  );
}

function isResolveMove(
  move: SpectrumMove,
): move is { t: "resolve"; round: number } {
  return (
    isRecord(move) && move.t === "resolve" && typeof move.round === "number"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** A settled round, kept for the board's history list and the reveal. Both
 * arrays are indexed by seat (length = player count): `guesses[seat]` is
 * null for the Clue Giver's own slot and for anyone who never got a guess
 * in; `points[seat]` is what that round added to that seat's score (the
 * Clue Giver's own slot holds their averaged total, not a per-distance
 * score). */
export interface SpectrumRound {
  spectrum: SpectrumPair;
  clueGiver: PlayerIndex;
  clue: string;
  target: number;
  guesses: readonly (number | null)[];
  points: readonly number[];
}

export interface SpectrumState {
  /** One spectrum per round, fixed at init — index by round number. */
  spectrums: readonly SpectrumPair[];
  /** One hidden target per round, fixed at init. Never sent over the wire;
   * every client derives the same values locally from the room seed. The
   * board only reveals round `r`'s target once `rounds[r]` exists. */
  targets: readonly number[];
  /** Round `r`'s Clue Giver seat — a clockwise rotation from a seed-picked
   * starting seat, one entry per player so everyone gets exactly one turn. */
  clueGivers: readonly PlayerIndex[];
  /** Settled rounds so far, oldest first. */
  rounds: readonly SpectrumRound[];
  /** The round in progress, or null once every seat has been Clue Giver. */
  current: number | null;
  /** The active round's one-word clue — null until the Clue Giver submits it
   * (the guess phase hasn't started yet). */
  clue: string | null;
  /** The active round's per-seat guesses so far — null until that seat locks
   * one in (and always null for the Clue Giver's own seat). Reset to all
   * null at the start of every round. */
  guesses: readonly (number | null)[];
  /** Seconds after the first guess of a round before it auto-resolves —
   * fixed for the whole match from the host's chosen setting at init. Purely
   * informational for the board's own countdown; the reducer itself never
   * checks wall-clock time (see `resolve`). */
  countdownSeconds: number;
  /** Cumulative score per seat. */
  score: readonly number[];
}

/** Clue Giver submits the round's one-word clue. */
export type SpectrumMove =
  | { t: "clue"; text: string }
  /** A non-Clue-Giver seat locks in their own guess (0-100) — once per seat
   * per round. Resolves the round immediately, as part of this same move,
   * once it's the last guess still outstanding. */
  | { t: "guess"; value: number }
  /** Proposed by any client once its own local countdown — started the
   * moment the first guess of the round landed — reaches zero. Ends the
   * round early: whoever never got a guess in scores 0. Carries the round
   * it was scheduled for, so a timer that fires after the round already
   * ended some other way (everyone guessed, or a peer's `resolve` arrived
   * first) is a harmless no-op instead of resolving the wrong round. Safe
   * for multiple clients to propose near-simultaneously — whichever the
   * reducer sees first wins; the rest fail the "still `move.round`, still
   * has a clue" checks and are dropped. */
  | { t: "resolve"; round: number };
