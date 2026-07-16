// Spektrum Çarkı board: a running score row, the active round (Clue Giver's
// clue-entry view, or the guesser's own private slider), and the settled
// rounds below as history. Presentational only — renders `state`, calls
// `onMove`, honors `canMove`. The hidden target is only ever passed to
// `SpectrumMarkers` from the Clue Giver's own branch (live) or a settled
// round (history, once revealed) — same trust model as Amiral Battı's
// fleets: every client can already compute it from the seed, the board just
// doesn't render it to a guesser mid-round. The countdown timer lives here,
// at the top level, so it runs (and can propose `resolve`) regardless of
// which view — Clue Giver or guesser — is currently rendered; see its doc
// comment further down for why firing it from every client is safe.

import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import type { SpectrumPair } from "../config/spectrums";
import {
  isValidClueWord,
  MAX_CLUE_LENGTH,
  MAX_TARGET,
  midpoint,
  MIN_TARGET,
  type SpectrumMove,
  type SpectrumRound,
  type SpectrumState,
  spectrumGame,
} from "../model/rules";

export function SpectrumBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<SpectrumState, SpectrumMove>) {
  const round = state.current;
  const clueGiver = round === null ? null : state.clueGivers[round];

  const [clueDraft, setClueDraft] = useState("");
  const [guessDraft, setGuessDraft] = useState(midpoint());

  // A leftover drag position from a previous round would be a confusing
  // starting point for a totally different target — snap back every round.
  useEffect(() => {
    setGuessDraft(midpoint());
  }, [round]);

  const guessedCount =
    round === null || clueGiver === null
      ? 0
      : state.guesses.filter((g, seat) => seat !== clueGiver && g !== null)
          .length;
  const totalGuessers = state.score.length - 1;

  // Countdown: starts the moment the first guess of the round lands, fixed
  // for the rest of the round regardless of how many more come in after.
  // Every client (Clue Giver included) runs this same clock and proposes
  // {t:"resolve", round} once its own local deadline passes — the reducer
  // is idempotent about it (see rules.ts), so it doesn't matter whose
  // proposal actually lands first, and a stale one from an already-settled
  // round is a harmless no-op.
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    setDeadline(null); // a new round always starts its own fresh countdown
  }, [round]);
  useEffect(() => {
    if (round === null || deadline !== null || guessedCount === 0) return;
    setDeadline(Date.now() + state.countdownSeconds * 1000);
  }, [round, deadline, guessedCount, state.countdownSeconds]);

  // Latest-ref: the scheduled timeout below only depends on [deadline,
  // round], so it isn't torn down and rebuilt on every unrelated re-render
  // — but it still needs to call whatever `onMove` the *latest* render
  // handed down.
  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });
  useEffect(() => {
    if (deadline === null || round === null) return;
    const timer = setTimeout(
      () => onMoveRef.current({ t: "resolve", round }),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deadline, round]);

  // Ticking display only — the actual resolve is scheduled above.
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (deadline === null) {
      setSecondsLeft(null);
      return;
    }
    const tick = () =>
      setSecondsLeft(Math.max(0, Math.ceil((deadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [deadline]);

  // `onMove` has no way to report back "the reducer rejected that" — a typo
  // like a second word would otherwise clear the draft (looks like it sent)
  // while nothing actually reaches anyone else. Validate with the reducer's
  // own rule first, so an invalid draft never gets submitted in the first
  // place.
  function submitClue(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const text = clueDraft.trim();
    if (!isValidClueWord(text)) return;
    onMove({ t: "clue", text });
    setClueDraft("");
  }

  function submitGuess(): void {
    onMove({ t: "guess", value: guessDraft });
  }

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <ScoreRow score={state.score} me={me} />

      {round === null ? (
        <MatchOverCard state={state} me={me} />
      ) : state.clueGivers[round] === me ? (
        <>
          <RoundNumber current={round} total={state.clueGivers.length} />
          <ClueGiverView
            pair={state.spectrums[round]}
            target={state.targets[round]}
            clue={state.clue}
            draft={clueDraft}
            onDraftChange={setClueDraft}
            onSubmit={submitClue}
            canSubmit={canMove}
            guessedCount={guessedCount}
            totalGuessers={totalGuessers}
            secondsLeft={secondsLeft}
          />
        </>
      ) : (
        <>
          <RoundNumber current={round} total={state.clueGivers.length} />
          <GuesserView
            pair={state.spectrums[round]}
            clue={state.clue}
            myGuess={state.guesses[me]}
            draft={guessDraft}
            onDraftChange={setGuessDraft}
            onLock={submitGuess}
            interactive={canMove && state.guesses[me] === null}
            clueGiverLabel={spectrumGame.playerLabel(state.clueGivers[round])}
            guessedCount={guessedCount}
            totalGuessers={totalGuessers}
            secondsLeft={secondsLeft}
          />
        </>
      )}

      {state.rounds.length > 0 && (
        <RoundHistory rounds={state.rounds} me={me} />
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function ScoreRow({ score, me }: ScoreRowProps) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {score.map((points, seat) => (
        <span
          key={seat}
          className={cn(
            "flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs shadow-sm",
            seat === me && "border-primary ring-2 ring-primary/30",
          )}
        >
          <span className="text-muted-foreground">
            {spectrumGame.playerLabel(seat)}
            {seat === me && " (sen)"}
          </span>
          <span className="font-mono font-semibold">{points}</span>
        </span>
      ))}
    </div>
  );
}

function RoundNumber({ current, total }: RoundNumberProps) {
  return (
    <p className="text-center text-xs text-muted-foreground">
      Tur {current + 1} / {total}
    </p>
  );
}

/** How many guessers are in, and — once at least one is — a ticking
 * countdown to when the round auto-resolves regardless. Shared by both the
 * Clue Giver (who can only watch) and every guesser. */
function GuessProgress({
  guessedCount,
  totalGuessers,
  secondsLeft,
}: GuessProgressProps) {
  return (
    <div className="flex flex-col items-center gap-1">
      <p className="text-xs text-muted-foreground">
        {guessedCount}/{totalGuessers} tahmin yapıldı
      </p>
      {secondsLeft !== null && (
        <Badge variant="outline" className="font-mono">
          ⏱ {secondsLeft} sn
        </Badge>
      )}
    </div>
  );
}

/** The round's Clue Giver: sees the hidden target the whole round (that's
 * how they pick a clue in the first place), types exactly one word once,
 * then watches everyone else's guesses come in without being able to touch
 * anything themselves. */
function ClueGiverView({
  pair,
  target,
  clue,
  draft,
  onDraftChange,
  onSubmit,
  canSubmit,
  guessedCount,
  totalGuessers,
  secondsLeft,
}: ClueGiverViewProps) {
  const draftValid = isValidClueWord(draft.trim());

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="text-center text-sm font-medium">
        Sıra sende — ipucu ver
      </p>
      {/* No guess dots here — everyone's guess is private until the round
       * resolves, even to the Clue Giver. Only the target they already know. */}
      <SpectrumMarkers pair={pair} guesses={[]} target={target} animateTarget={false} />
      {clue === null ? (
        <form onSubmit={onSubmit} className="flex flex-col gap-1.5">
          <div className="flex gap-2">
            <Input
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              maxLength={MAX_CLUE_LENGTH}
              placeholder="Tek kelime…"
              aria-label="İpucun"
              disabled={!canSubmit}
            />
            <Button type="submit" disabled={!canSubmit || !draftValid}>
              Gönder
            </Button>
          </div>
          <p className="text-center text-xs text-muted-foreground">
            Tek kelime, boşluksuz — en fazla {MAX_CLUE_LENGTH} harf.
          </p>
        </form>
      ) : (
        <div className="flex flex-col items-center gap-2">
          <Badge>{clue}</Badge>
          <GuessProgress
            guessedCount={guessedCount}
            totalGuessers={totalGuessers}
            secondsLeft={secondsLeft}
          />
        </div>
      )}
    </div>
  );
}

/** Everyone but this round's Clue Giver: waits for the clue, then drags
 * their own private slider and locks it in — once. The target, and every
 * other guesser's guess, stay hidden until the round resolves. */
function GuesserView({
  pair,
  clue,
  myGuess,
  draft,
  onDraftChange,
  onLock,
  interactive,
  clueGiverLabel,
  guessedCount,
  totalGuessers,
  secondsLeft,
}: GuesserViewProps) {
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      {clue === null ? (
        <p className="text-center text-sm text-muted-foreground">
          {clueGiverLabel} ipucu veriyor…
        </p>
      ) : (
        <>
          <p className="text-center text-sm">
            İpucu: <Badge>{clue}</Badge>
          </p>
          <SpectrumMarkers
            pair={pair}
            guesses={[myGuess ?? draft]}
            target={null}
            animateTarget={false}
          />
          {myGuess === null ? (
            <>
              <input
                type="range"
                min={MIN_TARGET}
                max={MAX_TARGET}
                value={draft}
                disabled={!interactive}
                aria-label="Tahminin"
                onChange={(event) => onDraftChange(Number(event.target.value))}
                className="w-full accent-primary disabled:opacity-50"
              />
              <Button onClick={onLock} disabled={!interactive}>
                Tahmini kilitle
              </Button>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              Tahminin kilitlendi ({myGuess})
            </p>
          )}
          <GuessProgress
            guessedCount={guessedCount}
            totalGuessers={totalGuessers}
            secondsLeft={secondsLeft}
          />
        </>
      )}
    </div>
  );
}

/** The labeled track shared by every view: zero or more live "guess" dots
 * (one for a guesser's own live draft, several for a settled round's
 * reveal), plus an optional "target" marker that fades and scales in on
 * mount when `animateTarget` — the moment a round's hidden point becomes
 * visible to whoever's looking at it. */
function SpectrumMarkers({
  pair,
  guesses,
  target,
  animateTarget,
}: SpectrumMarkersProps) {
  const [targetShown, setTargetShown] = useState(
    target === null || !animateTarget,
  );
  useEffect(() => {
    if (target === null || !animateTarget) return;
    const frame = requestAnimationFrame(() => setTargetShown(true));
    return () => cancelAnimationFrame(frame);
  }, [target, animateTarget]);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{pair.low}</span>
        <span>{pair.high}</span>
      </div>
      <div className="relative h-2 rounded-full bg-muted">
        {guesses.map((value, index) => (
          <span
            key={index}
            aria-hidden="true"
            className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary shadow transition-[left] duration-300"
            style={{ left: `${value}%` }}
          />
        ))}
        {target !== null && (
          <span
            aria-hidden="true"
            className={cn(
              "absolute top-1/2 flex h-5 w-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-accent text-[0.6rem] shadow transition-all duration-500",
              targetShown ? "scale-100 opacity-100" : "scale-50 opacity-0",
            )}
            style={{ left: `${target}%` }}
          >
            🎯
          </span>
        )}
      </div>
    </div>
  );
}

function RoundHistory({ rounds, me }: RoundHistoryProps) {
  return (
    <ol className="flex flex-col gap-2">
      {[...rounds]
        .map((round, index) => (
          <RoundRow
            key={index}
            round={round}
            me={me}
            justRevealed={index === rounds.length - 1}
          />
        ))
        .reverse()}
    </ol>
  );
}

function RoundRow({ round, me, justRevealed }: RoundRowProps) {
  const guessValues = round.guesses.filter(
    (guess): guess is number => guess !== null,
  );

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {spectrumGame.playerLabel(round.clueGiver)}
          {round.clueGiver === me && " (sen)"}
        </span>
        <Badge variant="outline">{round.clue}</Badge>
      </div>
      <SpectrumMarkers
        pair={round.spectrum}
        guesses={guessValues}
        target={round.target}
        animateTarget={justRevealed}
      />
      <ul className="flex flex-col gap-0.5">
        {round.points.map((points, seat) => (
          <li
            key={seat}
            className="flex items-center justify-between text-xs text-muted-foreground"
          >
            <span>
              {spectrumGame.playerLabel(seat)}
              {seat === me && " (sen)"}
              {seat === round.clueGiver
                ? " — ipucu verdi"
                : round.guesses[seat] === null
                  ? " — tahmin yok"
                  : ` — tahmin ${round.guesses[seat]}`}
            </span>
            <span className="font-mono font-medium text-foreground">
              +{points}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}

function MatchOverCard({ state, me }: MatchOverCardProps) {
  const status = spectrumGame.status(state);
  const ranked = state.score
    .map((points, seat) => ({ seat, points }))
    .sort((a, b) => b.points - a.points);

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-center">
      <p className="text-lg font-semibold">
        {status.kind === "won"
          ? status.winner === me
            ? "Kazandın! 🎉"
            : `${spectrumGame.playerLabel(status.winner)} kazandı`
          : "Berabere!"}
      </p>
      <ol className="flex flex-col gap-1">
        {ranked.map(({ seat, points }) => (
          <li
            key={seat}
            className="flex items-center justify-between text-sm"
          >
            <span
              className={
                seat === me ? "font-semibold" : "text-muted-foreground"
              }
            >
              {spectrumGame.playerLabel(seat)}
              {seat === me && " (sen)"}
            </span>
            <span className="font-mono">{points}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface ScoreRowProps {
  score: readonly number[];
  me: PlayerIndex;
}

interface RoundNumberProps {
  current: number;
  total: number;
}

interface GuessProgressProps {
  guessedCount: number;
  totalGuessers: number;
  /** Null before the countdown has started (nobody's guessed yet). */
  secondsLeft: number | null;
}

interface ClueGiverViewProps {
  pair: SpectrumPair;
  target: number;
  clue: string | null;
  draft: string;
  onDraftChange(value: string): void;
  onSubmit(event: FormEvent<HTMLFormElement>): void;
  canSubmit: boolean;
  guessedCount: number;
  totalGuessers: number;
  secondsLeft: number | null;
}

interface GuesserViewProps {
  pair: SpectrumPair;
  clue: string | null;
  /** This seat's own guess, once locked — null while still deciding. */
  myGuess: number | null;
  /** The local, uncommitted slider position — ignored once `myGuess` is set. */
  draft: number;
  onDraftChange(value: number): void;
  onLock(): void;
  interactive: boolean;
  clueGiverLabel: string;
  guessedCount: number;
  totalGuessers: number;
  secondsLeft: number | null;
}

interface SpectrumMarkersProps {
  pair: SpectrumPair;
  /** Zero or more guess positions to render as small dots — empty while
   * nobody's guess should be visible yet (e.g. the Clue Giver's own view). */
  guesses: readonly number[];
  /** Null hides the target marker entirely — a guesser mid-round never gets
   * it. */
  target: number | null;
  /** Fade the target marker in on mount instead of showing it immediately —
   * the "just revealed" moment; false for the Clue Giver's own live view,
   * which has known the target the whole round. */
  animateTarget: boolean;
}

interface RoundHistoryProps {
  rounds: readonly SpectrumRound[];
  me: PlayerIndex;
}

interface RoundRowProps {
  round: SpectrumRound;
  me: PlayerIndex;
  justRevealed: boolean;
}

interface MatchOverCardProps {
  state: SpectrumState;
  me: PlayerIndex;
}
