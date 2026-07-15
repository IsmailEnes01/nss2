// Presentational Dört Taş board: seven tappable column buttons, each showing
// its six cells top to bottom. A tap drops a disc into that column via
// onMove; the board freezes itself while canMove is false — turns, sockets
// and status copy all belong to the shell.

import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import {
  COLUMN_COUNT,
  type ConnectFourMove,
  type ConnectFourState,
  connectFourGame,
} from "../model/rules";

export function ConnectFourBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<ConnectFourState, ConnectFourMove>) {
  return (
    <div className="flex flex-col items-center gap-3">
      <div
        aria-label="Dört Taş tahtası"
        className="flex gap-1 rounded-2xl border bg-card p-2 shadow-sm"
      >
        {columns().map((column) => {
          const full = state.board[0][column] !== null;
          return (
            <button
              key={column}
              type="button"
              disabled={!canMove || full}
              aria-label={columnLabel(column, full)}
              onClick={() => onMove({ column })}
              className={cn(
                "flex flex-col gap-1.5 rounded-xl p-1 transition-colors",
                "enabled:hover:bg-muted enabled:active:translate-y-px",
                !canMove && "opacity-60",
              )}
            >
              {state.board.map((row, rowIndex) => (
                <Disc key={rowIndex} owner={row[column]} />
              ))}
            </button>
          );
        })}
      </div>
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        Senin rengin:
        <span
          className={cn(
            "size-3.5 rounded-full",
            me === 0 ? "bg-player-one" : "bg-player-two",
          )}
        />
        <span className="font-medium text-foreground">
          {connectFourGame.playerLabel(me)}
        </span>
      </p>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function Disc({ owner }: { owner: PlayerIndex | null }) {
  return (
    <span
      className={cn(
        "size-9 rounded-full border sm:size-10",
        owner === null && "bg-background",
        owner === 0 && "border-transparent bg-player-one",
        owner === 1 && "border-transparent bg-player-two",
      )}
    />
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function columns(): number[] {
  return Array.from({ length: COLUMN_COUNT }, (_, column) => column);
}

function columnLabel(column: number, full: boolean): string {
  return full ? `${column + 1}. sütun dolu` : `${column + 1}. sütuna taş bırak`;
}
