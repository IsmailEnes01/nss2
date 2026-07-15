// Adam Asmaca board: the gallows, the masked word, a Turkish-alphabet
// keyboard, and settled-round summaries. Presentational only — renders
// `state`, calls `onMove`, honors `canMove`. The guesser sees the word
// masked; the owner watches their own word being uncovered; a settled
// round's word is revealed to both in its summary.
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import {
  currentRound,
  guesserOf,
  type HangmanMove,
  type HangmanRound,
  type HangmanState,
  isRoundOver,
  isWordComplete,
  MAX_WRONG,
  roundWinner,
  TURKISH_ALPHABET,
  wrongLetters,
} from "../model/rules";

export function HangmanBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<HangmanState, HangmanMove>) {
  const playing = currentRound(state);
  const over = playing === null;
  const shown = playing ?? 1; // once the match ends, keep the last round up
  const round = state.rounds[shown];
  const amGuesser = guesserOf(shown) === me;
  const wrongCount = wrongLetters(round).length;
  const locked = over || !amGuesser || !canMove;

  return (
    <div className="flex w-full max-w-md flex-col items-center gap-4">
      <div className="flex items-center gap-2">
        <Badge variant="secondary">{shown + 1}. Tur</Badge>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {over
            ? "Maç bitti"
            : amGuesser
              ? canMove
                ? "Sıra sende — bir harf seç"
                : "Bekleniyor…"
              : "Kelimeni rakip tahmin ediyor…"}
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Gallows wrongCount={wrongCount} />
        <div className="flex flex-col items-center gap-1">
          <span className="font-mono text-2xl font-bold">
            {MAX_WRONG - wrongCount}
          </span>
          <span className="text-xs text-muted-foreground">kalan hak</span>
        </div>
      </div>

      <div className="flex max-w-full flex-wrap justify-center gap-1.5">
        {[...round.word].map((letter, index) => {
          const guessed = round.guessed.includes(letter);
          const visible = guessed || !amGuesser || over;
          return (
            <span
              key={`${index}-${letter}`}
              className={cn(
                "flex h-10 w-8 items-center justify-center rounded-md",
                "border font-mono text-lg font-bold",
                guessed ? "bg-card" : "bg-muted text-muted-foreground",
              )}
            >
              {visible ? letter : ""}
            </span>
          );
        })}
      </div>

      <div className="flex max-w-sm flex-wrap justify-center gap-1.5">
        {TURKISH_ALPHABET.map((letter) => {
          const guessed = round.guessed.includes(letter);
          const hit = guessed && round.word.includes(letter);
          return (
            <button
              key={letter}
              type="button"
              disabled={locked || guessed}
              onClick={() => onMove(letter)}
              className={cn(
                "flex size-8 items-center justify-center rounded-md border",
                "bg-card font-mono text-sm font-semibold outline-none",
                "transition-colors focus-visible:border-ring",
                "focus-visible:ring-3 focus-visible:ring-ring/50",
                !guessed &&
                  (locked
                    ? "opacity-50"
                    : "hover:bg-muted active:translate-y-px"),
                hit && "border-transparent bg-primary text-primary-foreground",
                guessed &&
                  !hit &&
                  "border-transparent bg-destructive/10 text-destructive line-through",
              )}
            >
              {letter}
            </button>
          );
        })}
      </div>

      <div className="flex flex-col items-center gap-1">
        {state.rounds.map(
          (settled, index) =>
            isRoundOver(settled) && (
              <RoundSummary
                key={settled.word}
                round={settled}
                index={index === 0 ? 0 : 1}
                me={me}
              />
            ),
        )}
      </div>
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function RoundSummary({ round, index, me }: RoundSummaryProps) {
  const found = isWordComplete(round);
  const mine = roundWinner(round, index) === me;
  return (
    <p className="text-xs text-muted-foreground">
      {index + 1}. tur:{" "}
      <span className="font-mono font-semibold text-foreground">
        {round.word}
      </span>{" "}
      — {found ? "bulundu" : "asıldı"} · {mine ? "sen aldın" : "rakip aldı"} (
      {wrongLetters(round).length} yanlış)
    </p>
  );
}

/** The classic stick figure: scaffold always up, one body part per miss. */
function Gallows({ wrongCount }: { wrongCount: number }) {
  return (
    <svg
      viewBox="0 0 120 140"
      className="h-32 w-28"
      role="img"
      aria-label={`${wrongCount} yanlış tahmin`}
    >
      <g
        className="stroke-muted-foreground"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      >
        <line x1="10" y1="130" x2="110" y2="130" />
        <line x1="30" y1="130" x2="30" y2="15" />
        <line x1="30" y1="15" x2="80" y2="15" />
        <line x1="80" y1="15" x2="80" y2="30" />
      </g>
      <g
        className="stroke-destructive"
        strokeWidth="4"
        strokeLinecap="round"
        fill="none"
      >
        {wrongCount > 0 && <circle cx="80" cy="41" r="11" />}
        {wrongCount > 1 && <line x1="80" y1="52" x2="80" y2="85" />}
        {wrongCount > 2 && <line x1="80" y1="60" x2="65" y2="74" />}
        {wrongCount > 3 && <line x1="80" y1="60" x2="95" y2="74" />}
        {wrongCount > 4 && <line x1="80" y1="85" x2="68" y2="106" />}
        {wrongCount > 5 && <line x1="80" y1="85" x2="92" y2="106" />}
      </g>
    </svg>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface RoundSummaryProps {
  round: HangmanRound;
  index: 0 | 1;
  me: PlayerIndex;
}
