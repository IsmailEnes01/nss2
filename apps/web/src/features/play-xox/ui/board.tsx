// Presentational XOX board: a 3x3 button grid over BoardProps. Renders the
// marks, reports the tapped cell through onMove and freezes itself while
// canMove is false — turns, sockets and status copy all belong to the shell.

import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { type XoxMove, type XoxState, xoxGame } from "../model/rules";

export function XoxBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<XoxState, XoxMove>) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div aria-label="XOX tahtası" className="grid grid-cols-3 gap-2">
        {state.board.map((mark, cell) => (
          <button
            key={cell}
            type="button"
            disabled={!canMove || mark !== null}
            aria-label={cellLabel(cell, mark)}
            onClick={() => onMove({ cell })}
            className={cn(
              "flex size-20 items-center justify-center rounded-xl border bg-card font-mono text-4xl font-bold shadow-sm transition-colors select-none",
              "enabled:hover:bg-muted enabled:active:translate-y-px",
              !canMove && "opacity-60",
              mark === 0 && "text-player-one",
              mark === 1 && "text-player-two",
            )}
          >
            {mark === null ? "" : xoxGame.playerLabel(mark)}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">
        Senin işaretin:{" "}
        <span
          className={cn(
            "font-mono font-bold",
            me === 0 ? "text-player-one" : "text-player-two",
          )}
        >
          {xoxGame.playerLabel(me)}
        </span>
      </p>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function cellLabel(cell: number, mark: PlayerIndex | null): string {
  const position = `${Math.floor(cell / 3) + 1}. satır ${(cell % 3) + 1}. sütun`;
  return mark === null
    ? `${position}: boş`
    : `${position}: ${xoxGame.playerLabel(mark)}`;
}
