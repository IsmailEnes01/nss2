// Katil Kim board. Everything hinges on perspective: the same `state` renders
// completely differently depending on `me`, because almost all of it is
// information `me` isn't allowed to have. The rules are the source of truth
// for what's visible — `visibleAllies` and `findingsFor` both take `me` and
// filter there — so this file never reads `state.roles` for any seat other
// than the local one. (That's a discipline, not a guarantee: secrecy here is
// honor-system, see the note at the top of rules.ts.)
//
// Three panels, one per phase:
//   · publicVote — every living seat picks someone to jail, or abstains, all
//     at once; a progress line shows how many ballots are in.
//   · day — strictly one seat at a time, in the seed-fixed order. On my turn
//     I get whatever my role can do; otherwise I'm told who we're waiting on.
//   · night — a fixed-length report of who was removed, no roles attached,
//     then any client's timer proposes moving to the next day (the same
//     idempotent-proposal pattern Sakla Kazma and Spektrum Çarkı use).

import { useEffect, useRef, useState } from "react";
import type { BoardProps, PlayerIndex } from "@/entities/game";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ROLE_INFO, type Role } from "../config/roles";
import {
  awaitingMe,
  findingsFor,
  type KatilKimMove,
  type KatilKimState,
  katilKimGame,
  livingSeats,
  NIGHT_SECONDS,
  publicVoteProgress,
  visibleAllies,
  winningSide,
} from "../model/rules";

