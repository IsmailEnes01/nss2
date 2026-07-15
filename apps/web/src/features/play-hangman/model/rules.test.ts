import { describe, expect, it } from "vitest";
import type { PlayerIndex } from "@/entities/game";
import { WORDS } from "../config/words";
import {
  currentRound,
  guesserOf,
  type HangmanMove,
  type HangmanState,
  hangmanGame,
  isRoundOver,
  isWordComplete,
  MAX_WRONG,
  roundWinner,
  TURKISH_ALPHABET,
  wrongLetters,
} from "./rules";

describe("init & seed determinism", () => {
  it("is identical for the same seed", () => {
    expect(hangmanGame.init(1234, 2)).toEqual(hangmanGame.init(1234, 2));
  });

  it("draws both words from the shared list, untouched", () => {
    const state = hangmanGame.init(7, 2);
    for (const round of state.rounds) {
      expect(WORDS).toContain(round.word);
      expect(round.guessed).toEqual([]);
    }
  });

  it("never deals the same word to both rounds", () => {
    for (let seed = 0; seed < 100; seed += 1) {
      const { rounds } = hangmanGame.init(seed, 2);
      expect(rounds[0].word).not.toBe(rounds[1].word);
    }
  });

  it("varies the words with the seed", () => {
    const picks = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) {
      picks.add(hangmanGame.init(seed, 2).rounds[0].word);
    }
    expect(picks.size).toBeGreaterThan(1);
  });
});

