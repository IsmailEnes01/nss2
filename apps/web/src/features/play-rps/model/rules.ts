// Taş-Kağıt-Makas — simultaneous rounds over the lockstep relay. Each player
// commits a hidden choice; once both are in, the round resolves and the score
// updates. First to three round wins takes the match (a drawn match cannot
// happen). `turn()` is always null — moves are simultaneous — so the shell
// lets both players act while the match is ongoing; the reducer blocks a
// second commit per round, and the board never renders the opponent's
// uncommitted choice.
import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";

// ── Game definition ──────────────────────────────────────────────────────────

export const rpsGame: GameDef<RpsState, RpsMove> = {
  meta: {
    id: "tas-kagit-makas",
    name: "Taş-Kağıt-Makas",
    icon: "✊",
    tagline: "Üç el kazanan maçı alır",
    minPlayers: 2,
    maxPlayers: 2,
  },
  playerLabel: (index) => `Oyuncu ${index + 1}`,
  init,
  applyMove,
  status,
  turn,
};

// ── Constants ────────────────────────────────────────────────────────────────

export const RPS_CHOICES = ["tas", "kagit", "makas"] as const;

/** Round wins needed to take the match. */
export const ROUNDS_TO_WIN = 3;

/** What each choice defeats — the whole rulebook in one map. */
const BEATS: Record<RpsChoice, RpsChoice> = {
  tas: "makas",
  kagit: "tas",
  makas: "kagit",
};

// ── Rules ────────────────────────────────────────────────────────────────────

/** RPS needs no randomness; the room seed is deliberately unused. */
function init(_seed: number, _playerCount: number): RpsState {
  return { pending: [null, null], rounds: [], score: [0, 0] };
}

function applyMove(
  state: RpsState,
  move: RpsMove,
  player: PlayerIndex,
): RpsState | null {
  if (!isChoice(move)) return null;
  if (status(state).kind !== "ongoing") return null;
  if (state.pending[player] !== null) return null; // one commit per round

  const pending: RpsState["pending"] = [...state.pending];
  pending[player] = move;
  const [zero, one] = pending;
  if (zero === null || one === null) return { ...state, pending };

  // Both choices are in — resolve the round and reset for the next one.
  const winner = duelWinner(zero, one);
  const score: RpsState["score"] = [...state.score];
  if (winner !== null) score[winner] += 1;
  return {
    pending: [null, null],
    rounds: [...state.rounds, { choices: [zero, one], winner }],
    score,
  };
}

function status(state: RpsState): GameStatus {
  if (state.score[0] >= ROUNDS_TO_WIN) return { kind: "won", winner: 0 };
  if (state.score[1] >= ROUNDS_TO_WIN) return { kind: "won", winner: 1 };
  return { kind: "ongoing" };
}

/** Moves are simultaneous — there is never a "current" player. */
function turn(_state: RpsState): PlayerIndex | null {
  return null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Winner of one resolved round, or null on a tie. */
function duelWinner(zero: RpsChoice, one: RpsChoice): PlayerIndex | null {
  if (zero === one) return null;
  return BEATS[zero] === one ? 0 : 1;
}

function isChoice(value: unknown): value is RpsChoice {
  return (RPS_CHOICES as readonly unknown[]).includes(value);
}

// ── Types ────────────────────────────────────────────────────────────────────

export type RpsChoice = (typeof RPS_CHOICES)[number];

/** A move is just the committed choice. */
export type RpsMove = RpsChoice;

/** One settled round; `winner` is null on a tie (no score change). */
export interface RpsRound {
  choices: [RpsChoice, RpsChoice];
  winner: PlayerIndex | null;
}

export interface RpsState {
  /** Commits for the round in progress — the board renders only its own. */
  pending: [RpsChoice | null, RpsChoice | null];
  rounds: RpsRound[];
  score: [number, number];
}
