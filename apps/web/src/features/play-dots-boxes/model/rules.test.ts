import { describe, expect, it } from "vitest";
import type { PlayerIndex } from "@/entities/game";
import {
  boxCounts,
  boxIndex,
  DOTS,
  type DotsBoxesMove,
  type DotsBoxesState,
  dotsBoxesGame,
  GRID,
  hEdgeIndex,
  vEdgeIndex,
} from "./rules";

const H_EDGE_COUNT = DOTS * GRID; // 20
const V_EDGE_COUNT = GRID * DOTS; // 20
const BOX_COUNT = GRID * GRID; // 16

describe("init", () => {
  it("starts with an empty lattice and player 0 to move", () => {
    const state = dotsBoxesGame.init(0, 2);
    expect(state.h).toHaveLength(H_EDGE_COUNT);
    expect(state.v).toHaveLength(V_EDGE_COUNT);
    expect(state.boxes).toHaveLength(BOX_COUNT);
    expect(state.h.every((owner) => owner === null)).toBe(true);
    expect(state.v.every((owner) => owner === null)).toBe(true);
    expect(state.boxes.every((owner) => owner === null)).toBe(true);
    expect(dotsBoxesGame.turn(state)).toBe(0);
    expect(dotsBoxesGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("is deterministic — and seed-independent, the game has no randomness", () => {
    expect(dotsBoxesGame.init(7, 2)).toEqual(dotsBoxesGame.init(7, 2));
    expect(dotsBoxesGame.init(7, 2)).toEqual(dotsBoxesGame.init(123, 2));
  });
});

describe("applyMove — drawing edges", () => {
  it("records the drawer and passes the turn on a plain edge", () => {
    const state = apply(dotsBoxesGame.init(0, 2), h(0, 0), 0);
    expect(state.h[hEdgeIndex(0, 0)]).toBe(0);
    expect(dotsBoxesGame.turn(state)).toBe(1);
    expect(boxCounts(state)).toEqual([0, 0]);
  });

  it("keeps horizontal and vertical edges in separate index spaces", () => {
    const afterH = apply(dotsBoxesGame.init(0, 2), h(0, 0), 0);
    const afterV = apply(afterH, v(0, 0), 1);
    expect(afterV.h[hEdgeIndex(0, 0)]).toBe(0);
    expect(afterV.v[vEdgeIndex(0, 0)]).toBe(1);
  });

  it("accepts every perimeter edge without claiming anything", () => {
    for (const move of [h(0, 0), h(GRID, 0), v(0, 0), v(0, GRID)]) {
      const state = apply(dotsBoxesGame.init(0, 2), move, 0);
      expect(boxCounts(state)).toEqual([0, 0]);
    }
  });
});

describe("applyMove — invalid moves return null", () => {
  const state = dotsBoxesGame.init(0, 2);

  it("rejects a move out of turn", () => {
    expect(dotsBoxesGame.applyMove(state, h(0, 0), 1)).toBeNull();
  });

  it("rejects an unknown direction", () => {
    const move = { dir: "x", row: 0, col: 0 } as unknown as DotsBoxesMove;
    expect(dotsBoxesGame.applyMove(state, move, 0)).toBeNull();
  });

  it("rejects out-of-bounds edges", () => {
    for (const move of [
      h(DOTS, 0), // dot row past the lattice
      h(0, GRID), // box column past the lattice
      h(-1, 0),
      h(0, -1),
      v(GRID, 0), // box row past the lattice
      v(0, DOTS), // dot column past the lattice
      v(-1, 0),
      v(0, -1),
    ]) {
      expect(dotsBoxesGame.applyMove(state, move, 0)).toBeNull();
    }
  });

  it("rejects fractional coordinates", () => {
    expect(dotsBoxesGame.applyMove(state, h(0.5, 0), 0)).toBeNull();
    expect(dotsBoxesGame.applyMove(state, v(0, 1.5), 0)).toBeNull();
  });

  it("rejects malformed payloads", () => {
    for (const payload of [null, {}, { dir: "h" }, "h00", 42]) {
      expect(
        dotsBoxesGame.applyMove(state, payload as unknown as DotsBoxesMove, 0),
      ).toBeNull();
    }
  });

  it("rejects redrawing an existing edge", () => {
    const next = apply(state, h(2, 1), 0);
    expect(dotsBoxesGame.applyMove(next, h(2, 1), 1)).toBeNull();
  });

  it("rejects any move after the game is over", () => {
    expect(dotsBoxesGame.applyMove(finishedState(9), h(0, 0), 0)).toBeNull();
  });
});

describe("box claiming", () => {
  it("claims the box on its 4th wall and grants another turn", () => {
    // P0 h(0,0) → P1 h(1,0) → P0 v(0,0) → P1 v(0,1) closes box (0,0).
    const state = playAll(dotsBoxesGame.init(0, 2), [
      h(0, 0),
      h(1, 0),
      v(0, 0),
      v(0, 1),
    ]);
    expect(state.boxes[boxIndex(0, 0)]).toBe(1);
    expect(state.boxes[boxIndex(0, 1)]).toBeNull(); // v(0,1) alone won't close it
    expect(dotsBoxesGame.turn(state)).toBe(1); // claimer goes again
    expect(boxCounts(state)).toEqual([0, 1]);
  });

  it("passes the turn once the claimer draws a plain edge", () => {
    const claimed = playAll(dotsBoxesGame.init(0, 2), [
      h(0, 0),
      h(1, 0),
      v(0, 0),
      v(0, 1),
    ]);
    const state = apply(claimed, h(GRID, GRID - 1), 1);
    expect(dotsBoxesGame.turn(state)).toBe(0);
  });

  it("claims BOTH boxes of a double-cross move and keeps the turn", () => {
    // Walls of boxes (0,0) and (0,1) minus their shared edge v(0,1)…
    const prepared = playAll(dotsBoxesGame.init(0, 2), [
      h(0, 0),
      h(1, 0),
      v(0, 0),
      h(0, 1),
      h(1, 1),
      v(0, 2),
    ]);
    expect(dotsBoxesGame.turn(prepared)).toBe(0);
    // …then the shared edge closes both at once.
    const state = apply(prepared, v(0, 1), 0);
    expect(state.boxes[boxIndex(0, 0)]).toBe(0);
    expect(state.boxes[boxIndex(0, 1)]).toBe(0);
    expect(boxCounts(state)).toEqual([2, 0]);
    expect(dotsBoxesGame.turn(state)).toBe(0);
  });
});

describe("status", () => {
  it("scores a finished board by majority", () => {
    expect(dotsBoxesGame.status(finishedState(9))).toEqual({
      kind: "won",
      winner: 0,
    });
    expect(dotsBoxesGame.status(finishedState(7))).toEqual({
      kind: "won",
      winner: 1,
    });
  });

  it("declares the 8-8 split a draw", () => {
    expect(dotsBoxesGame.status(finishedState(8))).toEqual({ kind: "draw" });
  });

  it("returns a null turn once the game is over", () => {
    expect(dotsBoxesGame.turn(finishedState(9))).toBeNull();
    expect(dotsBoxesGame.turn(finishedState(8))).toBeNull();
  });

  it("tallies claimed boxes per player", () => {
    const state = playAll(dotsBoxesGame.init(0, 2), [
      h(0, 0),
      h(1, 0),
      v(0, 0),
      v(0, 1), // P1 claims box (0,0)
    ]);
    expect(boxCounts(state)).toEqual([0, 1]);
  });
});

describe("full game", () => {
  it("greedy first-open-edge play fills all 40 edges and 16 boxes", () => {
    let state = dotsBoxesGame.init(0, 2);
    let moves = 0;
    while (dotsBoxesGame.status(state).kind === "ongoing") {
      const player = dotsBoxesGame.turn(state);
      if (player === null) throw new Error("ongoing game must have a turn");
      state = apply(state, firstOpenEdge(state), player);
      moves += 1;
      if (moves > H_EDGE_COUNT + V_EDGE_COUNT) {
        throw new Error("game did not terminate");
      }
    }
    expect(moves).toBe(H_EDGE_COUNT + V_EDGE_COUNT);
    const [first, second] = boxCounts(state);
    expect(first + second).toBe(BOX_COUNT);
    const result = dotsBoxesGame.status(state);
    if (first === second) {
      expect(result).toEqual({ kind: "draw" });
    } else {
      expect(result).toEqual({ kind: "won", winner: first > second ? 0 : 1 });
    }
  });
});

describe("purity", () => {
  it("never mutates the input state", () => {
    const state = playAll(dotsBoxesGame.init(0, 2), [h(0, 0), h(1, 0), v(0, 0)]);
    const snapshot = structuredClone(state);
    apply(state, v(0, 1), 1); // claims a box
    apply(state, h(4, 3), 1); // plain edge
    expect(state).toEqual(snapshot);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function h(row: number, col: number): DotsBoxesMove {
  return { dir: "h", row, col };
}

function v(row: number, col: number): DotsBoxesMove {
  return { dir: "v", row, col };
}

function apply(
  state: DotsBoxesState,
  move: DotsBoxesMove,
  player: PlayerIndex,
): DotsBoxesState {
  const next = dotsBoxesGame.applyMove(state, move, player);
  if (next === null) {
    throw new Error(`expected a legal move: ${JSON.stringify(move)}`);
  }
  return next;
}

/** Applies moves in order, each by whoever's turn it currently is. */
function playAll(
  state: DotsBoxesState,
  moves: readonly DotsBoxesMove[],
): DotsBoxesState {
  let current = state;
  for (const move of moves) {
    const player = dotsBoxesGame.turn(current);
    if (player === null) throw new Error("game ended before the script did");
    current = apply(current, move, player);
  }
  return current;
}

function firstOpenEdge(state: DotsBoxesState): DotsBoxesMove {
  for (let row = 0; row <= GRID; row += 1) {
    for (let col = 0; col < GRID; col += 1) {
      if (state.h[hEdgeIndex(row, col)] === null) return h(row, col);
    }
  }
  for (let row = 0; row < GRID; row += 1) {
    for (let col = 0; col <= GRID; col += 1) {
      if (state.v[vEdgeIndex(row, col)] === null) return v(row, col);
    }
  }
  throw new Error("no open edge left");
}

/** A finished board: every edge drawn, boxes split `firstPlayerBoxes` vs rest. */
function finishedState(firstPlayerBoxes: number): DotsBoxesState {
  return {
    h: Array.from({ length: H_EDGE_COUNT }, (): PlayerIndex => 0),
    v: Array.from({ length: V_EDGE_COUNT }, (): PlayerIndex => 0),
    boxes: Array.from(
      { length: BOX_COUNT },
      (_, i): PlayerIndex => (i < firstPlayerBoxes ? 0 : 1),
    ),
    turn: 0,
  };
}
