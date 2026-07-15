import { describe, expect, it } from "vitest";
import type { PlayerIndex } from "@/entities/game";
import {
  BOARD_SIZE,
  type BattleshipMove,
  type BattleshipState,
  battleshipGame,
  FLEET_LENGTHS,
  isFleetSunk,
  isShipSunk,
  type Ship,
  shipAt,
} from "./rules";

const TOTAL_CELLS = BOARD_SIZE * BOARD_SIZE;
const FLEET_CELL_COUNT = 17; // 5 + 4 + 3 + 3 + 2

describe("init", () => {
  it("is deterministic for the same seed", () => {
    expect(battleshipGame.init(42, 2)).toEqual(battleshipGame.init(42, 2));
  });

  it("produces different fleets for different seeds", () => {
    expect(battleshipGame.init(1, 2)).not.toEqual(battleshipGame.init(2, 2));
  });

  it("derives player 1's fleet from seed + 1 (independent streams)", () => {
    expect(battleshipGame.init(5, 2).fleets[1]).toEqual(
      battleshipGame.init(6, 2).fleets[0],
    );
    expect(battleshipGame.init(9, 2).fleets[0]).not.toEqual(
      battleshipGame.init(9, 2).fleets[1],
    );
  });

  it("starts with player 0 and no shots fired", () => {
    const state = battleshipGame.init(3, 2);
    expect(battleshipGame.turn(state)).toBe(0);
    expect(state.shots).toEqual([[], []]);
    expect(battleshipGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("places a classic, straight, in-bounds, non-overlapping fleet for many seeds", () => {
    for (let seed = 0; seed < 25; seed += 1) {
      const state = battleshipGame.init(seed, 2);
      expectValidFleet(state.fleets[0]);
      expectValidFleet(state.fleets[1]);
    }
  });
});

describe("applyMove — invalid moves return null", () => {
  const state = battleshipGame.init(11, 2);

  it("rejects a shot out of turn", () => {
    expect(battleshipGame.applyMove(state, { x: 0, y: 0 }, 1)).toBeNull();
  });

  it("rejects out-of-bounds coordinates", () => {
    for (const move of [
      { x: -1, y: 0 },
      { x: BOARD_SIZE, y: 0 },
      { x: 0, y: -1 },
      { x: 0, y: BOARD_SIZE },
    ]) {
      expect(battleshipGame.applyMove(state, move, 0)).toBeNull();
    }
  });

  it("rejects fractional coordinates", () => {
    expect(battleshipGame.applyMove(state, { x: 0.5, y: 0 }, 0)).toBeNull();
    expect(battleshipGame.applyMove(state, { x: 0, y: 2.5 }, 0)).toBeNull();
  });

  it("rejects malformed payloads", () => {
    for (const payload of [null, {}, { x: 1 }, { x: "3", y: 4 }, "0,0"]) {
      expect(
        battleshipGame.applyMove(
          state,
          payload as unknown as BattleshipMove,
          0,
        ),
      ).toBeNull();
    }
  });

  it("rejects repeating a cell the same player already shot", () => {
    const target = state.fleets[1][0].cells[0];
    const next = apply(state, moveTo(target), 0); // hit — still player 0
    expect(battleshipGame.applyMove(next, moveTo(target), 0)).toBeNull();
  });

  it("rejects any shot after the game is won", () => {
    const finished = sinkEnemyFleet(state, 0);
    const open = missCell(finished, 0);
    expect(battleshipGame.applyMove(finished, moveTo(open), 0)).toBeNull();
    expect(battleshipGame.applyMove(finished, moveTo(open), 1)).toBeNull();
  });
});

describe("turns", () => {
  it("passes the turn on a miss", () => {
    const state = battleshipGame.init(7, 2);
    const next = apply(state, moveTo(missCell(state, 0)), 0);
    expect(battleshipGame.turn(next)).toBe(1);
  });

  it("keeps the turn on a hit (extra shot)", () => {
    const state = battleshipGame.init(7, 2);
    const target = state.fleets[1][2].cells[0];
    const next = apply(state, moveTo(target), 0);
    expect(battleshipGame.turn(next)).toBe(0);
  });

  it("lets both players target the same coordinate independently", () => {
    const state = battleshipGame.init(13, 2);
    const shared = missCell(state, 0);
    const afterMiss = apply(state, moveTo(shared), 0); // turn → 1
    expect(
      battleshipGame.applyMove(afterMiss, moveTo(shared), 1),
    ).not.toBeNull();
  });
});

describe("win detection", () => {
  it("declares player 0 the winner after sinking the whole enemy fleet", () => {
    const state = battleshipGame.init(21, 2);
    const finished = sinkEnemyFleet(state, 0);
    expect(battleshipGame.status(finished)).toEqual({ kind: "won", winner: 0 });
    expect(battleshipGame.turn(finished)).toBeNull();
  });

  it("declares player 1 the winner on the mirrored path", () => {
    const state = battleshipGame.init(21, 2);
    const afterMiss = apply(state, moveTo(missCell(state, 0)), 0);
    const finished = sinkEnemyFleet(afterMiss, 1);
    expect(battleshipGame.status(finished)).toEqual({ kind: "won", winner: 1 });
    expect(battleshipGame.turn(finished)).toBeNull();
  });

  it("stays ongoing while a single enemy cell is still afloat", () => {
    const state = battleshipGame.init(21, 2);
    const almost = sinkEnemyFleet(state, 0, 1);
    expect(battleshipGame.status(almost)).toEqual({ kind: "ongoing" });
    expect(battleshipGame.turn(almost)).toBe(0); // last shot was a hit
  });
});

describe("board helpers", () => {
  const state = battleshipGame.init(31, 2);
  const ship = state.fleets[1][4]; // the length-2 destroyer

  it("shipAt finds the ship occupying a cell and nothing on open water", () => {
    expect(shipAt(state.fleets[1], ship.cells[0])).toBe(ship);
    expect(shipAt(state.fleets[1], missCell(state, 0))).toBeUndefined();
  });

  it("isShipSunk needs every cell of the ship to be shot", () => {
    expect(isShipSunk(ship, [...ship.cells])).toBe(true);
    expect(isShipSunk(ship, [ship.cells[0]])).toBe(false);
  });

  it("isFleetSunk needs every ship down", () => {
    const allCells = fleetCells(state.fleets[1]);
    expect(isFleetSunk(state.fleets[1], allCells)).toBe(true);
    expect(isFleetSunk(state.fleets[1], allCells.slice(1))).toBe(false);
  });
});

describe("purity", () => {
  it("never mutates the input state", () => {
    const state = battleshipGame.init(17, 2);
    const snapshot = structuredClone(state);
    apply(state, moveTo(missCell(state, 0)), 0);
    apply(state, moveTo(state.fleets[1][0].cells[0]), 0);
    expect(state).toEqual(snapshot);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function moveTo(cell: number): BattleshipMove {
  return { x: cell % BOARD_SIZE, y: Math.floor(cell / BOARD_SIZE) };
}

function fleetCells(fleet: readonly Ship[]): number[] {
  return fleet.flatMap((ship) => [...ship.cells]);
}

/** First open-water cell for `player`'s targets — a guaranteed miss. */
function missCell(state: BattleshipState, player: PlayerIndex): number {
  const enemy = player === 0 ? 1 : 0;
  const occupied = new Set(fleetCells(state.fleets[enemy]));
  const fired = new Set(state.shots[player]);
  for (let cell = 0; cell < TOTAL_CELLS; cell += 1) {
    if (!occupied.has(cell) && !fired.has(cell)) return cell;
  }
  throw new Error("no open water left on the board");
}

function apply(
  state: BattleshipState,
  move: BattleshipMove,
  player: PlayerIndex,
): BattleshipState {
  const next = battleshipGame.applyMove(state, move, player);
  if (next === null) {
    throw new Error(`expected a legal move: ${JSON.stringify(move)}`);
  }
  return next;
}

/** Sinks the enemy fleet as `player` (hits keep the turn), minus `skipLast`. */
function sinkEnemyFleet(
  state: BattleshipState,
  player: PlayerIndex,
  skipLast = 0,
): BattleshipState {
  const enemy = player === 0 ? 1 : 0;
  const cells = fleetCells(state.fleets[enemy]);
  const targets = cells.slice(0, cells.length - skipLast);
  let current = state;
  for (const cell of targets) {
    current = apply(current, moveTo(cell), player);
  }
  return current;
}

function expectValidFleet(fleet: readonly Ship[]): void {
  expect(fleet.map((ship) => ship.cells.length)).toEqual([...FLEET_LENGTHS]);
  const cells = fleetCells(fleet);
  expect(new Set(cells).size).toBe(FLEET_CELL_COUNT);
  for (const cell of cells) {
    expect(cell).toBeGreaterThanOrEqual(0);
    expect(cell).toBeLessThan(TOTAL_CELLS);
  }
  for (const ship of fleet) {
    const xs = ship.cells.map((cell) => cell % BOARD_SIZE);
    const ys = ship.cells.map((cell) => Math.floor(cell / BOARD_SIZE));
    const horizontal = ys.every((y) => y === ys[0]);
    const vertical = xs.every((x) => x === xs[0]);
    expect(horizontal || vertical).toBe(true);
    const line = horizontal ? xs : ys;
    for (let i = 1; i < line.length; i += 1) {
      expect(line[i]).toBe(line[0] + i);
    }
  }
}