export function KatilKimBoard({
  state,
  me,
  canMove,
  onMove,
}: BoardProps<KatilKimState, KatilKimMove>) {
  const status = katilKimGame.status(state);
  const finished = status.kind !== "ongoing";
  const myRole = state.roles[me];
  const iAmAlive = state.alive[me];

  const onMoveRef = useRef(onMove);
  useEffect(() => {
    onMoveRef.current = onMove;
  });

  // Night report dwell: fires from every client, harmlessly — the reducer
  // only accepts the proposal whose `day` matches the report on screen, so
  // whichever arrives first wins and the rest are no-ops.
  const nightDay = state.night?.day ?? null;
  const [nightDeadline, setNightDeadline] = useState<number | null>(null);
  useEffect(() => {
    setNightDeadline(nightDay === null ? null : Date.now() + NIGHT_SECONDS * 1000);
  }, [nightDay]);
  useEffect(() => {
    if (nightDay === null || nightDeadline === null || finished) return;
    const timer = setTimeout(
      () => onMoveRef.current({ t: "advanceNight", day: nightDay }),
      Math.max(0, nightDeadline - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [nightDay, nightDeadline, finished]);
  const nightSecondsLeft =
    nightDeadline === null
      ? 0
      : Math.max(0, Math.ceil((nightDeadline - Date.now()) / 1000));

  const myFindings = findingsFor(state, me);

  return (
    <div className="flex w-full max-w-lg flex-col gap-4">
      <RoleCard state={state} me={me} />

      {finished ? (
        <MatchOverCard state={state} me={me} />
      ) : !iAmAlive ? (
        <Panel>
          <p className="text-center text-sm text-muted-foreground">
            Oyundan çıktın — izlemeye devam edebilirsin.
          </p>
        </Panel>
      ) : state.phase === "night" ? (
        <NightPanel state={state} me={me} secondsLeft={nightSecondsLeft} />
      ) : state.phase === "publicVote" ? (
        <PublicVotePanel
          state={state}
          me={me}
          canMove={canMove}
          onMove={onMove}
        />
      ) : (
        <DayPanel state={state} me={me} canMove={canMove} onMove={onMove} />
      )}

      <SeatList state={state} me={me} />

      {myRole === "detective" && myFindings.length > 0 && (
        <Panel>
          <PanelTitle>Dedektif notların</PanelTitle>
          <ul className="flex flex-col gap-1 text-sm">
            {myFindings.map((finding) => (
              <li
                key={`${finding.day}-${finding.target}`}
                className="flex items-center justify-between gap-2"
              >
                <span className="text-muted-foreground">
                  {finding.day}. gün · {seatName(finding.target)}
                </span>
                <RoleChip role={finding.role} />
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {state.history.length > 0 && <History state={state} />}
    </div>
  );
}

// ── Panels ───────────────────────────────────────────────────────────────────

/** Always on screen: what I am, what that lets me do, and — murderers only —
 * who else is in on it. Dead allies stay listed; knowing one is gone matters. */
function RoleCard({ state, me }: PerspectiveProps) {
  const role = state.roles[me];
  const info = ROLE_INFO[role];
  const allies = visibleAllies(state, me);

  return (
    <div
      className={cn(
        "flex flex-col gap-2 rounded-2xl border p-3",
        info.evil ? "border-destructive/40 bg-destructive/10" : "bg-card",
      )}
    >
      <div className="flex items-center gap-2">
        <span aria-hidden="true" className="text-2xl">
          {info.icon}
        </span>
        <span className="font-display font-semibold">{info.name}</span>
        <Badge variant={info.evil ? "default" : "secondary"} className="ml-auto">
          {info.evil ? "Kötü" : "İyi"}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">{info.blurb}</p>
      {allies.length > 0 && (
        <p className="text-sm">
          <span className="text-muted-foreground">Diğer katiller: </span>
          {allies.map((seat, index) => (
            <span key={seat}>
              {index > 0 && ", "}
              <span className={cn(!state.alive[seat] && "line-through opacity-60")}>
                {seatName(seat)}
              </span>
            </span>
          ))}
        </p>
      )}
    </div>
  );
}

/** The simultaneous morning vote. Everyone living picks a target or abstains;
 * my own ballot is shown back to me once cast, nobody else's ever is. */
function PublicVotePanel({ state, me, canMove, onMove }: ActionProps) {
  const { cast, total } = publicVoteProgress(state);
  const myVote = state.publicVotes[me];
  const pending = awaitingMe(state, me);

  return (
    <Panel>
      <PanelTitle>{state.day}. gün · Kimi hapse atalım?</PanelTitle>
      {pending ? (
        <>
          <TargetGrid
            state={state}
            me={me}
            disabled={!canMove}
            onPick={(target) => onMove({ t: "publicVote", target })}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={!canMove}
            onClick={() => onMove({ t: "publicVote", target: null })}
          >
            Çekimser kal
          </Button>
        </>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          {myVote === null || myVote < 0
            ? "Çekimser kaldın."
            : `Oyun: ${seatName(myVote)}`}{" "}
          Diğerleri bekleniyor…
        </p>
      )}
      <p className="text-center text-xs text-muted-foreground">
        {cast}/{total} oy verildi · eşitlik olursa kimse gitmez
      </p>
    </Panel>
  );
}

/** The turn-based stretch. Only the seat `turn()` names can act, so everyone
 * else gets a "waiting on X" line — deliberately naming the seat, since whose
 * turn it is has to be public for a turn-based game to be playable. */
function DayPanel({ state, me, canMove, onMove }: ActionProps) {
  const actor = katilKimGame.turn(state);
  const mine = actor === me;
  const role = state.roles[me];
  const actedCount = livingSeats(state).filter((seat) => state.acted[seat]).length;
  const total = livingSeats(state).length;

  return (
    <Panel>
      <PanelTitle>
        {state.day}. gün · {mine ? "Sıra sende" : `Sıra: ${seatName(actor ?? me)}`}
      </PanelTitle>

      {!mine ? (
        <p className="text-center text-sm text-muted-foreground">
          {seatName(actor ?? me)} hamlesini yapıyor…
        </p>
      ) : role === "murderer" ? (
        <ActionPrompt label="Kimi öldürmek için oy veriyorsun?">
          <TargetGrid
            state={state}
            me={me}
            disabled={!canMove}
            onPick={(target) => onMove({ t: "killVote", target })}
          />
        </ActionPrompt>
      ) : role === "cop" ? (
        <ActionPrompt label="Kimi hücreye göndermek için oy veriyorsun?">
          <TargetGrid
            state={state}
            me={me}
            disabled={!canMove}
            onPick={(target) => onMove({ t: "cellVote", target })}
          />
        </ActionPrompt>
      ) : role === "detective" ? (
        <ActionPrompt label="Kimin rolünü öğrenmek istiyorsun?">
          <TargetGrid
            state={state}
            me={me}
            disabled={!canMove}
            onPick={(target) => onMove({ t: "investigate", target })}
          />
        </ActionPrompt>
      ) : (
        <p className="text-center text-sm text-muted-foreground">
          Bu turda yapabileceğin bir şey yok.
        </p>
      )}

      {mine && (
        <Button
          variant="outline"
          size="sm"
          disabled={!canMove}
          onClick={() => onMove({ t: "pass" })}
        >
          {role === "citizen" || role === "mayor" ? "Turu bitir" : "Pas geç"}
        </Button>
      )}

      <p className="text-center text-xs text-muted-foreground">
        {actedCount}/{total} oyuncu oynadı
      </p>
    </Panel>
  );
}

/** The night. States who left the game and nothing else — no roles, per the
 * brief, which is the whole reason the report is its own state field rather
 * than something the board derives. */
function NightPanel({
  state,
  me,
  secondsLeft,
}: PerspectiveProps & { secondsLeft: number }) {
  const report = state.night;
  if (report === null) return null;
  const removed = [
    report.jailed !== null && { seat: report.jailed, how: "hapse atıldı" },
    report.killed !== null && { seat: report.killed, how: "öldürüldü" },
    report.celled !== null && { seat: report.celled, how: "hücreye gönderildi" },
  ].filter((entry): entry is { seat: PlayerIndex; how: string } => entry !== false);

  return (
    <Panel>
      <div className="flex items-center justify-between gap-2">
        <PanelTitle>🌙 {report.day}. gecenin sonu</PanelTitle>
        <Badge variant="outline" className="font-mono">
          {secondsLeft} sn
        </Badge>
      </div>
      {removed.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">
          Bu gece kimse oyundan çıkmadı.
        </p>
      ) : (
        <ul className="flex flex-col gap-1 text-sm">
          {removed.map(({ seat, how }) => (
            <li key={`${how}-${seat}`} className="flex items-center gap-2">
              <span aria-hidden="true">☠️</span>
              <span className={cn(seat === me && "font-semibold")}>
                {seat === me ? "Sen" : seatName(seat)}
              </span>
              <span className="text-muted-foreground">{how}.</span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-center text-xs text-muted-foreground">
        Roller açıklanmıyor.
      </p>
    </Panel>
  );
}

/** Final scoreboard — and the only place every role is legitimately shown,
 * since the match is over. Names the winning *side*, because the platform's
 * GameStatus can only carry a single seat (see status() in rules.ts). */
function MatchOverCard({ state, me }: PerspectiveProps) {
  const side = winningSide(state);
  const iWon =
    side !== null && (side === "evil") === ROLE_INFO[state.roles[me]].evil;

  return (
    <Panel>
      <p className="text-center font-display text-lg font-semibold">
        {side === null
          ? "Berabere — kimse ayakta kalmadı."
          : side === "evil"
            ? "🔪 Katiller kazandı!"
            : "🎉 İyiler kazandı!"}
      </p>
      {side !== null && (
        <p className="text-center text-sm text-muted-foreground">
          {iWon ? "Senin tarafın kazandı." : "Senin tarafın kaybetti."}
        </p>
      )}
      <PanelTitle>Roller</PanelTitle>
      <ul className="flex flex-col gap-1 text-sm">
        {state.roles.map((role, seat) => (
          <li
            // biome-ignore lint/suspicious/noArrayIndexKey: seat index *is* the identity
            key={seat}
            className="flex items-center justify-between gap-2"
          >
            <span
              className={cn(
                !state.alive[seat] && "line-through opacity-60",
                seat === me && "font-semibold",
              )}
            >
              {seat === me ? `${seatName(seat)} (sen)` : seatName(seat)}
            </span>
            <RoleChip role={role} />
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ── Pieces ───────────────────────────────────────────────────────────────────

/** Every living seat but mine, as a button grid. The single place a target is
 * ever chosen — all four targeted actions share it, which is also why none of
 * them can accidentally offer self-targeting or a dead seat. */
function TargetGrid({
  state,
  me,
  disabled,
  onPick,
}: {
  state: KatilKimState;
  me: PlayerIndex;
  disabled: boolean;
  onPick(target: PlayerIndex): void;
}) {
  const targets = livingSeats(state).filter((seat) => seat !== me);
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {targets.map((seat) => (
        <Button
          key={seat}
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => onPick(seat)}
        >
          {seatName(seat)}
        </Button>
      ))}
    </div>
  );
}

/** Who's still in, in speaking order — so the turn-based day is followable.
 * Roles are never rendered here; that's the point. */
function SeatList({ state, me }: PerspectiveProps) {
  const actor = katilKimGame.turn(state);
  return (
    <Panel>
      <PanelTitle>Oyuncular ({livingSeats(state).length} hayatta)</PanelTitle>
      <ul className="flex flex-wrap gap-1.5">
        {state.order.map((seat) => (
          <li key={seat}>
            <span
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs",
                !state.alive[seat] && "line-through opacity-50",
                seat === actor && "border-primary bg-primary/10",
                seat === me && "font-semibold",
              )}
            >
              {seat === me ? `${seatName(seat)} (sen)` : seatName(seat)}
              {state.phase === "publicVote" &&
                state.alive[seat] &&
                state.publicVotes[seat] !== null && (
                  <span aria-label="oy verdi" title="Oy verdi">
                    ✓
                  </span>
                )}
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function History({ state }: { state: KatilKimState }) {
  return (
    <Panel>
      <PanelTitle>Geçmiş</PanelTitle>
      <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
        {state.history.map((report) => {
          const gone = [report.jailed, report.killed, report.celled].filter(
            (seat): seat is PlayerIndex => seat !== null,
          );
          return (
            <li key={report.day}>
              {report.day}. gün ·{" "}
              {gone.length === 0
                ? "kimse çıkmadı"
                : gone.map(seatName).join(", ")}
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

function RoleChip({ role }: { role: Role }) {
  const info = ROLE_INFO[role];
  return (
    <Badge variant={info.evil ? "default" : "outline"}>
      <span aria-hidden="true">{info.icon}</span> {info.name}
    </Badge>
  );
}

function ActionPrompt({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border bg-card p-3">
      {children}
    </div>
  );
}

function PanelTitle({ children }: { children: React.ReactNode }) {
  return <p className="font-display text-sm font-semibold">{children}</p>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Boards get seat indices, not nicknames — the shell owns names. Matches
 * `katilKimGame.playerLabel`. */
function seatName(seat: PlayerIndex): string {
  return `Oyuncu ${seat + 1}`;
}

// ── Types ────────────────────────────────────────────────────────────────────

interface PerspectiveProps {
  state: KatilKimState;
  me: PlayerIndex;
}

interface ActionProps extends PerspectiveProps {
  canMove: boolean;
  onMove(move: KatilKimMove): void;
}
