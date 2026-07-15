// Adam Asmaca — two rounds over one shared word list. Round 0 hides player
// 0's word for player 1 to guess, then the roles swap. Six wrong guesses
// hang the guesser (the word's owner takes the round); completing the word
// takes it for the guesser. Match: two round wins → victory, 1-1 → whoever
// guessed with fewer wrong letters wins, equal wrongs → draw. Both words
// come deterministically from the room seed (one derived RNG stream per
// round), so the lockstep clients always agree.
import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";
import { mulberry32, pickIndex } from "@/shared/lib/seeded-rng";
import { WORDS } from "../config/words";

// ── Game definition ──────────────────────────────────────────────────────────

export const hangmanGame: GameDef<HangmanState, HangmanMove> = {
  meta: {
    id: "adam-asmaca",
    name: "Adam Asmaca",
    icon: "🪢",
    tagline: "Altı yanlıştan önce kelimeyi bul",
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

/** Wrong guesses that hang the guesser and end the round. */
export const MAX_WRONG = 6;

/** The 29-letter Turkish alphabet in dictionary order — the board's letter
 * buttons and move validation share it. */
export const TURKISH_ALPHABET: readonly string[] = [
  ..."ABCÇDEFGĞHIİJKLMNOÖPRSŞTUÜVYZ",
];

// ── Rules ────────────────────────────────────────────────────────────────────

/** Round r's word belongs to seat r; each word comes from its own derived
 * RNG stream (seed, then seed + 1) so the rounds stay independent. */
function init(seed: number, _playerCount: number): HangmanState {
  const first = WORDS[pickIndex(mulberry32(seed), WORDS.length)];
  // Re-draw until the words differ: round 0 reveals its word to everyone,
  // so repeating it in round 1 would hand player 0 a free win.
  const rng = mulberry32(seed + 1);
  let second = WORDS[pickIndex(rng, WORDS.length)];
  while (second === first) second = WORDS[pickIndex(rng, WORDS.length)];
  return {
    rounds: [
      { word: first, guessed: [] },
      { word: second, guessed: [] },
    ],
  };
}

function applyMove(
  state: HangmanState,
  move: HangmanMove,
  player: PlayerIndex,
): HangmanState | null {
  const index = currentRound(state);
  if (index === null) return null; // match already decided
  if (player !== guesserOf(index)) return null; // not this seat's round
  if (typeof move !== "string") return null;
  if (!TURKISH_ALPHABET.includes(move)) return null; // one uppercase letter
  const active = state.rounds[index];
  if (active.guessed.includes(move)) return null; // repeated guess

  const next: HangmanRound = {
    word: active.word,
    guessed: [...active.guessed, move],
  };
  const rounds: HangmanState["rounds"] =
    index === 0 ? [next, state.rounds[1]] : [state.rounds[0], next];
  return { rounds };
}

function status(state: HangmanState): GameStatus {
  if (currentRound(state) !== null) return { kind: "ongoing" };

  const wins: [number, number] = [0, 0];
  for (const index of [0, 1] as const) {
    wins[roundWinner(state.rounds[index], index)] += 1;
  }
  if (wins[0] === 2) return { kind: "won", winner: 0 };
  if (wins[1] === 2) return { kind: "won", winner: 1 };

  // 1-1 — the tighter guesser takes the match: seat 0 guessed round 1,
  // seat 1 guessed round 0.
  const zeroWrongs = wrongLetters(state.rounds[1]).length;
  const oneWrongs = wrongLetters(state.rounds[0]).length;
  if (zeroWrongs < oneWrongs) return { kind: "won", winner: 0 };
  if (oneWrongs < zeroWrongs) return { kind: "won", winner: 1 };
  return { kind: "draw" };
}

function turn(state: HangmanState): PlayerIndex | null {
  const index = currentRound(state);
  return index === null ? null : guesserOf(index);
}

// ── Round helpers (shared with the board) ────────────────────────────────────

/** Round in play: 0, then 1, then null once both are settled. */
export function currentRound(state: HangmanState): 0 | 1 | null {
  if (!isRoundOver(state.rounds[0])) return 0;
  if (!isRoundOver(state.rounds[1])) return 1;
  return null;
}

/** Seat r owns round r's word, so the other seat guesses it. */
export function guesserOf(index: 0 | 1): PlayerIndex {
  return index === 0 ? 1 : 0;
}

export function isRoundOver(round: HangmanRound): boolean {
  return isWordComplete(round) || wrongLetters(round).length >= MAX_WRONG;
}

export function isWordComplete(round: HangmanRound): boolean {
  return [...round.word].every((letter) => round.guessed.includes(letter));
}

/** Guessed letters that are not in the word, in guess order. */
export function wrongLetters(round: HangmanRound): string[] {
  return round.guessed.filter((letter) => !round.word.includes(letter));
}

/** Who took a settled round: the guesser on completion, else the owner. */
export function roundWinner(round: HangmanRound, index: 0 | 1): PlayerIndex {
  const guesser = guesserOf(index);
  if (isWordComplete(round)) return guesser;
  return guesser === 0 ? 1 : 0;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** A move is one uppercase Turkish letter (see TURKISH_ALPHABET). */
export type HangmanMove = string;

export interface HangmanRound {
  /** The uppercase target word; owned by the seat with the same index. */
  word: string;
  /** Guessed letters in guess order — right and wrong alike. */
  guessed: string[];
}

export interface HangmanState {
  rounds: [HangmanRound, HangmanRound];
}
