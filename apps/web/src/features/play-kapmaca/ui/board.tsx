// Kapmaca board: a header line (round, countdown, my running score), then
// either the live pot row — where the only claim ever rendered is my own — a
// fixed-length reveal of the round that just settled, or the match-over card,
// with the scoreboard underneath and older rounds as history.
//
// Two client-side timers, both the house pattern (see rules.ts): the round
// countdown, which starts the moment a fresh round appears and proposes
// `resolveRound` when it elapses, and the reveal timer, which proposes
// `advanceRound` after `REVEAL_SECONDS`. Unlike Sakla Kazma the countdown is
// anchored to the round itself rather than to the first pick — every round
// here gets the same shot clock whether anyone acts or not.
//
// Pots are a fixed pixel size regardless of what they're showing, so a pot
// doesn't visibly jump when it goes from empty to claimed to revealed.

import { useEffect, useRef, useState } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { CountdownBadge } from "@/shared/ui/countdown-badge";
import { Panel, PanelTitle } from "@/shared/ui/panel";
import {
  claimedCount,
  isFinished,
  type KapmacaMove,
  type KapmacaRoundResult,
  type KapmacaState,
  kapmacaGame,
  leaders,
  potValue,
  REVEAL_SECONDS,
  standings,
} from "../model/rules";

const POT_PX = 64;
const HISTORY_POT_PX = 34;

