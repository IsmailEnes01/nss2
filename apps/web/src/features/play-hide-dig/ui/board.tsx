// Sakla Kazma board: a status row (alive/eliminated per seat), then either
// the current round's interactive grid — hide first, then (as soon as I
// have, with no need to wait for anyone else) dig — a fixed-length reveal
// of the round that just resolved, or the match-over card, followed by
// older rounds' reveals as history. My own hide tile stays marked (to me
// only) once I've dug too, so I don't lose track of it while waiting for
// the round to resolve; nobody else's live pick is ever rendered — the
// only place another seat's pick ever surfaces is a settled round's reveal,
// same trust model as every other game's hidden information.
//
// Two independent client-side timers live here, both mirroring Spektrum
// Çarkı's proven countdown pattern: the round countdown (starts the moment
// the round's first hide, from anyone, lands; proposes `resolveRound` once
// it elapses) and the reveal timer (starts the moment `state.revealing`
// appears; proposes `advanceRound` after `REVEAL_SECONDS`). See that file's
// board for why firing either from every client is safe.
//
// Every grid tile — live or in a reveal — is a fixed pixel size regardless
// of what it's showing. Sizing off the *content* (e.g. relying on
// aspect-ratio interacting with intrinsic emoji/text size) made tiles
// visibly grow the instant they were picked, which read as a layout jump
// rather than a deliberate reveal.

import { useEffect, useRef, useState } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import {
  type HideDigMove,
  type HideDigRoundResult,
  type HideDigState,
  hideDigGame,
  isValidTile,
  REVEAL_SECONDS,
} from "../model/rules";

const LIVE_TILE_PX = 48;
const HISTORY_TILE_PX = 28;

