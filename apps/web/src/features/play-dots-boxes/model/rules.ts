// Noktalar & Kutular — 5x5 dots (4x4 boxes) on the lockstep contract.
// Players take turns drawing one edge between adjacent dots; drawing the 4th
// wall of a box claims it AND grants another turn (a double-cross move claims
// two boxes at once). When all 16 boxes are claimed the majority wins — an
// 8-8 split is a draw. The game has no randomness, so `init` ignores its
// seed; every seed yields the same empty lattice with player 0 to move.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";

// ── Constants ────────────────────────────────────────────────────────────────

/** Boxes per side — the dot lattice is `(GRID + 1) x (GRID + 1)`. */
export const GRID = 4;
export const DOTS = GRID + 1;

const BOX_COUNT = GRID * GRID;

// ── Game definition ──────────────────────────────────────────────────────────

export const dotsBoxesGame: GameDef<DotsBoxesState, DotsBoxesMove> = {
  meta: {
    id: "noktalar-kutular",
    name: "Noktalar & Kutular",
    icon: "✏️",
    tagline: "Çizgiyi çek, kutuyu kap — kutuyu kapatan bir tur daha oynar.",
    minPlayers: 2,
    maxPlayers: 2,
  },
  playerLabel: (index) => (index === 0 ? "Mavi" : "Kırmızı"),
  init,
  applyMove,
  status,
  turn,
};

// ── Reducer ──────────────────────────────────────────────────────────────────

function init(_seed: number, _playerCount: number): DotsBoxesState {
  return {
    h: emptyOwners(DOTS * GRID),
    v: emptyOwners(GRID * DOTS),
    boxes: emptyOwners(BOX_COUNT),
    turn: 0,
  };
}

function applyMove(
  state: DotsBoxesState,
  move: DotsBoxesMove,
  player: PlayerIndex,
): DotsBoxesState | null {
  if (status(state).kind !== "ongoing") return null;
  if (state.turn !== player) return null;
  if (typeof move !== "object" || move === null) return null;
  if (!isEdge(move)) return null;
  const horizontal = move.dir === "h";
  const index = horizontal
    ? hEdgeIndex(move.row, move.col)
    : vEdgeIndex(move.row, move.col);
  if ((horizontal ? state.h : state.v)[index] !== null) return null;

  const h = horizontal ? withOwner(state.h, index, player) : state.h;
  const v = horizontal ? state.v : withOwner(state.v, index, player);
  const boxes = [...state.boxes];
  let claimed = 0;
  for (const box of touchedBoxes(move)) {
    const target = boxIndex(box.row, box.col);
    if (boxes[target] === null && isBoxClosed(h, v, box.row, box.col)) {
      boxes[target] = player;
      claimed += 1;
    }
  }
  return { h, v, boxes, turn: claimed > 0 ? player : other(player) };
}

function status(state: DotsBoxesState): GameStatus {
  const [first, second] = boxCounts(state);
  if (first + second < BOX_COUNT) return { kind: "ongoing" };
  if (first > second) return { kind: "won", winner: 0 };
  if (second > first) return { kind: "won", winner: 1 };
  return { kind: "draw" };
}

function turn(state: DotsBoxesState): PlayerIndex | null {
  return status(state).kind === "ongoing" ? state.turn : null;
}

// ── Board helpers (shared with ui/board) ─────────────────────────────────────

/** Horizontal edge at dot row `0..GRID`, box column `0..GRID-1`. */
export function hEdgeIndex(row: number, col: number): number {
  return row * GRID + col;
}

/** Vertical edge at box row `0..GRID-1`, dot column `0..GRID`. */
export function vEdgeIndex(row: number, col: number): number {
  return row * DOTS + col;
}

export function boxIndex(row: number, col: number): number {
  return row * GRID + col;
}

/** Claimed-box tally, indexed by player. */
export function boxCounts(state: DotsBoxesState): [number, number] {
  const counts: [number, number] = [0, 0];
  for (const owner of state.boxes) {
    if (owner !== null) counts[owner] += 1;
  }
  return counts;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

function isEdge(move: DotsBoxesMove): boolean {
  if (move.dir !== "h" && move.dir !== "v") return false;
  if (!Number.isInteger(move.row) || !Number.isInteger(move.col)) return false;
  const rows = move.dir === "h" ? DOTS : GRID;
  const cols = move.dir === "h" ? GRID : DOTS;
  return move.row >= 0 && move.row < rows && move.col >= 0 && move.col < cols;
}

/** The one or two boxes an edge is a wall of (perimeter edges touch one). */
function touchedBoxes(move: DotsBoxesMove): { row: number; col: number }[] {
  const boxes: { row: number; col: number }[] = [];
  if (move.dir === "h") {
    if (move.row > 0) boxes.push({ row: move.row - 1, col: move.col });
    if (move.row < GRID) boxes.push({ row: move.row, col: move.col });
  } else {
    if (move.col > 0) boxes.push({ row: move.row, col: move.col - 1 });
    if (move.col < GRID) boxes.push({ row: move.row, col: move.col });
  }
  return boxes;
}

function isBoxClosed(
  h: readonly (PlayerIndex | null)[],
  v: readonly (PlayerIndex | null)[],
  row: number,
  col: number,
): boolean {
  return (
    h[hEdgeIndex(row, col)] !== null &&
    h[hEdgeIndex(row + 1, col)] !== null &&
    v[vEdgeIndex(row, col)] !== null &&
    v[vEdgeIndex(row, col + 1)] !== null
  );
}

// ── Utils ────────────────────────────────────────────────────────────────────

function withOwner(
  owners: readonly (PlayerIndex | null)[],
  index: number,
  player: PlayerIndex,
): (PlayerIndex | null)[] {
  const next = [...owners];
  next[index] = player;
  return next;
}

function emptyOwners(count: number): (PlayerIndex | null)[] {
  return Array.from({ length: count }, () => null);
}

function other(player: PlayerIndex): PlayerIndex {
  return player === 0 ? 1 : 0;
}

// ── Types ────────────────────────────────────────────────────────────────────

export type EdgeDir = "h" | "v";

/** Draw one edge: `"h"` joins dots `(row,col)-(row,col+1)`, `"v"` joins
 * `(row,col)-(row+1,col)`. */
export interface DotsBoxesMove {
  readonly dir: EdgeDir;
  readonly row: number;
  readonly col: number;
}

export interface DotsBoxesState {
  /** Horizontal edges in `hEdgeIndex` order; value = drawer, null = open. */
  readonly h: readonly (PlayerIndex | null)[];
  /** Vertical edges in `vEdgeIndex` order; value = drawer, null = open. */
  readonly v: readonly (PlayerIndex | null)[];
  /** Box owners in `boxIndex` order; null = unclaimed. */
  readonly boxes: readonly (PlayerIndex | null)[];
  readonly turn: PlayerIndex;
}
