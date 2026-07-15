// Sayı Tahmini — 2 to 16 players share one hidden number in [0, 100] and
// guess in turn order (seat 0, 1, 2, … wrapping back to 0). Every guess that
// isn't the target narrows the shared [low, high] range around it, so a
// number once ruled out can never be guessed again — the range alone enforces
// "no repeats, no out-of-range". Because the target always stays inside
// [low, high], the range eventually pins to a single number and whoever's
// turn it is must land on it: the match can never end in a draw. The target
// comes solely from the room seed, so every client agrees on it without it
// ever being sent over the wire.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";
import { mulberry32, pickIndex } from "@/shared/lib/seeded-rng";

// ── Game definition ──────────────────────────────────────────────────────────

export const numberGuessGame: GameDef<NumberGuessState, NumberGuessMove> = {
  meta: {
    id: "sayi-tahmini",
    name: "Sayı Tahmini",
    icon: "🔢",
    tagline: "0-100 arası gizli sayıyı ilk bilen kazanır.",
    minPlayers: 2,
    maxPlayers: 16,
  },
  playerLabel: (index) => `Oyuncu ${index + 1}`,
  init,
  applyMove,
  status,
  turn,
};

// ── Constants ────────────────────────────────────────────────────────────────

export const MIN_NUMBER = 0;
export const MAX_NUMBER = 100;

// ── Rules ────────────────────────────────────────────────────────────────────

function init(seed: number, playerCount: number): NumberGuessState {
  const rng = mulberry32(seed);
  const target = MIN_NUMBER + pickIndex(rng, MAX_NUMBER - MIN_NUMBER + 1);
  return {
    low: MIN_NUMBER,
    high: MAX_NUMBER,
    target,
    turn: 0,
    playerCount,
    history: [],
    winner: null,
  };
}

function applyMove(
  state: NumberGuessState,
  move: NumberGuessMove,
  player: PlayerIndex,
): NumberGuessState | null {
  if (state.winner !== null) return null; // match already decided
  if (player !== state.turn) return null; // not this seat's turn
  if (typeof move !== "object" || move === null) return null;
  const { guess } = move;
  if (!Number.isInteger(guess)) return null;
  if (guess < state.low || guess > state.high) return null; // already ruled out

  const history = [...state.history, { player, guess }];
  if (guess === state.target) {
    return { ...state, history, winner: player };
  }
  return {
    ...state,
    low: guess < state.target ? guess + 1 : state.low,
    high: guess > state.target ? guess - 1 : state.high,
    turn: nextTurn(state.turn, state.playerCount),
    history,
  };
}

function status(state: NumberGuessState): GameStatus {
  return state.winner === null
    ? { kind: "ongoing" }
    : { kind: "won", winner: state.winner };
}

function turn(state: NumberGuessState): PlayerIndex | null {
  return state.winner === null ? state.turn : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function nextTurn(current: PlayerIndex, playerCount: number): PlayerIndex {
  return (current + 1) % playerCount;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** One guess in play order — kept for the board's running history list. */
export interface GuessEntry {
  player: PlayerIndex;
  guess: number;
}

export interface NumberGuessState {
  /** Narrowing bounds around the target — both inclusive. */
  low: number;
  high: number;
  /** Never sent over the wire; every client derives the same value locally
   * from the room seed. The board only reveals it once the match is won. */
  target: number;
  /** Seat to guess next. */
  turn: PlayerIndex;
  playerCount: number;
  history: readonly GuessEntry[];
  winner: PlayerIndex | null;
}

/** A single integer guess, expected to already lie in `[low, high]`. */
export interface NumberGuessMove {
  guess: number;
}
