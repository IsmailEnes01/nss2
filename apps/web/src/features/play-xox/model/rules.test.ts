// Reducer tests for XOX: win detection over every line, draw, the
// invalid-move matrix, turn alternation, purity and seed determinism.

import { describe, expect, it } from "vitest";
import type { XoxState } from "./rules";
import { xoxGame } from "./rules";

// ── Constants (evaluated at collection time, so they live above the suites) ──

const WIN_LINES: readonly (readonly number[])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

const ALL_CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8];

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(xoxGame.meta.id).toBe("xox");
    expect(xoxGame.meta.name).toBe("XOX");
    expect(xoxGame.meta.minPlayers).toBe(2);
    expect(xoxGame.meta.maxPlayers).toBe(2);
    expect(xoxGame.playerLabel(0)).toBe("X");
    expect(xoxGame.playerLabel(1)).toBe("O");
  });
});

describe("init", () => {
  it("starts empty with X (seat 0) to move", () => {
    const state = xoxGame.init(1, 2);
    expect(state.board).toHaveLength(9);
    expect(state.board.every((mark) => mark === null)).toBe(true);
    expect(xoxGame.turn(state)).toBe(0);
    expect(xoxGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("is deterministic for the same seed", () => {
    expect(xoxGame.init(42, 2)).toEqual(xoxGame.init(42, 2));
  });

  it("ignores the seed by design — X always opens", () => {
    expect(xoxGame.init(1, 2)).toEqual(xoxGame.init(999, 2));
  });
});

describe("applyMove", () => {
  it("places the mark and hands the turn over", () => {
    const next = xoxGame.applyMove(xoxGame.init(1, 2), { cell: 4 }, 0);
    expect(next?.board[4]).toBe(0);
    expect(next && xoxGame.turn(next)).toBe(1);
  });

  it("alternates seats over a sequence", () => {
    const state = play([0, 1, 2, 3]);
    expect(state.board[0]).toBe(0);
    expect(state.board[1]).toBe(1);
    expect(state.board[2]).toBe(0);
    expect(state.board[3]).toBe(1);
    expect(xoxGame.turn(state)).toBe(0);
  });

  it("does not mutate the previous state", () => {
    const initial = xoxGame.init(1, 2);
    xoxGame.applyMove(initial, { cell: 0 }, 0);
    expect(initial.board.every((mark) => mark === null)).toBe(true);
    expect(initial.current).toBe(0);
  });

  it("rejects a move out of turn", () => {
    expect(xoxGame.applyMove(xoxGame.init(1, 2), { cell: 0 }, 1)).toBeNull();
    const afterOne = play([0]);
    expect(xoxGame.applyMove(afterOne, { cell: 1 }, 0)).toBeNull();
  });

  it("rejects an occupied cell", () => {
    const state = play([4]);
    expect(xoxGame.applyMove(state, { cell: 4 }, 1)).toBeNull();
  });

  it("rejects out-of-bounds and fractional cells", () => {
    const state = xoxGame.init(1, 2);
    expect(xoxGame.applyMove(state, { cell: -1 }, 0)).toBeNull();
    expect(xoxGame.applyMove(state, { cell: 9 }, 0)).toBeNull();
    expect(xoxGame.applyMove(state, { cell: 3.5 }, 0)).toBeNull();
    expect(xoxGame.applyMove(state, { cell: Number.NaN }, 0)).toBeNull();
  });

  it("rejects a non-numeric cell smuggled through a cast", () => {
    const bogus = { cell: "4" } as unknown as { cell: number };
    expect(xoxGame.applyMove(xoxGame.init(1, 2), bogus, 0)).toBeNull();
  });

  it("rejects every move once the game is over", () => {
    const won = play([0, 3, 1, 4, 2]); // X takes the top row
    expect(xoxGame.status(won).kind).toBe("won");
    expect(xoxGame.applyMove(won, { cell: 5 }, 0)).toBeNull();
    expect(xoxGame.applyMove(won, { cell: 5 }, 1)).toBeNull();
  });
});

describe("win detection", () => {
  for (const line of WIN_LINES) {
    it(`finds X's win on line ${line.join("-")}`, () => {
      const state = play(sequenceForLine(line));
      expect(xoxGame.status(state)).toEqual({ kind: "won", winner: 0 });
      expect(xoxGame.turn(state)).toBeNull();
    });
  }

  it("finds O's win too", () => {
    const state = play([1, 0, 2, 4, 5, 8]); // O takes the 0-4-8 diagonal
    expect(xoxGame.status(state)).toEqual({ kind: "won", winner: 1 });
    expect(xoxGame.turn(state)).toBeNull();
  });

  it("stays ongoing mid-game", () => {
    expect(xoxGame.status(play([0, 4, 8]))).toEqual({ kind: "ongoing" });
  });
});

describe("draw", () => {
  it("declares a draw on a full board with no line", () => {
    const state = play([0, 1, 2, 4, 3, 5, 7, 6, 8]);
    expect(xoxGame.status(state)).toEqual({ kind: "draw" });
    expect(xoxGame.turn(state)).toBeNull();
  });

  it("reports the winner, not a draw, when the last cell wins", () => {
    const state = play([0, 3, 1, 4, 5, 8, 6, 7, 2]); // X completes 0-1-2 on move 9
    expect(state.board.every((mark) => mark !== null)).toBe(true);
    expect(xoxGame.status(state)).toEqual({ kind: "won", winner: 0 });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Apply a cell sequence from the opening position, alternating seats via
 * turn() — throws on a rejected move so a broken sequence fails loudly. */
function play(cells: number[]): XoxState {
  let state = xoxGame.init(1, 2);
  for (const cell of cells) {
    const player = xoxGame.turn(state);
    if (player === null) throw new Error(`game already over before ${cell}`);
    const next = xoxGame.applyMove(state, { cell }, player);
    if (next === null) throw new Error(`move rejected at cell ${cell}`);
    state = next;
  }
  return state;
}

/** X claims the line, O fills the first two cells outside it: X wins move 5. */
function sequenceForLine(line: readonly number[]): number[] {
  const fillers = ALL_CELLS.filter((cell) => !line.includes(cell));
  return [line[0], fillers[0], line[1], fillers[1], line[2]];
}
