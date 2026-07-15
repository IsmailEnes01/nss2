// Reducer tests for Dört Taş: gravity, win detection in all four directions
// (plus grid-literal edge cases), draw, the invalid-move matrix, turn
// alternation, purity and seed determinism.

import { describe, expect, it } from "vitest";
import type { ConnectFourState } from "./rules";
import { COLUMN_COUNT, connectFourGame, ROW_COUNT } from "./rules";

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(connectFourGame.meta.id).toBe("dort-tas");
    expect(connectFourGame.meta.name).toBe("Dört Taş");
    expect(connectFourGame.meta.minPlayers).toBe(2);
    expect(connectFourGame.meta.maxPlayers).toBe(2);
    expect(connectFourGame.playerLabel(0)).toBe("Mavi");
    expect(connectFourGame.playerLabel(1)).toBe("Kırmızı");
  });
});

describe("init", () => {
  it("starts with an empty 7x6 grid and seat 0 to move", () => {
    const state = connectFourGame.init(1, 2);
    expect(state.board).toHaveLength(ROW_COUNT);
    for (const row of state.board) {
      expect(row).toHaveLength(COLUMN_COUNT);
      expect(row.every((cell) => cell === null)).toBe(true);
    }
    expect(connectFourGame.turn(state)).toBe(0);
    expect(connectFourGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("is deterministic for the same seed", () => {
    expect(connectFourGame.init(42, 2)).toEqual(connectFourGame.init(42, 2));
  });

  it("ignores the seed by design — seat 0 always opens", () => {
    expect(connectFourGame.init(1, 2)).toEqual(connectFourGame.init(999, 2));
  });
});

describe("applyMove", () => {
  it("drops the disc to the bottom of an empty column", () => {
    const next = connectFourGame.applyMove(
      connectFourGame.init(1, 2),
      { column: 3 },
      0,
    );
    expect(next?.board[ROW_COUNT - 1][3]).toBe(0);
    expect(next && connectFourGame.turn(next)).toBe(1);
  });

  it("stacks discs upward in the same column", () => {
    const state = play([3, 3, 3]);
    expect(state.board[5][3]).toBe(0);
    expect(state.board[4][3]).toBe(1);
    expect(state.board[3][3]).toBe(0);
  });

  it("does not mutate the previous state", () => {
    const initial = connectFourGame.init(1, 2);
    connectFourGame.applyMove(initial, { column: 0 }, 0);
    expect(initial.board.every((row) => row.every((c) => c === null))).toBe(
      true,
    );
    expect(initial.current).toBe(0);
  });

  it("rejects a move out of turn", () => {
    expect(
      connectFourGame.applyMove(connectFourGame.init(1, 2), { column: 0 }, 1),
    ).toBeNull();
    const afterOne = play([0]);
    expect(connectFourGame.applyMove(afterOne, { column: 1 }, 0)).toBeNull();
  });

  it("rejects out-of-bounds and fractional columns", () => {
    const state = connectFourGame.init(1, 2);
    expect(connectFourGame.applyMove(state, { column: -1 }, 0)).toBeNull();
    expect(
      connectFourGame.applyMove(state, { column: COLUMN_COUNT }, 0),
    ).toBeNull();
    expect(connectFourGame.applyMove(state, { column: 2.5 }, 0)).toBeNull();
    expect(
      connectFourGame.applyMove(state, { column: Number.NaN }, 0),
    ).toBeNull();
  });

  it("rejects a non-numeric column smuggled through a cast", () => {
    const bogus = { column: "3" } as unknown as { column: number };
    expect(
      connectFourGame.applyMove(connectFourGame.init(1, 2), bogus, 0),
    ).toBeNull();
  });

  it("rejects a drop into a full column", () => {
    const state = play([2, 2, 2, 2, 2, 2]); // six alternating discs, no line
    expect(state.board[0][2]).toBe(1);
    expect(connectFourGame.status(state)).toEqual({ kind: "ongoing" });
    expect(connectFourGame.applyMove(state, { column: 2 }, 0)).toBeNull();
  });

  it("rejects every move once the game is over", () => {
    const won = play([0, 1, 0, 1, 0, 1, 0]); // seat 0 wins column 0
    expect(connectFourGame.status(won).kind).toBe("won");
    expect(connectFourGame.applyMove(won, { column: 3 }, 0)).toBeNull();
    expect(connectFourGame.applyMove(won, { column: 3 }, 1)).toBeNull();
  });
});

describe("win detection", () => {
  it("finds a vertical four", () => {
    const state = play([0, 1, 0, 1, 0, 1, 0]);
    expect(connectFourGame.status(state)).toEqual({ kind: "won", winner: 0 });
    expect(connectFourGame.turn(state)).toBeNull();
  });

  it("finds a horizontal four", () => {
    const state = play([0, 0, 1, 1, 2, 2, 3]);
    expect(connectFourGame.status(state)).toEqual({ kind: "won", winner: 0 });
  });

  it("finds a rising diagonal four", () => {
    const state = play([0, 1, 1, 2, 3, 2, 2, 3, 3, 6, 3]);
    expect(connectFourGame.status(state)).toEqual({ kind: "won", winner: 0 });
  });

  it("finds a falling diagonal four", () => {
    const state = play([3, 2, 2, 1, 1, 0, 1, 0, 0, 6, 0]);
    expect(connectFourGame.status(state)).toEqual({ kind: "won", winner: 0 });
  });

  it("finds seat 1's win too", () => {
    const state = play([0, 6, 1, 6, 0, 6, 1, 6]);
    expect(connectFourGame.status(state)).toEqual({ kind: "won", winner: 1 });
    expect(connectFourGame.turn(state)).toBeNull();
  });

  it("finds a line touching the top-right corner", () => {
    const state = gridOf([
      "...1111",
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
    ]);
    expect(connectFourGame.status(state)).toEqual({ kind: "won", winner: 1 });
  });

  it("does not call three in a row a win", () => {
    const state = gridOf([
      ".......",
      ".......",
      ".......",
      ".......",
      ".......",
      "000.111",
    ]);
    expect(connectFourGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("stays ongoing mid-game", () => {
    expect(connectFourGame.status(play([0, 1, 2]))).toEqual({
      kind: "ongoing",
    });
  });
});

describe("draw", () => {
  it("declares a draw on a full grid with no line", () => {
    // Columns alternate in vertical pairs, offset every other column — no
    // four in any direction anywhere.
    const state = gridOf([
      "0101010",
      "0101010",
      "1010101",
      "1010101",
      "0101010",
      "0101010",
    ]);
    expect(connectFourGame.status(state)).toEqual({ kind: "draw" });
    expect(connectFourGame.turn(state)).toBeNull();
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Apply a column sequence from the opening position, alternating seats via
 * turn() — throws on a rejected move so a broken sequence fails loudly. */
function play(columns: number[]): ConnectFourState {
  let state = connectFourGame.init(1, 2);
  for (const column of columns) {
    const player = connectFourGame.turn(state);
    if (player === null) {
      throw new Error(`game already over before column ${column}`);
    }
    const next = connectFourGame.applyMove(state, { column }, player);
    if (next === null) throw new Error(`move rejected at column ${column}`);
    state = next;
  }
  return state;
}

/** Grid literal, top row first: "0" seat 0, "1" seat 1, "." empty. */
function gridOf(rows: string[]): ConnectFourState {
  if (rows.length !== ROW_COUNT) throw new Error("grid needs 6 rows");
  return {
    board: rows.map((row) => {
      if (row.length !== COLUMN_COUNT) throw new Error("row needs 7 cells");
      return [...row].map((cell) =>
        cell === "0" ? 0 : cell === "1" ? 1 : null,
      );
    }),
    current: 0,
  };
}