export function KapmacaBoard({
  state,
  me,
  canMove,
  onMove,
  names,
}: BoardProps<KapmacaState, KapmacaMove>) {
  const nameOf = (seat: PlayerIndex) =>
    names[seat] ?? kapmacaGame.playerLabel(seat);
  const finished = isFinished(state);
  const myPick = state.picks[me];
  const revealRound = state.revealing?.round ?? null;

  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });

  // Round countdown — reset and restarted whenever the round number changes,
  // so every round gets its own full window.
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    setDeadline(Date.now() + state.countdownSeconds * 1000);
  }, [state.round, state.countdownSeconds]);
  useEffect(() => {
    if (deadline === null || revealRound !== null || finished) return;
    const round = state.round;
    const timer = setTimeout(
      () => onMoveRef.current({ t: "resolveRound", round }),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deadline, revealRound, finished, state.round]);

  // Reveal dwell.
  const [revealDeadline, setRevealDeadline] = useState<number | null>(null);
  useEffect(() => {
    setRevealDeadline(
      revealRound === null ? null : Date.now() + REVEAL_SECONDS * 1000,
    );
  }, [revealRound]);
  useEffect(() => {
    if (revealRound === null || revealDeadline === null) return;
    const timer = setTimeout(
      () => onMoveRef.current({ t: "advanceRound", round: revealRound }),
      Math.max(0, revealDeadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [revealRound, revealDeadline]);

  const [, forceTick] = useState(0);
  useEffect(() => {
    if (finished) return;
    const id = setInterval(() => forceTick((n) => n + 1), 500);
    return () => clearInterval(id);
  }, [finished]);

  const secondsLeft = secondsUntil(revealRound === null ? deadline : revealDeadline);
  const interactive = canMove && myPick === null && revealRound === null && !finished;
  // While a reveal is up, the round it describes is already in `history` —
  // drop it there so it isn't shown twice.
  const olderRounds =
    revealRound === null ? state.history : state.history.slice(0, -1);

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <span className="font-display text-sm font-semibold">
          {finished
            ? "Maç bitti"
            : `${Math.min(state.round + 1, state.totalRounds)}. tur / ${state.totalRounds}`}
        </span>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{state.scores[me]} puan</Badge>
          {!finished && (
            <CountdownBadge seconds={secondsLeft} />
          )}
        </div>
      </div>

      {finished ? (
        <MatchOverCard state={state} me={me} nameOf={nameOf} />
      ) : state.revealing !== null ? (
        <RevealPanel round={state.revealing} me={me} nameOf={nameOf} />
      ) : (
        <Panel>
          <p className="text-sm text-muted-foreground">
            {myPick === null
              ? "Bir kap seç — aynı kaba uzanan başka biri olursa ikiniz de boş kalırsınız."
              : `${potValue(myPick)} numaralı kabı kaptın. Tur bitiyor…`}
          </p>
          <div className="flex flex-wrap gap-2">
            {pots(state.potCount).map((pot) => (
              <button
                key={pot}
                type="button"
                disabled={!interactive}
                aria-label={`${potValue(pot)} puanlık kap`}
                aria-pressed={myPick === pot}
                onClick={() => onMove({ t: "pick", pot })}
                style={{ width: POT_PX, height: POT_PX }}
                className={cn(
                  "flex flex-col items-center justify-center rounded-2xl border font-display text-lg font-semibold transition-colors",
                  myPick === pot
                    ? "border-primary bg-primary/15 text-primary"
                    : "bg-card",
                  interactive && myPick !== pot && "hover:bg-muted",
                  !interactive && myPick !== pot && "opacity-60",
                )}
              >
                <span aria-hidden="true" className="text-base">
                  🍯
                </span>
                {potValue(pot)}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            {claimedCount(state)}/{state.playerCount} oyuncu seçti · seçimler tur
            bitene kadar gizli
          </p>
        </Panel>
      )}

      <Scoreboard state={state} me={me} nameOf={nameOf} />

      {olderRounds.length > 0 && (
        <Panel>
          <PanelTitle>Geçmiş turlar</PanelTitle>
          <div className="flex flex-col gap-3">
            {[...olderRounds].reverse().map((round) => (
              <HistoryRow key={round.round} round={round} me={me} />
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

/** The settled round: every pot with the seats that went for it. A pot two or
 * more seats grabbed is struck out — that's the whole drama of the game, so
 * it gets the loudest treatment on screen. */
function RevealPanel({
  round,
  me,
  nameOf,
}: {
  round: KapmacaRoundResult;
  me: PlayerIndex;
  nameOf(seat: PlayerIndex): string;
}) {
  const gained = round.awarded[me];
  // Did I personally walk into a clash? That's a different kind of zero from
  // "I never picked", and worth reacting to differently.
  const myPot = round.picks[me];
  const iClashed = myPot !== null && round.contestedPots.includes(myPot);
  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <PanelTitle>{round.round + 1}. tur açıldı</PanelTitle>
        <Badge
          variant={gained > 0 ? "default" : "secondary"}
          // Delayed past the pot flips so the verdict lands after the
          // evidence, not alongside it.
          style={{ animationDelay: "450ms" }}
          className={gained > 0 ? "animate-pop" : iClashed ? "animate-shake" : ""}
        >
          {gained > 0 ? `+${gained} puan` : "0 puan"}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-2">
        {round.picks.map((_, pot) => {
          const claimants = round.picks
            .map((pick, seat) => (pick === pot ? seat : -1))
            .filter((seat) => seat >= 0);
          const contested = claimants.length > 1;
          const mine = claimants.includes(me);
          return (
            <div
              key={pot}
              style={{
                minWidth: POT_PX,
                // Pots open left to right rather than all at once, which is
                // what makes the reveal feel dealt instead of switched on.
                // Capped so a 16-pot table still finishes well inside the
                // 5s reveal window.
                animationDelay: `${Math.min(pot * 60, 700)}ms`,
              }}
              className={cn(
                "flex animate-flip flex-col items-center gap-0.5 rounded-2xl border p-2",
                contested
                  ? "border-destructive/50 bg-destructive/10"
                  : claimants.length === 1
                    ? "border-primary/50 bg-primary/10"
                    : "bg-card opacity-60",
                mine && "ring-2 ring-ring/40",
              )}
            >
              <span
                className={cn(
                  "font-display font-semibold",
                  contested && "line-through",
                )}
              >
                {potValue(pot)}
              </span>
              {claimants.length === 0 ? (
                <span className="text-xs text-muted-foreground">boş</span>
              ) : (
                <span className="text-center text-[0.7rem] leading-tight text-muted-foreground">
                  {claimants
                    .map((seat) => (seat === me ? "sen" : nameOf(seat)))
                    .join(", ")}
                </span>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {round.contestedPots.length === 0
          ? "Kimse çakışmadı — herkes kabının puanını aldı."
          : `Çakışan kaplar: ${round.contestedPots
              .map((pot) => potValue(pot))
              .join(", ")} — o kapları seçenler puan almadı.`}
      </p>
    </Panel>
  );
}

/** Compact per-round strip for the history list. */
function HistoryRow({
  round,
  me,
}: {
  round: KapmacaRoundResult;
  me: PlayerIndex;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground">
        {round.round + 1}. tur ·{" "}
        {round.awarded[me] > 0 ? `+${round.awarded[me]}` : "0"} puan aldın
      </span>
      <div className="flex flex-wrap gap-1">
        {round.picks.map((_, pot) => {
          const claimants = round.picks.filter((pick) => pick === pot).length;
          const contested = claimants > 1;
          const minePot = round.picks[me] === pot;
          return (
            <span
              key={pot}
              style={{ width: HISTORY_POT_PX, height: HISTORY_POT_PX }}
              className={cn(
                "flex items-center justify-center rounded-lg border text-xs font-medium",
                contested
                  ? "border-destructive/50 bg-destructive/10 line-through"
                  : claimants === 1
                    ? "border-primary/40 bg-primary/10"
                    : "opacity-50",
                minePot && "ring-2 ring-ring/40",
              )}
            >
              {potValue(pot)}
            </span>
          );
        })}
      </div>
    </div>
  );
}

function Scoreboard({ state, me, nameOf }: NamedProps) {
  const top = leaders(state);
  return (
    <Panel>
      <PanelTitle>Puan durumu</PanelTitle>
      <ul className="flex flex-col gap-1 text-sm">
        {standings(state).map((seat) => (
          <li key={seat} className="flex items-center justify-between gap-2">
            <span className={cn(seat === me && "font-semibold")}>
              {seat === me ? `${nameOf(seat)} (sen)` : nameOf(seat)}
            </span>
            <span className="flex items-center gap-2">
              {top.includes(seat) && state.scores[seat] > 0 && (
                <span aria-label="önde" title="Önde">
                  👑
                </span>
              )}
              <span className="font-mono">{state.scores[seat]}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Final card. `leaders` is the authority on who won, since a tie at the top
 * is a shared win the platform's single-winner status can only call a draw. */
function MatchOverCard({ state, me, nameOf }: NamedProps) {
  const top = leaders(state);
  const iWon = top.includes(me);
  return (
    <Panel>
      <p
        className={cn(
          "text-center font-display text-lg font-semibold",
          // Winning gets the celebratory pop; losing just appears.
          iWon && "animate-pop",
        )}
      >
        {iWon
          ? top.length > 1
            ? "🤝 Berabere — kazananlardan birisin!"
            : "🎉 Kazandın!"
          : top.length > 1
            ? "🤝 Berabere"
            : "Kaybettin"}
      </p>
      <p className="text-center text-sm text-muted-foreground">
        {top.length > 1 ? "Zirveyi paylaşanlar: " : "Kazanan: "}
        {top
          .map((seat) => (seat === me ? "sen" : nameOf(seat)))
          .join(", ")}{" "}
        · {state.scores[top[0]]} puan
      </p>
    </Panel>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────


// ── Helpers ──────────────────────────────────────────────────────────────────

interface NamedProps {
  state: KapmacaState;
  me: PlayerIndex;
  nameOf(seat: PlayerIndex): string;
}

function pots(potCount: number): number[] {
  return Array.from({ length: potCount }, (_, index) => index);
}

function secondsUntil(deadline: number | null): number {
  if (deadline === null) return 0;
  return Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
}
