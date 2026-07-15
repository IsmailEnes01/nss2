// Sayı Tahmini board: the current [low, high] range, a number input for your
// guess, and the running history of everyone's guesses (with a hi/lo/win
// hint per entry). Presentational only — renders `state`, calls `onMove`,
// honors `canMove`. The target itself is only ever shown once the match is
// won (`state.winner !== null`) — same trust model as Amiral Battı's fleets:
// friends play honestly, nothing is cryptographically hidden.

import { useState } from "react";
import type { BoardProps } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import {
  type GuessEntry,
  type NumberGuessMove,
  type NumberGuessState,
  numberGuessGame,
} from "../model/rules";

export function NumberGuessBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<NumberGuessState, NumberGuessMove>) {
  const [draft, setDraft] = useState("");
  const over = state.winner !== null;

  function submit(): void {
    const guess = Number(draft);
    if (!Number.isInteger(guess)) return;
    onMove({ guess });
    setDraft("");
  }

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <div className="flex flex-col items-center gap-1">
        <span className="text-xs text-muted-foreground">
          {over ? "Sayı" : "Kalan aralık"}
        </span>
        <span className="font-mono text-3xl font-bold">
          {over ? state.target : `${state.low} – ${state.high}`}
        </span>
      </div>

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
      >
        <Input
          type="number"
          inputMode="numeric"
          min={state.low}
          max={state.high}
          value={draft}
          disabled={!canMove}
          placeholder={`${state.low}-${state.high}`}
          aria-label="Tahminin"
          className="text-center font-mono text-lg"
          onChange={(event) => setDraft(event.target.value)}
        />
        <Button type="submit" disabled={!canMove || draft.trim() === ""}>
          Tahmin et
        </Button>
      </form>

      {state.history.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {[...state.history]
            .reverse()
            .map((entry, index) => (
              <HistoryRow
                key={state.history.length - 1 - index}
                entry={entry}
                target={over ? state.target : null}
                me={me}
              />
            ))}
        </ol>
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function HistoryRow({ entry, target, me }: HistoryRowProps) {
  const hint =
    target === null
      ? null
      : entry.guess === target
        ? "isabet"
        : entry.guess < target
          ? "düşük"
          : "yüksek";

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border bg-card px-3 py-1.5 text-sm">
      <span className="text-muted-foreground">
        {numberGuessGame.playerLabel(entry.player)}
        {entry.player === me && " (sen)"}
      </span>
      <span className="font-mono font-semibold">{entry.guess}</span>
      {hint !== null && (
        <Badge variant={hint === "isabet" ? "default" : "outline"}>
          {hint}
        </Badge>
      )}
    </li>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface HistoryRowProps {
  entry: GuessEntry;
  /** The revealed target once the match is won, else null (stay silent). */
  target: number | null;
  me: number;
}
