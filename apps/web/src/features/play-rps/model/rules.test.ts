import { describe, expect, it } from "vitest";
import type { PlayerIndex } from "@/entities/game";
import {
  ROUNDS_TO_WIN,
  RPS_CHOICES,
  type RpsChoice,
  type RpsMove,
  type RpsState,
  rpsGame,
} from "./rules";

describe("init", () => {
  it("is identical for the same seed", () => {
    expect(rpsGame.init(42, 2)).toEqual(rpsGame.init(42, 2));
  });

  it("ignores the seed entirely (RPS has no randomness)", () => {
    expect(rpsGame.init(1, 2)).toEqual(rpsGame.init(2, 2));
  });

  it("starts with no commits, no rounds, and a level score", () => {
    expect(rpsGame.init(0, 2)).toEqual({
      pending: [null, null],
      rounds: [],
      score: [0, 0],
    });
  });
});

describe("round resolution", () => {
  it("resolves every choice pair to the classic winner", () => {
    const matrix: [RpsChoice, RpsChoice, PlayerIndex | null][] = [
      ["tas", "tas", null],
      ["tas", "kagit", 1],
      ["tas", "makas", 0],
      ["kagit", "tas", 0],
      ["kagit", "kagit", null],
      ["kagit", "makas", 1],
      ["makas", "tas", 1],
      ["makas", "kagit", 0],
      ["makas", "makas", null],
    ];
    for (const [zero, one, winner] of matrix) {
      const state = commit(rpsGame.init(0, 2), zero, one);
      expect(state.rounds).toEqual([{ choices: [zero, one], winner }]);
    }
  });

  it("scores the round winner and leaves ties unscored", () => {
    let state = commit(rpsGame.init(0, 2), "tas", "makas");
    expect(state.score).toEqual([1, 0]);
    state = commit(state, "kagit", "kagit");
    expect(state.score).toEqual([1, 0]); // tie: recorded, not scored
    state = commit(state, "tas", "kagit");
    expect(state.score).toEqual([1, 1]);
    expect(state.rounds).toHaveLength(3);
  });

  it("resolves the same regardless of commit order", () => {
    const start = rpsGame.init(0, 2);
    const zeroFirst = commit(start, "kagit", "makas");
    const half = must(rpsGame.applyMove(start, "makas", 1));
    expect(rpsGame.applyMove(half, "kagit", 0)).toEqual(zeroFirst);
  });

  it("clears both pending slots once the round settles", () => {
    const state = commit(rpsGame.init(0, 2), "tas", "kagit");
    expect(state.pending).toEqual([null, null]);
  });

  it("keeps the opponent's slot empty while only one player committed", () => {
    const state = rpsGame.applyMove(rpsGame.init(0, 2), "makas", 0);
    expect(state?.pending).toEqual(["makas", null]);
    expect(state?.rounds).toEqual([]); // nothing resolved to render yet
  });

  it("does not mutate the previous state", () => {
    const before = rpsGame.init(0, 2);
    commit(before, "tas", "makas");
    expect(before).toEqual(rpsGame.init(0, 2));
  });
});

describe("invalid moves", () => {
  it("rejects a second commit in the same round", () => {
    const state = must(rpsGame.applyMove(rpsGame.init(0, 2), "tas", 0));
    expect(rpsGame.applyMove(state, "tas", 0)).toBeNull();
    expect(rpsGame.applyMove(state, "kagit", 0)).toBeNull(); // no re-picks
  });

  it("rejects choices outside the rulebook", () => {
    const state = rpsGame.init(0, 2);
    for (const bad of ["kaya", "TAS", "", 3, null, undefined, {}]) {
      expect(rpsGame.applyMove(state, bad as RpsMove, 0)).toBeNull();
    }
  });

  it("rejects commits after the match is decided", () => {
    const done = winRounds(rpsGame.init(0, 2), 0, ROUNDS_TO_WIN);
    expect(rpsGame.applyMove(done, "tas", 0)).toBeNull();
    expect(rpsGame.applyMove(done, "tas", 1)).toBeNull();
  });
});

describe("match status", () => {
  it("stays ongoing until someone reaches the target", () => {
    let state = winRounds(rpsGame.init(0, 2), 0, ROUNDS_TO_WIN - 1);
    state = winRounds(state, 1, ROUNDS_TO_WIN - 1);
    expect(rpsGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("declares the first player to the target the winner", () => {
    const zeroWins = winRounds(rpsGame.init(0, 2), 0, ROUNDS_TO_WIN);
    expect(rpsGame.status(zeroWins)).toEqual({ kind: "won", winner: 0 });
    const oneWins = winRounds(rpsGame.init(0, 2), 1, ROUNDS_TO_WIN);
    expect(rpsGame.status(oneWins)).toEqual({ kind: "won", winner: 1 });
  });

  it("never ends on ties alone", () => {
    let state = rpsGame.init(0, 2);
    for (const choice of [...RPS_CHOICES, ...RPS_CHOICES]) {
      state = commit(state, choice, choice);
    }
    expect(rpsGame.status(state)).toEqual({ kind: "ongoing" });
    expect(state.rounds).toHaveLength(6);
  });
});

describe("turn", () => {
  it("is always null — moves are simultaneous", () => {
    const start = rpsGame.init(0, 2);
    expect(rpsGame.turn(start)).toBeNull();
    const half = must(rpsGame.applyMove(start, "tas", 0));
    expect(rpsGame.turn(half)).toBeNull();
    const done = winRounds(start, 1, ROUNDS_TO_WIN);
    expect(rpsGame.turn(done)).toBeNull();
  });
});

// ── Harness ──────────────────────────────────────────────────────────────────

/** Unwraps a move the scenario needs the reducer to accept. */
function must(state: RpsState | null): RpsState {
  if (!state) throw new Error("expected the move to be accepted");
  return state;
}

/** Commits both choices for one round; throws if the reducer rejects. */
function commit(state: RpsState, zero: RpsChoice, one: RpsChoice): RpsState {
  const half = rpsGame.applyMove(state, zero, 0);
  if (!half) throw new Error("player 0 commit was rejected");
  const full = rpsGame.applyMove(half, one, 1);
  if (!full) throw new Error("player 1 commit was rejected");
  return full;
}

/** Plays `count` rounds that `winner` takes (tas beats makas). */
function winRounds(
  state: RpsState,
  winner: PlayerIndex,
  count: number,
): RpsState {
  let current = state;
  for (let i = 0; i < count; i += 1) {
    current =
      winner === 0
        ? commit(current, "tas", "makas")
        : commit(current, "makas", "tas");
  }
  return current;
}
