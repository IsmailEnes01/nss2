import type { ReactNode } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import {
  boxCounts,
  boxIndex,
  type DotsBoxesMove,
  type DotsBoxesState,
  dotsBoxesGame,
  type EdgeDir,
  GRID,
  hEdgeIndex,
  vEdgeIndex,
} from "../model/rules";

// The 5x5 dot lattice rendered as a 9x9 CSS grid: narrow tracks hold dots and
// edge thickness, wide tracks hold the boxes. Edges are buttons until drawn,
// then fill with the drawer's color; claimed boxes fill with the owner's
// color. Purely presentational — the only output is `onMove({dir, row, col})`.

export function DotsBoxesBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<DotsBoxesState, DotsBoxesMove>) {
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="flex items-center gap-5 text-sm">
        <ScoreChip player={0} state={state} me={me} />
        <ScoreChip player={1} state={state} me={me} />
      </div>
      <div
        className="grid w-fit rounded-xl border bg-card p-3"
        style={{
          gridTemplateColumns: LATTICE_TRACKS,
          gridTemplateRows: LATTICE_TRACKS,
        }}
      >
        {renderLattice(state, canMove, onMove)}
      </div>
      <p className="text-xs text-muted-foreground">
        Kutuyu kapatan bir tur daha oynar.
      </p>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function EdgeButton({
  dir,
  row,
  col,
  owner,
  canMove,
  onMove,
}: EdgeButtonProps) {
  const orientation = dir === "h" ? "yatay" : "dikey";
  return (
    <button
      type="button"
      aria-label={`${row + 1}. satır ${col + 1}. sütun ${orientation} çizgi`}
      aria-pressed={owner !== null}
      disabled={owner !== null || !canMove}
      onClick={() => onMove({ dir, row, col })}
      className={cn(
        "m-[3px] rounded-full transition-colors",
        owner !== null
          ? PLAYER_SOLID[owner]
          : "bg-border enabled:hover:bg-ring/70 enabled:active:bg-ring disabled:opacity-50",
      )}
    />
  );
}

function BoxCell({ owner }: BoxCellProps) {
  if (owner === null) return <span />;
  return (
    <span
      role="img"
      aria-label={`${dotsBoxesGame.playerLabel(owner)} kutusu`}
      className={cn(
        "m-[3px] flex items-center justify-center rounded-md text-xs font-bold",
        PLAYER_SOFT[owner],
      )}
    >
      {dotsBoxesGame.playerLabel(owner)[0]}
    </span>
  );
}

function ScoreChip({ player, state, me }: ScoreChipProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("size-2.5 rounded-full", PLAYER_SOLID[player])} />
      <span className="font-medium">{dotsBoxesGame.playerLabel(player)}</span>
      {player === me ? (
        <span className="text-muted-foreground">(sen)</span>
      ) : null}
      <span className="font-semibold tabular-nums">
        {boxCounts(state)[player]}
      </span>
    </span>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const LATTICE_TRACKS = `repeat(${GRID}, 1rem 2.75rem) 1rem`;
const PLAYER_SOLID = ["bg-player-one", "bg-player-two"] as const;
const PLAYER_SOFT = [
  "bg-player-one/25 text-player-one",
  "bg-player-two/25 text-player-two",
] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function renderLattice(
  state: DotsBoxesState,
  canMove: boolean,
  onMove: (move: DotsBoxesMove) => void,
): ReactNode[] {
  const cells: ReactNode[] = [];
  for (let row = 0; row <= GRID; row += 1) {
    for (let col = 0; col <= GRID; col += 1) {
      cells.push(
        <span
          key={`dot-${row}-${col}`}
          className="size-2 place-self-center rounded-full bg-foreground/60"
        />,
      );
      if (col < GRID) {
        cells.push(
          <EdgeButton
            key={`h-${row}-${col}`}
            dir="h"
            row={row}
            col={col}
            owner={state.h[hEdgeIndex(row, col)]}
            canMove={canMove}
            onMove={onMove}
          />,
        );
      }
    }
    if (row === GRID) break;
    for (let col = 0; col <= GRID; col += 1) {
      cells.push(
        <EdgeButton
          key={`v-${row}-${col}`}
          dir="v"
          row={row}
          col={col}
          owner={state.v[vEdgeIndex(row, col)]}
          canMove={canMove}
          onMove={onMove}
        />,
      );
      if (col < GRID) {
        cells.push(
          <BoxCell
            key={`box-${row}-${col}`}
            owner={state.boxes[boxIndex(row, col)]}
          />,
        );
      }
    }
  }
  return cells;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface EdgeButtonProps {
  dir: EdgeDir;
  row: number;
  col: number;
  owner: PlayerIndex | null;
  canMove: boolean;
  onMove(move: DotsBoxesMove): void;
}

interface BoxCellProps {
  owner: PlayerIndex | null;
}

interface ScoreChipProps {
  player: PlayerIndex;
  state: DotsBoxesState;
  me: PlayerIndex;
}
