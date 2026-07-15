// Reducer tests for Sayı Tahmini: the invalid-move matrix, range narrowing in
// both directions, turn rotation for 2+ players (with wraparound), the
// win-on-exact-match rule, purity and seed determinism. A draw is structurally
// impossible here, so there is no draw suite (unlike XOX or Dots & Boxes).

import { describe, expect, it } from "vitest";
import type { NumberGuessMove, NumberGuessState } from "./rules";
import { MAX_NUMBER, MIN_NUMBER, numberGuessGame } from "./rules";

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(numberGuessGame.meta.id).toBe("sayi-tahmini");
    expect(numberGuessGame.meta.name).toBe("Sayı Tahmini");
    expect(numberGuessGame.meta.minPlayers).toBe(2);
    expect(numberGuessGame.meta.maxPlayers).toBe(16);
    expect(numberGuessGame.playerLabel(0)).toBe("Oyuncu 1");
    expect(numberGuessGame.playerLabel(4)).toBe("Oyuncu 5");
  });
});

describe("init", () => {
  it("starts with the full range and seat 0 to move", () => {
    const state = numberGuessGame.init(1, 2);
    expect(state.low).toBe(MIN_NUMBER);
    expect(state.high).toBe(MAX_NUMBER);
    expect(state.target).toBeGreaterThanOrEqual(MIN_NUMBER);
    expect(state.target).toBeLessThanOrEqual(MAX_NUMBER);
    expect(numberGuessGame.turn(state)).toBe(0);
    expect(state.history).toEqual([]);
    expect(numberGuessGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("records the requested player count", () => {
    expect(numberGuessGame.init(1, 5).playerCount).toBe(5);
    expect(numberGuessGame.init(1, 16).playerCount).toBe(16);
  });

  it("is deterministic for the same seed", () => {
    expect(numberGuessGame.init(42, 3)).toEqual(numberGuessGame.init(42, 3));
  });

  it("different seeds (usually) land on different targets", () => {
    const targets = new Set(
      Array.from({ length: 20 }, (_, seed) => numberGuessGame.init(seed, 2).target),
    );
    expect(targets.size).toBeGreaterThan(1);
  });
});

describe("applyMove — invalid moves", () => {
  it("rejects a guess out of turn", () => {
    const state = numberGuessGame.init(1, 3);
    expect(numberGuessGame.applyMove(state, { guess: 50 }, 1)).toBeNull();
    expect(numberGuessGame.applyMove(state, { guess: 50 }, 2)).toBeNull();
  });

  it("rejects a non-integer guess", () => {
    const state = numberGuessGame.init(1, 2);
    expect(numberGuessGame.applyMove(state, { guess: 4.5 }, 0)).toBeNull();
    expect(
      numberGuessGame.applyMove(state, { guess: Number.NaN }, 0),
    ).toBeNull();
  });

  it("rejects malformed payloads", () => {
    const state = numberGuessGame.init(1, 2);
    for (const payload of [null, {}, "50", 50]) {
      expect(
        numberGuessGame.applyMove(state, payload as unknown as NumberGuessMove, 0),
      ).toBeNull();
    }
  });

  it("rejects a guess outside the current [low, high] range", () => {
    const state = numberGuessGame.init(1, 2);
    expect(
      numberGuessGame.applyMove(state, { guess: MIN_NUMBER - 1 }, 0),
    ).toBeNull();
    expect(
      numberGuessGame.applyMove(state, { guess: MAX_NUMBER + 1 }, 0),
    ).toBeNull();
  });

  it("rejects any move once the match is won", () => {
    const state = wonState();
    expect(
      numberGuessGame.applyMove(state, { guess: state.target }, 1),
    ).toBeNull();
  });
});

describe("applyMove — narrowing and turn order", () => {
  it("raises the low bound when the guess undershoots", () => {
    const state = stateWithTarget(70, 2);
    const next = numberGuessGame.applyMove(state, { guess: 30 }, 0);
    expect(next).not.toBeNull();
    expect(next?.low).toBe(31);
    expect(next?.high).toBe(MAX_NUMBER);
  });

  it("lowers the high bound when the guess overshoots", () => {
    const state = stateWithTarget(30, 2);
    const next = numberGuessGame.applyMove(state, { guess: 70 }, 0);
    expect(next).not.toBeNull();
    expect(next?.low).toBe(MIN_NUMBER);
    expect(next?.high).toBe(69);
  });

  it("makes a just-ruled-out number immediately unguessable again", () => {
    const state = stateWithTarget(70, 2);
    const next = numberGuessGame.applyMove(state, { guess: 30 }, 0);
    expect(next).not.toBeNull();
    // 30 is now below the new low (31) — guessing it again is out of range.
    expect(numberGuessGame.applyMove(next as NumberGuessState, { guess: 30 }, 1)).toBeNull();
  });

  it("rotates through every seat and wraps back to 0", () => {
    let state = stateWithTarget(99, 4); // far from any guess below, keeps missing
    state = apply(state, { guess: 0 }, 0);
    expect(numberGuessGame.turn(state)).toBe(1);
    state = apply(state, { guess: 1 }, 1);
    expect(numberGuessGame.turn(state)).toBe(2);
    state = apply(state, { guess: 2 }, 2);
    expect(numberGuessGame.turn(state)).toBe(3);
    state = apply(state, { guess: 3 }, 3);
    expect(numberGuessGame.turn(state)).toBe(0); // wrapped
  });

  it("appends every guess to the history in order", () => {
    let state = stateWithTarget(99, 2);
    state = apply(state, { guess: 10 }, 0);
    state = apply(state, { guess: 20 }, 1);
    expect(state.history).toEqual([
      { player: 0, guess: 10 },
      { player: 1, guess: 20 },
    ]);
  });
});

describe("applyMove — winning", () => {
  it("declares the guesser the winner on an exact match", () => {
    const state = stateWithTarget(55, 3);
    const next = numberGuessGame.applyMove(state, { guess: 55 }, 0);
    expect(next).not.toBeNull();
    expect(numberGuessGame.status(next as NumberGuessState)).toEqual({
      kind: "won",
      winner: 0,
    });
    expect(numberGuessGame.turn(next as NumberGuessState)).toBeNull();
  });

  it("a fully narrowed range forces the next guesser to win", () => {
    const state: NumberGuessState = {
      low: 42,
      high: 42,
      target: 42,
      turn: 1,
      playerCount: 2,
      history: [],
      winner: null,
    };
    const next = numberGuessGame.applyMove(state, { guess: 42 }, 1);
    expect(next).not.toBeNull();
    expect(numberGuessGame.status(next as NumberGuessState)).toEqual({
      kind: "won",
      winner: 1,
    });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A fresh, full-range state with a hand-picked target (never derived from a
 * real seed) so narrowing tests don't depend on `init`'s RNG output. */
function stateWithTarget(target: number, playerCount: number): NumberGuessState {
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

function wonState(): NumberGuessState {
  return { ...stateWithTarget(10, 2), winner: 0 };
}

function apply(
  state: NumberGuessState,
  move: NumberGuessMove,
  player: number,
): NumberGuessState {
  const next = numberGuessGame.applyMove(state, move, player);
  if (next === null) throw new Error("expected a legal move in this fixture");
  return next;
}
