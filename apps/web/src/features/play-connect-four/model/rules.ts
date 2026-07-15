// Dört Taş (connect four): 7x6 grid with gravity — a move names a column and
// the disc falls to the deepest empty cell. Four in a row in any direction
// wins; a full grid with no line is a draw. Seat 0 always opens — WHICH human
// sits on seat 0 is the shell's seed-derived decision, so init takes the seed
// for contract symmetry but has no randomness of its own. Pure and
// framework-free: applyMove answers null for every invalid move, never throws.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";

export const connectFourGame: GameDef<ConnectFourState, ConnectFourMove> = {
  meta: {
    id: "dort-tas",
    name: "Dört Taş",
    icon: "🔴",
    tagline: "Dört taşı yan yana ilk getiren kazanır.",
    minPlayers: 2,
    maxPlayers: 2,
  },
  playerLabel: (index) => (index === 0 ? "Mavi" : "Kırmızı"),
  init,
  applyMove,
  status,
  turn,
};

// ── Constants ────────────────────────────────────────────────────────────────

export const COLUMN_COUNT = 7;
export const ROW_COUNT = 6;

const WIN_LENGTH = 4;

/** Line directions as [rowStep, columnStep]: right, down, both diagonals —
 * scanning every cell with these four covers all eight orientations. */
const DIRECTIONS: readonly (readonly [number, number])[] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
];

// ── Rules ────────────────────────────────────────────────────────────────────

function init(_seed: number, _playerCount: number): ConnectFourState {
  return {
    board: Array.from({ length: ROW_COUNT }, () =>
      Array.from({ length: COLUMN_COUNT }, () => null),
    ),
    current: 0,
  };
}

function applyMove(
  state: ConnectFourState,
  move: ConnectFourMove,
  player: PlayerIndex,
): ConnectFourState | null {
  if (turn(state) !== player) return null;
  const column = move.column;
  if (!Number.isInteger(column) || column < 0 || column >= COLUMN_COUNT) {
    return null;
  }
  const row = landingRow(state.board, column);
  if (row === null) return null;
  const board = state.board.map((cells, rowIndex) =>
    rowIndex === row
      ? cells.map((cell, columnIndex) =>
          columnIndex === column ? player : cell,
        )
      : cells,
  );
  return { board, current: other(player) };
}

function status(state: ConnectFourState): GameStatus {
  const winner = findWinner(state.board);
  if (winner !== null) return { kind: "won", winner };
  return state.board.every((row) => row.every((cell) => cell !== null))
    ? { kind: "draw" }
    : { kind: "ongoing" };
}

function turn(state: ConnectFourState): PlayerIndex | null {
  return status(state).kind === "ongoing" ? state.current : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Deepest empty row of the column (gravity), or null when it is full. */
function landingRow(board: Grid, column: number): number | null {
  for (let row = ROW_COUNT - 1; row >= 0; row -= 1) {
    if (board[row][column] === null) return row;
  }
  return null;
}

function findWinner(board: Grid): PlayerIndex | null {
  for (let row = 0; row < ROW_COUNT; row += 1) {
    for (let column = 0; column < COLUMN_COUNT; column += 1) {
      const owner = board[row][column];
      if (owner === null) continue;
      for (const [rowStep, columnStep] of DIRECTIONS) {
        if (lineFrom(board, owner, row, column, rowStep, columnStep)) {
          return owner;
        }
      }
    }
  }
  return null;
}

/** Whether WIN_LENGTH cells starting here along the direction share owner. */
function lineFrom(
  board: Grid,
  owner: PlayerIndex,
  row: number,
  column: number,
  rowStep: number,
  columnStep: number,
): boolean {
  for (let step = 1; step < WIN_LENGTH; step += 1) {
    const r = row + rowStep * step;
    const c = column + columnStep * step;
    if (r < 0 || r >= ROW_COUNT || c < 0 || c >= COLUMN_COUNT) return false;
    if (board[r][c] !== owner) return false;
  }
  return true;
}

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConnectFourState {
  /** board[row][column]; row 0 is the top of the grid, discs land bottom-up. */
  board: readonly (readonly (PlayerIndex | null)[])[];
  /** Seat to move next — seat 0 always opens. */
  current: PlayerIndex;
}

/** Column index 0-6 the disc is dropped into. */
export interface ConnectFourMove {
  column: number;
}

type Grid = ConnectFourState["board"];
