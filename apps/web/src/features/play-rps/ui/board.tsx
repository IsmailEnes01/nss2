// Taş-Kağıt-Makas board: three big commit buttons, the running score, and
// the settled-round history. Presentational only — renders `state`, calls
// `onMove`, honors `canMove`. The opponent's uncommitted choice is never
// rendered: the board reads only its own pending slot and resolved rounds.
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import {
  ROUNDS_TO_WIN,
  RPS_CHOICES,
  type RpsChoice,
  type RpsMove,
  type RpsState,
  rpsGame,
} from "../model/rules";

export function RpsBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<RpsState, RpsMove>) {
  const opponent = me === 0 ? 1 : 0;
  const mine = state.pending[me];
  const over = rpsGame.status(state).kind !== "ongoing";
  const locked = !canMove || mine !== null || over;

  return (
    <div className="flex w-full max-w-md flex-col gap-4">
      <ScoreLine
        me={me}
        mine={state.score[me]}
        theirs={state.score[opponent]}
      />

      <div className="grid grid-cols-3 gap-2">
        {RPS_CHOICES.map((choice) => (
          <button
            key={choice}
            type="button"
            disabled={locked}
            aria-pressed={mine === choice}
            onClick={() => onMove(choice)}
            className={cn(
              "flex flex-col items-center gap-1 rounded-xl border bg-card",
              "py-4 text-card-foreground shadow-sm outline-none transition-all",
              "focus-visible:border-ring focus-visible:ring-3",
              "focus-visible:ring-ring/50",
              mine === choice
                ? "border-primary ring-2 ring-primary/40"
                : locked
                  ? "opacity-50"
                  : "hover:bg-muted active:translate-y-px",
            )}
          >
            <span className="text-3xl" aria-hidden="true">
              {CHOICE_FACES[choice].emoji}
            </span>
            <span className="text-sm font-medium">
              {CHOICE_FACES[choice].label}
            </span>
          </button>
        ))}
      </div>

      <p
        className="text-center text-sm text-muted-foreground"
        aria-live="polite"
      >
        {over
          ? "Maç bitti"
          : mine !== null
            ? "Seçimin gizlendi — rakip bekleniyor…"
            : canMove
              ? "Seçimini yap"
              : "Bekleniyor…"}
      </p>

      {state.rounds.length > 0 && (
        <ol className="flex flex-col gap-1.5">
          {state.rounds
            .map((round, index) => (
              <li
                key={index}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-lg border",
                  "bg-card px-3 py-1.5 text-sm",
                )}
              >
                <span className="text-xs text-muted-foreground">
                  {index + 1}. el
                </span>
                <span className="font-medium">
                  {CHOICE_FACES[round.choices[me]].emoji}{" "}
                  {CHOICE_FACES[round.choices[me]].label}
                  <span className="text-muted-foreground"> — </span>
                  {CHOICE_FACES[round.choices[opponent]].label}{" "}
                  {CHOICE_FACES[round.choices[opponent]].emoji}
                </span>
                {round.winner === null ? (
                  <Badge variant="outline">Berabere</Badge>
                ) : round.winner === me ? (
                  <Badge>Kazandın</Badge>
                ) : (
                  <Badge variant="secondary">Rakip aldı</Badge>
                )}
              </li>
            ))
            .reverse()}
        </ol>
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function ScoreLine({ me, mine, theirs }: ScoreLineProps) {
  const myTone = me === 0 ? "text-player-one" : "text-player-two";
  const theirTone = me === 0 ? "text-player-two" : "text-player-one";
  return (
    <div className="flex items-end justify-center gap-5">
      <div className="flex flex-col items-center">
        <span className="text-xs text-muted-foreground">Sen</span>
        <span className={cn("font-mono text-3xl font-bold", myTone)}>
          {mine}
        </span>
      </div>
      <span className="pb-1.5 text-xs text-muted-foreground">
        ilk {ROUNDS_TO_WIN} galibiyet
      </span>
      <div className="flex flex-col items-center">
        <span className="text-xs text-muted-foreground">Rakip</span>
        <span className={cn("font-mono text-3xl font-bold", theirTone)}>
          {theirs}
        </span>
      </div>
    </div>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const CHOICE_FACES: Record<RpsChoice, { emoji: string; label: string }> = {
  tas: { emoji: "✊", label: "Taş" },
  kagit: { emoji: "✋", label: "Kağıt" },
  makas: { emoji: "✌️", label: "Makas" },
};

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoreLineProps {
  me: PlayerIndex;
  mine: number;
  theirs: number;
}