export function HideDigBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<HideDigState, HideDigMove>) {
  const status = hideDigGame.status(state);
  const iAmEliminated = state.eliminated[me];
  const myHideTile = state.hides[me];
  const myDigTile = state.digs[me];

  const hidCount = state.hides.filter(
    (tile, seat) => !state.eliminated[seat] && tile !== null,
  ).length;
  const dugCount = state.digs.filter(
    (tile, seat) => !state.eliminated[seat] && tile !== null,
  ).length;
  const aliveCount = state.eliminated.filter((out) => !out).length;

  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });

  // The round countdown: starts the moment the round's first hide (from
  // ANYONE) lands, fixed until the round resolves — a fresh round always
  // gets its own fresh countdown. Only relevant while not already revealing.
  const anyHideLanded = state.hides.some((tile) => tile !== null);
  const [deadline, setDeadline] = useState<number | null>(null);
  useEffect(() => {
    setDeadline(null);
  }, [state.round]);
  useEffect(() => {
    if (deadline !== null || !anyHideLanded || state.revealing !== null) return;
    setDeadline(Date.now() + state.countdownSeconds * 1000);
  }, [deadline, anyHideLanded, state.countdownSeconds, state.revealing]);
  useEffect(() => {
    if (deadline === null) return;
    const round = state.round;
    const timer = setTimeout(
      () => onMoveRef.current({ t: "resolveRound", round }),
      Math.max(0, deadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [deadline, state.round]);
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

  // The reveal timer: starts the instant `state.revealing` appears for a
  // round, always runs exactly `REVEAL_SECONDS`, then proposes
  // `advanceRound`. Keyed on the revealing round's number (not the object
  // itself) so it only resets when a genuinely new round starts revealing.
  const revealRound = state.revealing?.round ?? null;
  const [revealDeadline, setRevealDeadline] = useState<number | null>(null);
  useEffect(() => {
    setRevealDeadline(revealRound === null ? null : Date.now() + REVEAL_SECONDS * 1000);
  }, [revealRound]);
  useEffect(() => {
    if (revealDeadline === null || revealRound === null) return;
    const round = revealRound;
    const timer = setTimeout(
      () => onMoveRef.current({ t: "advanceRound", round }),
      Math.max(0, revealDeadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [revealDeadline, revealRound]);
  const [revealSecondsLeft, setRevealSecondsLeft] = useState<number | null>(null);
  useEffect(() => {
    if (revealDeadline === null) {
      setRevealSecondsLeft(null);
      return;
    }
    const tick = () =>
      setRevealSecondsLeft(Math.max(0, Math.ceil((revealDeadline - Date.now()) / 1000)));
    tick();
    const interval = setInterval(tick, 250);
    return () => clearInterval(interval);
  }, [revealDeadline]);

  function pickTile(tile: number): void {
    if (!isValidTile(tile, state.gridSize)) return;
    if (myHideTile === null) {
      if (canMove) onMove({ t: "hide", tile });
    } else if (myDigTile === null) {
      if (canMove) onMove({ t: "dig", tile });
    }
  }

  const interactive =
    canMove && !iAmEliminated && myDigTile === null && state.revealing === null;
  const mode: "hide" | "dig" = myHideTile === null ? "hide" : "dig";
  // The currently-revealing round is already shown big below — no need to
  // duplicate it in the small history list too.
  const historyToShow =
    state.revealing !== null ? state.history.slice(0, -1) : state.history;

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <StatusRow state={state} me={me} />

      {state.revealing !== null ? (
        <RevealPanel round={state.revealing} me={me} secondsLeft={revealSecondsLeft} />
      ) : status.kind !== "ongoing" ? (
        <MatchOverCard state={state} me={me} />
      ) : (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">
              Tur {state.round + 1} ({state.gridSize}×{state.gridSize})
            </p>
            {secondsLeft !== null && (
              <Badge variant="outline" className="font-mono">
                ⏱ {secondsLeft} sn
              </Badge>
            )}
          </div>

          {iAmEliminated ? (
            <p className="text-center text-sm text-muted-foreground">
              Elendin — bu turu izliyorsun.
            </p>
          ) : (
            <>
              <p className="text-center text-xs text-muted-foreground">
                {myHideTile === null
                  ? "Saklanacak bir kare seç."
                  : myDigTile === null
                    ? "İstersen hemen kazacak bir kare seç — başkalarını beklemene gerek yok."
                    : "Sakladın ve kazdın — diğer oyuncular bitirsin."}
              </p>
              <GridPicker
                gridSize={state.gridSize}
                myHideTile={myHideTile}
                myDigTile={myDigTile}
                mode={mode}
                interactive={interactive}
                onPick={pickTile}
              />
            </>
          )}

          <p className="text-center text-xs text-muted-foreground">
            Saklandı: {hidCount}/{aliveCount} · Kazıldı: {dugCount}/{aliveCount}
          </p>
        </div>
      )}

      {historyToShow.length > 0 && (
        <RoundHistory history={historyToShow} me={me} />
      )}
    </div>
  );
}

// ── Components ───────────────────────────────────────────────────────────────

function StatusRow({ state, me }: { state: HideDigState; me: PlayerIndex }) {
  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      {Array.from({ length: state.playerCount }, (_, seat) => (
        <span
          key={seat}
          className={cn(
            "flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs shadow-sm",
            seat === me && "border-primary ring-2 ring-primary/30",
            state.eliminated[seat] && "opacity-50",
          )}
        >
          <span className="text-muted-foreground">
            {hideDigGame.playerLabel(seat)}
            {seat === me && " (sen)"}
          </span>
          {state.eliminated[seat] ? (
            <Badge variant="secondary">Elendi</Badge>
          ) : (
            <Badge variant="outline">Hayatta</Badge>
          )}
        </span>
      ))}
    </div>
  );
}

/** The live grid for the round in progress. Every tile is a fixed
 * `LIVE_TILE_PX` square no matter what it's showing — clicking one never
 * changes its own size, only its marker. My own hide tile keeps a faint
 * marker through the dig pick too (a reminder of where I hid); nothing
 * about anyone else's picks ever renders here. */
function GridPicker({
  gridSize,
  myHideTile,
  myDigTile,
  mode,
  interactive,
  onPick,
}: GridPickerProps) {
  const tiles = gridSize * gridSize;
  return (
    <div
      className="mx-auto grid gap-1"
      style={{ gridTemplateColumns: `repeat(${gridSize}, ${LIVE_TILE_PX}px)` }}
    >
      {Array.from({ length: tiles }, (_, tile) => {
        const isMyHide = myHideTile === tile;
        const isMyDig = myDigTile === tile;
        return (
          <button
            key={tile}
            type="button"
            disabled={!interactive}
            onClick={() => onPick(tile)}
            aria-label={`Kare ${tile + 1}`}
            style={{ width: LIVE_TILE_PX, height: LIVE_TILE_PX }}
            className={cn(
              "flex shrink-0 items-center justify-center rounded-md border text-base leading-none transition-colors",
              interactive
                ? "cursor-pointer bg-muted hover:bg-primary/20"
                : "cursor-default bg-muted/50",
              isMyHide && mode === "hide" && "border-primary bg-primary/30",
              isMyHide && mode === "dig" && "border-primary/50 bg-primary/10",
              isMyDig && "border-accent-foreground bg-accent",
            )}
          >
            {isMyDig ? "⛏️" : isMyHide ? "🫥" : ""}
          </button>
        );
      })}
    </div>
  );
}

/** The big, prominent reveal shown for `REVEAL_SECONDS` right after a round
 * resolves — every hidden tile gets a head marker, every dug tile is
 * painted black, and a tile that's BOTH (someone hid there and someone else
 * dug it) shows a red cross instead of the head: that's the tile that took
 * at least one player out this round. */
function RevealPanel({
  round,
  me,
  secondsLeft,
}: {
  round: HideDigRoundResult;
  me: PlayerIndex;
  secondsLeft: number | null;
}) {
  const hiddenTiles = new Set(
    round.hides.filter((tile): tile is number => tile !== null),
  );
  const dugTiles = new Set(
    round.digs.filter((tile): tile is number => tile !== null),
  );
  const tiles = round.gridSize * round.gridSize;

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium">
          Tur {round.round + 1} ({round.gridSize}×{round.gridSize}) — Açılış
        </p>
        {secondsLeft !== null && (
          <Badge variant="outline" className="font-mono">
            ⏱ {secondsLeft} sn
          </Badge>
        )}
      </div>
      <div
        className="mx-auto grid gap-1"
        style={{ gridTemplateColumns: `repeat(${round.gridSize}, ${LIVE_TILE_PX}px)` }}
      >
        {Array.from({ length: tiles }, (_, tile) => {
          const hidden = hiddenTiles.has(tile);
          const dug = dugTiles.has(tile);
          const eliminatesHere = hidden && dug;
          return (
            <div
              key={tile}
              style={{ width: LIVE_TILE_PX, height: LIVE_TILE_PX }}
              className={cn(
                "flex shrink-0 items-center justify-center rounded-md border text-base leading-none",
                dug ? "border-foreground bg-foreground" : "bg-muted/50",
              )}
            >
              {eliminatesHere ? "❌" : !dug && hidden ? "🧑" : ""}
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs">
        {round.eliminated.length === 0 ? (
          <span className="text-muted-foreground">Kimse elenmedi.</span>
        ) : (
          <span>
            Elenenler:{" "}
            {round.eliminated
              .map(
                (seat) =>
                  hideDigGame.playerLabel(seat) + (seat === me ? " (sen)" : ""),
              )
              .join(", ")}
          </span>
        )}
      </p>
    </div>
  );
}

function RoundHistory({
  history,
  me,
}: {
  history: readonly HideDigRoundResult[];
  me: PlayerIndex;
}) {
  return (
    <ol className="flex flex-col gap-3">
      {[...history]
        .map((round, index) => (
          <RoundReveal key={index} round={round} me={me} />
        ))
        .reverse()}
    </ol>
  );
}

function RoundReveal({
  round,
  me,
}: {
  round: HideDigRoundResult;
  me: PlayerIndex;
}) {
  const hiddenTiles = new Set(
    round.hides.filter((tile): tile is number => tile !== null),
  );
  const dugTiles = new Set(
    round.digs.filter((tile): tile is number => tile !== null),
  );
  const tiles = round.gridSize * round.gridSize;

  return (
    <li className="flex flex-col gap-2 rounded-lg border bg-card px-3 py-2 text-sm">
      <p className="text-xs text-muted-foreground">
        Tur {round.round + 1} ({round.gridSize}×{round.gridSize}) sonucu
      </p>
      <div
        className="mx-auto grid gap-1"
        style={{
          gridTemplateColumns: `repeat(${round.gridSize}, ${HISTORY_TILE_PX}px)`,
        }}
      >
        {Array.from({ length: tiles }, (_, tile) => {
          const hidden = hiddenTiles.has(tile);
          const dug = dugTiles.has(tile);
          const eliminatesHere = hidden && dug;
          return (
            <div
              key={tile}
              style={{ width: HISTORY_TILE_PX, height: HISTORY_TILE_PX }}
              className={cn(
                "flex shrink-0 items-center justify-center rounded border text-[0.6rem] leading-none",
                dug ? "border-foreground bg-foreground" : "bg-muted/40",
              )}
            >
              {eliminatesHere ? "❌" : !dug && hidden ? "🧑" : ""}
            </div>
          );
        })}
      </div>
      <p className="text-center text-xs">
        {round.eliminated.length === 0 ? (
          <span className="text-muted-foreground">Kimse elenmedi.</span>
        ) : (
          <span>
            Elenenler:{" "}
            {round.eliminated
              .map(
                (seat) =>
                  hideDigGame.playerLabel(seat) + (seat === me ? " (sen)" : ""),
              )
              .join(", ")}
          </span>
        )}
      </p>
    </li>
  );
}

function MatchOverCard({ state, me }: { state: HideDigState; me: PlayerIndex }) {
  const status = hideDigGame.status(state);
  const lastRound = state.history[state.history.length - 1];
  const drawSeats = lastRound?.eliminated ?? [];

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 text-center">
      <p className="text-lg font-semibold">
        {status.kind === "won"
          ? status.winner === me
            ? "Kazandın! 🎉"
            : `${hideDigGame.playerLabel(status.winner)} kazandı`
          : "Berabere!"}
      </p>
      {status.kind === "draw" && drawSeats.length > 0 && (
        <p className="text-sm text-muted-foreground">
          {drawSeats
            .map((seat) => hideDigGame.playerLabel(seat) + (seat === me ? " (sen)" : ""))
            .join(", ")}{" "}
          aynı turda elendi.
        </p>
      )}
      <StatusRow state={state} me={me} />
    </div>
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

interface GridPickerProps {
  gridSize: number;
  myHideTile: number | null;
  myDigTile: number | null;
  mode: "hide" | "dig";
  interactive: boolean;
  onPick(tile: number): void;
}
