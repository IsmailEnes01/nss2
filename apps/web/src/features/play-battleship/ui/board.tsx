import { Fragment, type ReactNode } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import {
  type BattleshipMove,
  type BattleshipState,
  cellIndex,
  isShipSunk,
  shipAt,
} from "../model/rules";

// Two grids side by side: the enemy waters you fire at and your own fleet
// taking their fire. Purely presentational — every hit/miss/sunk mark derives
// from `state` (both fleets come from the shared seed), and the only output
// is `onMove({x, y})`.

export function BattleshipBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<BattleshipState, BattleshipMove>) {
  const enemy: PlayerIndex = me === 0 ? 1 : 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-6 md:flex-row md:items-start">
        <GridFrame title="Rakip suları">
          {(x, y) => (
            <TargetCell
              key={cellIndex(x, y)}
              x={x}
              y={y}
              state={state}
              me={me}
              enemy={enemy}
              canMove={canMove}
              onMove={onMove}
            />
          )}
        </GridFrame>
        <GridFrame title="Filon">
          {(x, y) => (
            <FleetCell
              key={cellIndex(x, y)}
              x={x}
              y={y}
              state={state}
              me={me}
              enemy={enemy}
            />
          )}
        </GridFrame>
      </div>
      <p className="text-xs text-muted-foreground">
        ✕ isabet · • ıska · dolu kare battı — isabet ettirdikçe sıra sende
        kalır.
      </p>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function GridFrame({ title, children }: GridFrameProps) {
  return (
    <section className="flex w-fit flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="grid grid-cols-[1.25rem_repeat(10,1.75rem)] grid-rows-[1.25rem_repeat(10,1.75rem)] gap-px rounded-xl border bg-card p-2">
        <span />
        {AXIS.map((x) => (
          <span key={x} className={AXIS_LABEL_CLASS}>
            {COLUMN_LETTERS[x]}
          </span>
        ))}
        {AXIS.map((y) => (
          <Fragment key={y}>
            <span className={AXIS_LABEL_CLASS}>{y + 1}</span>
            {AXIS.map((x) => children(x, y))}
          </Fragment>
        ))}
      </div>
    </section>
  );
}

function TargetCell({
  x,
  y,
  state,
  me,
  enemy,
  canMove,
  onMove,
}: TargetCellProps) {
  const cell = cellIndex(x, y);
  const myShots = state.shots[me];
  const place = `${COLUMN_LETTERS[x]}${y + 1}`;
  if (!myShots.includes(cell)) {
    return (
      <button
        type="button"
        aria-label={`${place} — ateş et`}
        disabled={!canMove}
        onClick={() => onMove({ x, y })}
        className="rounded-sm bg-muted/60 transition-colors enabled:hover:bg-accent enabled:active:bg-accent/80 disabled:opacity-40"
      />
    );
  }
  const ship = shipAt(state.fleets[enemy], cell);
  if (ship === undefined) {
    return (
      <Mark label={`${place} — ıska`} className="text-muted-foreground">
        •
      </Mark>
    );
  }
  if (isShipSunk(ship, myShots)) {
    return (
      <Mark
        label={`${place} — battı`}
        className="bg-destructive text-background"
      >
        ✕
      </Mark>
    );
  }
  return (
    <Mark
      label={`${place} — isabet`}
      className="bg-destructive/15 text-destructive"
    >
      ✕
    </Mark>
  );
}

function FleetCell({ x, y, state, me, enemy }: FleetCellProps) {
  const cell = cellIndex(x, y);
  const enemyShots = state.shots[enemy];
  const ship = shipAt(state.fleets[me], cell);
  const shot = enemyShots.includes(cell);
  const place = `${COLUMN_LETTERS[x]}${y + 1}`;
  if (ship === undefined) {
    if (shot) {
      return (
        <Mark label={`${place} — ıska`} className="text-muted-foreground">
          •
        </Mark>
      );
    }
    return <span className="rounded-sm bg-muted/40" />;
  }
  if (isShipSunk(ship, enemyShots)) {
    return (
      <Mark
        label={`${place} — battı`}
        className="bg-destructive text-background"
      >
        ✕
      </Mark>
    );
  }
  if (shot) {
    return (
      <Mark
        label={`${place} — isabet aldı`}
        className="bg-destructive/20 text-destructive"
      >
        ✕
      </Mark>
    );
  }
  return (
    <span
      role="img"
      aria-label={`${place} — gemin`}
      className={cn(
        "rounded-sm",
        me === 0 ? "bg-player-one/50" : "bg-player-two/50",
      )}
    />
  );
}

function Mark({ label, className, children }: MarkProps) {
  return (
    <span
      role="img"
      aria-label={label}
      className={cn(
        "flex items-center justify-center rounded-sm bg-muted/60 text-xs font-semibold",
        className,
      )}
    >
      {children}
    </span>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

// The 10x10 board is fixed (BOARD_SIZE), matching the repeat(10, …) tracks.
const AXIS = Array.from({ length: 10 }, (_, i) => i);
const COLUMN_LETTERS = [..."ABCDEFGHIJ"];
const AXIS_LABEL_CLASS =
  "flex items-center justify-center text-[0.65rem] text-muted-foreground";

// ── Types ────────────────────────────────────────────────────────────────────

interface GridFrameProps {
  title: string;
  children(x: number, y: number): ReactNode;
}

interface TargetCellProps {
  x: number;
  y: number;
  state: BattleshipState;
  me: PlayerIndex;
  enemy: PlayerIndex;
  canMove: boolean;
  onMove(move: BattleshipMove): void;
}

interface FleetCellProps {
  x: number;
  y: number;
  state: BattleshipState;
  me: PlayerIndex;
  enemy: PlayerIndex;
}

interface MarkProps {
  label: string;
  className?: string;
  children: ReactNode;
}