describe("the word list", () => {
  it("holds 80 unique words", () => {
    expect(WORDS).toHaveLength(80);
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it("uses only the uppercase Turkish alphabet", () => {
    for (const word of WORDS) {
      for (const letter of word) {
        expect(TURKISH_ALPHABET).toContain(letter);
      }
    }
  });

  it("keeps every word long enough to play", () => {
    for (const word of WORDS) {
      expect(word.length).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("turn order", () => {
  it("hands round 0 (player 0's word) to player 1", () => {
    expect(hangmanGame.turn(hangmanGame.init(0, 2))).toBe(1);
  });

  it("rejects guesses from the word's owner", () => {
    expect(hangmanGame.applyMove(hangmanGame.init(0, 2), "A", 0)).toBeNull();
  });

  it("passes to player 0 once round 0 settles", () => {
    const state = completeRound(hangmanGame.init(0, 2), 0);
    expect(currentRound(state)).toBe(1);
    expect(hangmanGame.turn(state)).toBe(0);
    expect(hangmanGame.applyMove(state, "A", 1)).toBeNull();
  });

  it("is null once the match is over", () => {
    const state = hangRound(completeRound(hangmanGame.init(0, 2), 0), 1);
    expect(hangmanGame.turn(state)).toBeNull();
  });
});

describe("guessing", () => {
  it("records a correct guess without penalty", () => {
    const start = hangmanGame.init(3, 2);
    const hit = start.rounds[0].word[0];
    const state = must(hangmanGame.applyMove(start, hit, 1));
    expect(state.rounds[0].guessed).toEqual([hit]);
    expect(wrongLetters(state.rounds[0])).toEqual([]);
  });

  it("counts a wrong guess against the guesser", () => {
    const start = hangmanGame.init(3, 2);
    const miss = lettersNotIn(start.rounds[0].word, 1)[0];
    const state = must(hangmanGame.applyMove(start, miss, 1));
    expect(wrongLetters(state.rounds[0])).toEqual([miss]);
    expect(isRoundOver(state.rounds[0])).toBe(false);
  });

  it("rejects a repeated guess, right or wrong alike", () => {
    const start = hangmanGame.init(3, 2);
    const hit = start.rounds[0].word[0];
    const miss = lettersNotIn(start.rounds[0].word, 1)[0];
    const state = guessAll(start, 1, [hit, miss]);
    expect(hangmanGame.applyMove(state, hit, 1)).toBeNull();
    expect(hangmanGame.applyMove(state, miss, 1)).toBeNull();
  });

  it("rejects anything but a single uppercase Turkish letter", () => {
    const start = hangmanGame.init(3, 2);
    const invalid = ["a", "i", "ç", "AB", "", " ", "1", "Q", "W", "X"];
    for (const move of invalid) {
      expect(hangmanGame.applyMove(start, move, 1)).toBeNull();
    }
    for (const move of [5, null, undefined, {}, ["A"]]) {
      expect(hangmanGame.applyMove(start, move as HangmanMove, 1)).toBeNull();
    }
  });

  it("does not mutate the previous state", () => {
    const before = hangmanGame.init(3, 2);
    must(hangmanGame.applyMove(before, before.rounds[0].word[0], 1));
    expect(before).toEqual(hangmanGame.init(3, 2));
  });

  it("hangs the guesser on the sixth wrong guess", () => {
    const start = hangmanGame.init(5, 2);
    const misses = lettersNotIn(start.rounds[0].word, MAX_WRONG);
    const fiveIn = guessAll(start, 1, misses.slice(0, MAX_WRONG - 1));
    expect(isRoundOver(fiveIn.rounds[0])).toBe(false);
    const hanged = guessAll(fiveIn, 1, misses.slice(MAX_WRONG - 1));
    expect(isRoundOver(hanged.rounds[0])).toBe(true);
    expect(isWordComplete(hanged.rounds[0])).toBe(false);
    expect(roundWinner(hanged.rounds[0], 0)).toBe(0); // owner takes it
  });

  it("ends the round for the guesser when the last letter falls", () => {
    const state = completeRound(hangmanGame.init(5, 2), 0);
    expect(isWordComplete(state.rounds[0])).toBe(true);
    expect(roundWinner(state.rounds[0], 0)).toBe(1); // guesser takes it
  });
});

describe("match outcomes", () => {
  it("stays ongoing until both rounds settle", () => {
    const start = hangmanGame.init(9, 2);
    expect(hangmanGame.status(start)).toEqual({ kind: "ongoing" });
    const oneDown = completeRound(start, 0);
    expect(hangmanGame.status(oneDown)).toEqual({ kind: "ongoing" });
  });

  it("gives player 1 the sweep: guessed round 0, hanged player 0", () => {
    const state = hangRound(completeRound(hangmanGame.init(9, 2), 0), 1);
    expect(hangmanGame.status(state)).toEqual({ kind: "won", winner: 1 });
  });

  it("gives player 0 the sweep: hanged player 1, guessed round 1", () => {
    const state = completeRound(hangRound(hangmanGame.init(9, 2), 0), 1);
    expect(hangmanGame.status(state)).toEqual({ kind: "won", winner: 0 });
  });

  it("breaks 1-1 toward the guesser with fewer wrong letters", () => {
    const start = hangmanGame.init(11, 2);
    const zeroTighter = completeRound(completeRound(start, 0, 2), 1, 0);
    expect(hangmanGame.status(zeroTighter)).toEqual({
      kind: "won",
      winner: 0,
    });
    const oneTighter = completeRound(completeRound(start, 0, 0), 1, 2);
    expect(hangmanGame.status(oneTighter)).toEqual({
      kind: "won",
      winner: 1,
    });
  });

  it("draws 1-1 with equal wrong counts", () => {
    const start = hangmanGame.init(11, 2);
    const state = completeRound(completeRound(start, 0, 1), 1, 1);
    expect(hangmanGame.status(state)).toEqual({ kind: "draw" });
  });

  it("draws when both guessers hang (6-6 wrongs)", () => {
    const state = hangRound(hangRound(hangmanGame.init(11, 2), 0), 1);
    expect(hangmanGame.status(state)).toEqual({ kind: "draw" });
  });

  it("rejects any guess after the match is decided", () => {
    const done = hangRound(completeRound(hangmanGame.init(9, 2), 0), 1);
    expect(hangmanGame.applyMove(done, "A", 0)).toBeNull();
    expect(hangmanGame.applyMove(done, "A", 1)).toBeNull();
  });
});

// ── Harness ──────────────────────────────────────────────────────────────────

/** Unwraps a move the scenario needs the reducer to accept. */
function must(state: HangmanState | null): HangmanState {
  if (!state) throw new Error("expected the guess to be accepted");
  return state;
}

/** Feeds `letters` one by one as `player`; throws on any rejection. */
function guessAll(
  state: HangmanState,
  player: PlayerIndex,
  letters: string[],
): HangmanState {
  let current = state;
  for (const letter of letters) {
    current = must(hangmanGame.applyMove(current, letter, player));
  }
  return current;
}

/** The distinct letters of `word`, in first-appearance order. */
function uniqueLetters(word: string): string[] {
  return [...new Set(word)];
}

/** The first `count` alphabet letters that are NOT in `word`. */
function lettersNotIn(word: string, count: number): string[] {
  return TURKISH_ALPHABET.filter((l) => !word.includes(l)).slice(0, count);
}

// ── Match scenarios ──────────────────────────────────────────────────────────

/** The guesser completes round `index` after `wrongs` misses (< MAX_WRONG). */
function completeRound(
  state: HangmanState,
  index: 0 | 1,
  wrongs = 0,
): HangmanState {
  const word = state.rounds[index].word;
  const letters = [...lettersNotIn(word, wrongs), ...uniqueLetters(word)];
  return guessAll(state, guesserOf(index), letters);
}

/** The guesser of round `index` misses MAX_WRONG times and hangs. */
function hangRound(state: HangmanState, index: 0 | 1): HangmanState {
  const word = state.rounds[index].word;
  return guessAll(state, guesserOf(index), lettersNotIn(word, MAX_WRONG));
}
