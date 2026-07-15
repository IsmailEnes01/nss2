// XOX (tic-tac-toe): 3x3 grid, win by filling a row, column or diagonal,
// draw on a full board. Seat 0 is always X and X always opens — WHICH human
// sits on seat 0 is the shell's seed-derived decision, so init takes the seed
// for contract symmetry but has no randomness of its own. Pure and
// framework-free: applyMove answers null for every invalid move, never throws.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";

export const xoxGame: GameDef<XoxState, XoxMove> = {
  meta: {
    id: "xox",
    name: "XOX",
    icon: "❌",
    tagline: "Üç işareti ilk hizalayan kazanır.",
    minPlayers: 2,
    maxPlayers: 2,
  },
  playerLabel: (index) => (index === 0 ? "X" : "O"),
  init,
  applyMove,
  status,
  turn,
};

// ── Constants ────────────────────────────────────────────────────────────────

const CELL_COUNT = 9;

/** Every winning line as row-major cell indexes: rows, columns, diagonals. */
const LINES: readonly (readonly [number, number, number])[] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

// ── Rules ────────────────────────────────────────────────────────────────────

function init(_seed: number, _playerCount: number): XoxState {
  return {
    board: Array.from({ length: CELL_COUNT }, () => null),
    current: 0,
  };
}

function applyMove(
  state: XoxState,
  move: XoxMove,
  player: PlayerIndex,
): XoxState | null {
  if (turn(state) !== player) return null;
  const cell = move.cell;
  if (!Number.isInteger(cell) || cell < 0 || cell >= CELL_COUNT) return null;
  if (state.board[cell] !== null) return null;
  const board = state.board.map((mark, index) =>
    index === cell ? player : mark,
  );
  return { board, current: other(player) };
}

function status(state: XoxState): GameStatus {
  for (const [a, b, c] of LINES) {
    const mark = state.board[a];
    if (mark !== null && mark === state.board[b] && mark === state.board[c]) {
      return { kind: "won", winner: mark };
    }
  }
  return state.board.every((mark) => mark !== null)
    ? { kind: "draw" }
    : { kind: "ongoing" };
}

function turn(state: XoxState): PlayerIndex | null {
  return status(state).kind === "ongoing" ? state.current : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface XoxState {
  /** Row-major 3x3 board; a cell holds the mark's owner, null when empty. */
  board: readonly (PlayerIndex | null)[];
  /** Seat to move next — seat 0 is always X and opens the game. */
  current: PlayerIndex;
}

/** Cell index 0-8, row-major (0 is top-left, 8 is bottom-right). */
export interface XoxMove {
  cell: number;
}
