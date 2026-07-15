// Amiral Battı — classic 10x10 battleship on the lockstep contract. Both
// fleets are AUTO-PLACED from the room seed (player 0 from mulberry32(seed),
// player 1 from mulberry32(seed + 1)), so each client derives BOTH boards and
// computes every hit/miss/sunk locally — friends-play, cheating is out of
// scope per the design. Turns alternate, a hit grants another shot, and the
// first player to sink the whole enemy fleet wins; a draw is impossible.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";
import { mulberry32, pickIndex } from "@/shared/lib/seeded-rng";

// ── Constants ────────────────────────────────────────────────────────────────

export const BOARD_SIZE = 10;

/** Classic fleet, longest first: 5, 4, two 3s and a 2 — 17 cells total. */
export const FLEET_LENGTHS = [5, 4, 3, 3, 2] as const;

// ── Game definition ──────────────────────────────────────────────────────────

export const battleshipGame: GameDef<BattleshipState, BattleshipMove> = {
  meta: {
    id: "amiral-batti",
    name: "Amiral Battı",
    icon: "🚢",
    tagline: "Rakip filoyu bul ve batır; isabet ettiren yeniden atar.",
    minPlayers: 2,
    maxPlayers: 2,
  },
  playerLabel: (index) => (index === 0 ? "Amiral 1" : "Amiral 2"),
  init,
  applyMove,
  status,
  turn,
};

// ── Reducer ──────────────────────────────────────────────────────────────────

function init(seed: number, _playerCount: number): BattleshipState {
  return {
    fleets: [placeFleet(mulberry32(seed)), placeFleet(mulberry32(seed + 1))],
    shots: [[], []],
    turn: 0,
  };
}

function applyMove(
  state: BattleshipState,
  move: BattleshipMove,
  player: PlayerIndex,
): BattleshipState | null {
  if (status(state).kind !== "ongoing") return null;
  if (state.turn !== player) return null;
  if (typeof move !== "object" || move === null) return null;
  if (!isCoordinate(move.x) || !isCoordinate(move.y)) return null;
  const cell = cellIndex(move.x, move.y);
  if (state.shots[player].includes(cell)) return null;
  const enemy = other(player);
  const hit = shipAt(state.fleets[enemy], cell) !== undefined;
  const shots: BattleshipState["shots"] =
    player === 0
      ? [[...state.shots[0], cell], state.shots[1]]
      : [state.shots[0], [...state.shots[1], cell]];
  return { fleets: state.fleets, shots, turn: hit ? player : enemy };
}

function status(state: BattleshipState): GameStatus {
  if (isFleetSunk(state.fleets[1], state.shots[0])) {
    return { kind: "won", winner: 0 };
  }
  if (isFleetSunk(state.fleets[0], state.shots[1])) {
    return { kind: "won", winner: 1 };
  }
  return { kind: "ongoing" };
}

function turn(state: BattleshipState): PlayerIndex | null {
  return status(state).kind === "ongoing" ? state.turn : null;
}

// ── Board helpers (shared with ui/board) ─────────────────────────────────────

export function cellIndex(x: number, y: number): number {
  return y * BOARD_SIZE + x;
}

export function shipAt(fleet: readonly Ship[], cell: number): Ship | undefined {
  return fleet.find((ship) => ship.cells.includes(cell));
}

export function isShipSunk(ship: Ship, shots: readonly number[]): boolean {
  return ship.cells.every((cell) => shots.includes(cell));
}

export function isFleetSunk(
  fleet: readonly Ship[],
  shots: readonly number[],
): boolean {
  return fleet.every((ship) => isShipSunk(ship, shots));
}

// ── Placement (deterministic rejection sampling) ─────────────────────────────

// Ships never overlap but MAY touch. With only 17 occupied cells on a
// 100-cell grid the retry loop terminates fast, and because every roll
// consumes the rng stream identically, both clients land on the same fleet.

function placeFleet(rng: () => number): Ship[] {
  const taken = new Set<number>();
  const fleet: Ship[] = [];
  for (const length of FLEET_LENGTHS) {
    let cells = rollShip(rng, length);
    while (cells.some((cell) => taken.has(cell))) {
      cells = rollShip(rng, length);
    }
    for (const cell of cells) taken.add(cell);
    fleet.push({ cells });
  }
  return fleet;
}

function rollShip(rng: () => number, length: number): number[] {
  const horizontal = rng() < 0.5;
  const x = pickIndex(rng, horizontal ? BOARD_SIZE - length + 1 : BOARD_SIZE);
  const y = pickIndex(rng, horizontal ? BOARD_SIZE : BOARD_SIZE - length + 1);
  return Array.from({ length }, (_, i) =>
    horizontal ? cellIndex(x + i, y) : cellIndex(x, y + i),
  );
}

// ── Utils ────────────────────────────────────────────────────────────────────

function isCoordinate(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < BOARD_SIZE;
}

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

// ── Types ────────────────────────────────────────────────────────────────────

/** One placed ship; `cells` are `cellIndex` values along a straight line. */
export interface Ship {
  readonly cells: readonly number[];
}

export interface BattleshipState {
  /** `fleets[p]` — player p's ships; BOTH derive from the room seed. */
  readonly fleets: readonly [readonly Ship[], readonly Ship[]];
  /** `shots[p]` — cells player p has fired at on the enemy grid, in order. */
  readonly shots: readonly [readonly number[], readonly number[]];
  readonly turn: PlayerIndex;
}

/** A shot at column `x`, row `y` (0-based) of the enemy grid. */
export interface BattleshipMove {
  readonly x: number;
  readonly y: number;
}
