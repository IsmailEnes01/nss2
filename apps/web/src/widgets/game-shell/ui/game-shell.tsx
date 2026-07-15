// The whole room experience: nickname gate, auto-join/host of the lobby the
// route already named, the room's two-screen pre-game flow (host picks a
// game from the catalog handed down as `games`, then arranges players in a
// separate settings screen), the live board wired to the lockstep relay,
// turn/status bar, and the rematch / peer-left / connection flows.
// Game-agnostic — receives the full catalog rather than a fixed game,
// resolves the active `ShellGame` from the session's `gameId` once one
// exists (that's also the signal for which of the two pre-game screens to
// show), treats every move as `unknown`, and validates by attempting
// applyMove (null → ignore). Boards stay presentational; the lobby-session
// feature owns the socket. Leaving (explicitly, or bouncing off an error)
// always sends the room back to "/" — the lobby, not this widget, is what
// remembers whether you're hosting or joining. A single ChatPanel stays
// mounted across every live phase (roster, playing, peer-left) — chat has
// no phase of its own, so it's rendered here rather than duplicated inside
// each screen.

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type {
  BoardProps,
  GameDef,
  GameStatus,
  PlayerIndex,
} from "@/entities/game";
import { getNickname, setNickname } from "@/entities/player";
import { useLobbySession } from "@/features/lobby-session";
import type { LobbySessionState } from "@/features/lobby-session";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card, CardContent } from "@/shared/ui/card";
import { Spinner } from "@/shared/ui/spinner";
import type { MatchState } from "../model/use-match";
import { useMatch } from "../model/use-match";
import { ChatPanel } from "./chat-panel";
import {
  GameSelectPanel,
  GameSettingsPanel,
  NicknameGate,
} from "./lobby-panel";

// ── Component ─────────────────────────────────────────────────────────────────

export function GameShell({ code, hostIntent, games }: GameShellProps) {
  const navigate = useNavigate();
  const [nickname, setNicknameState] = useState<string | null>(getNickname);
  const [editingName, setEditingName] = useState(false);
  const [rematchKey, setRematchKey] = useState<object | null>(null);

  const gamesById = useMemo(
    () => new Map(games.map((game) => [game.def.meta.id, game])),
    [games],
  );

  // applyPeerMove is re-derived every render; the ref keeps the socket's
  // side channel pointed at the newest one (its captures are all stable).
  const applyPeerMoveRef = useRef<
    (payload: unknown, from: PlayerIndex) => void
  >(() => undefined);
  const lobby = useLobbySession({
    onPeerMove: (payload, from) => applyPeerMoveRef.current(payload, from),
  });
  const session = lobby.state;

  const selectedGame = resolveSelectedGame(gamesById, session);
  const match = useMatch(selectedGame?.def ?? null, session);
  useEffect(() => {
    applyPeerMoveRef.current = match.applyPeerMove;
  });

  // The route already decided create-vs-join; dial exactly once as soon as a
  // nickname exists. No idle-panel choice lives in this widget anymore.
  const dialedRef = useRef(false);
  useEffect(() => {
    if (nickname === null || dialedRef.current) return;
    if (session.phase !== "idle") return;
    dialedRef.current = true;
    if (hostIntent) {
      lobby.create({ name: nickname, code });
    } else {
      lobby.join({ code, name: nickname });
    }
  }, [nickname, session.phase, lobby, code, hostIntent]);

  function handleMove(move: unknown): void {
    if (match.playMove(move)) lobby.sendMove(move);
  }

  function requestRematch(): void {
    if (match.match === null) return;
    setRematchKey(match.match.key);
    lobby.sendRematch();
  }

  function saveNickname(name: string): void {
    setNickname(name);
    setNicknameState(name);
    setEditingName(false);
  }

  /** Leaving always sends the room back to the home page — there's no
   * in-widget fallback screen to return to anymore. */
  function goHome(): void {
    lobby.leave();
    navigate({ to: "/" });
  }

  /** Host-only, offered on the match screen itself: ends the current match
   * for everyone in the room and drops it back to the game-select screen —
   * clearing the pick (rather than picking a specific one) reuses the exact
   * same pre-game flow instead of a separate in-match picker. Confirmed
   * first since, unlike changing the game before a match starts, this
   * throws away everyone's progress. */
  function changeGameMidMatch(): void {
    const confirmed = window.confirm(
      "Oyunu değiştirmek mevcut oyunu bitirir. Emin misin?",
    );
    if (!confirmed) return;
    lobby.selectGame(null);
  }

  if (nickname === null || editingName) {
    return (
      <NicknameGate
        initialName={nickname ?? ""}
        onSave={saveNickname}
        onCancel={nickname !== null ? () => setEditingName(false) : undefined}
      />
    );
  }

  const rematchRequested =
    match.match !== null && rematchKey === match.match.key;
  // Chat is phase-independent (the DO relays it regardless), so it's shown
  // through every live phase — arranging, mid-match, after a peer leaves —
  // and only hidden while there's no room to chat in yet, or none at all.
  const chatVisible =
    session.phase === "roster" ||
    session.phase === "playing" ||
    session.phase === "peer-left";

  return (
    <div className="flex w-full flex-col items-center gap-6">
      {(session.phase === "idle" || session.phase === "connecting") && (
        <ConnectingCard
          attempt={session.phase === "connecting" ? session.attempt : 0}
        />
      )}

      {session.phase === "roster" &&
        (selectedGame === null ? (
          <GameSelectPanel
            code={session.code}
            games={games}
            members={session.members}
            youId={session.youId}
            onSelectGame={lobby.selectGame}
            onLeave={goHome}
          />
        ) : (
          <GameSettingsPanel
            code={session.code}
            game={selectedGame}
            members={session.members}
            youId={session.youId}
            onAssignRole={lobby.assignRole}
            onRandomize={() =>
              lobby.randomizeRoles(selectedGame.def.meta.maxPlayers)
            }
            onChangeGame={() => lobby.selectGame(null)}
            onStart={lobby.startMatch}
            onLeave={goHome}
          />
        ))}

      {(session.phase === "playing" || session.phase === "peer-left") &&
        selectedGame !== null &&
        match.match !== null && (
          <MatchView
            game={selectedGame}
            session={session}
            match={match.match}
            canMove={match.canMove}
            onMove={handleMove}
            rematchRequested={rematchRequested}
            onRematch={requestRematch}
            onLeave={goHome}
            onChangeGame={changeGameMidMatch}
          />
        )}

      {chatVisible && (
        <ChatPanel messages={lobby.chatMessages} onSend={lobby.sendChat} />
      )}

      {session.phase === "error" && (
        <ErrorCard message={session.message} onBack={goHome} />
      )}
    </div>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

/** Status bar + the game's board + the rematch / peer-left tail. */
function MatchView({
  game,
  session,
  match,
  canMove,
  onMove,
  rematchRequested,
  onRematch,
  onLeave,
  onChangeGame,
}: MatchViewProps) {
  const status = game.def.status(match.state);
  const turn = game.def.turn(match.state);
  const peerLeft = session.phase === "peer-left";
  const finished = status.kind !== "ongoing";
  // Boards render from a fixed 0/1 perspective; a spectator just gets the
  // default one — canMove already keeps them from acting on it.
  const boardMe = match.you ?? 0;

  return (
    <div className="flex w-full flex-col items-center gap-5">
      <StatusBar
        game={game.def}
        names={session.names}
        you={match.you}
        code={session.code}
        status={status}
        turn={turn}
        peerLeft={peerLeft}
        isHost={session.isHost}
        onLeave={onLeave}
        onChangeGame={onChangeGame}
      />

      <game.Board
        state={match.state}
        me={boardMe}
        canMove={canMove}
        onMove={onMove}
      />

      {peerLeft ? (
        <div className="flex flex-col items-center gap-2 text-center">
          <p className="text-sm text-muted-foreground">
            Rakip aynı kodla geri dönerse oyun baştan başlar.
          </p>
          <Button variant="outline" onClick={onLeave}>
            Lobiye dön
          </Button>
        </div>
      ) : (
        finished &&
        match.you !== null && (
          <Button size="lg" onClick={onRematch} disabled={rematchRequested}>
            {rematchRequested && <Spinner />}
            {rematchRequested ? "Başlatılıyor…" : "Tekrar oyna"}
          </Button>
        )
      )}
    </div>
  );
}

/** Lobby code, one chip per active seat (turn highlighted), one status line.
 * Two seats are the common case; a multi-player game just wraps to more. */
function StatusBar({
  game,
  names,
  you,
  code,
  status,
  turn,
  peerLeft,
  isHost,
  onLeave,
  onChangeGame,
}: StatusBarProps) {
  return (
    <div className="flex w-full flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Badge variant="outline" className="font-mono tracking-widest">
          {code}
        </Badge>
        <div className="flex gap-1">
          {isHost && (
            <Button variant="outline" size="xs" onClick={onChangeGame}>
              Oyunu değiştir
            </Button>
          )}
          <Button variant="outline" size="xs" onClick={onLeave}>
            Ayrıl
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-3">
        {names.map((name, index) => (
          <PlayerChip
            key={index}
            name={name}
            label={game.playerLabel(index)}
            index={index}
            isMe={you === index}
            isTurn={!peerLeft && turn === index}
          />
        ))}
      </div>

      <p
        aria-live="polite"
        className={cn(
          "text-center text-sm font-medium",
          peerLeft && "text-destructive",
        )}
      >
        {peerLeft ? "Rakip ayrıldı" : statusText(status, turn, names, you)}
      </p>
    </div>
  );
}

function PlayerChip({ name, label, index, isMe, isTurn }: PlayerChipProps) {
  return (
    <span
      className={cn(
        "flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-sm shadow-sm transition-shadow",
        isTurn && "border-primary ring-2 ring-primary/30",
      )}
    >
      <span
        className={cn(
          "font-mono text-xs font-bold",
          index === 0 && "text-player-one",
          index === 1 && "text-player-two",
        )}
      >
        {label}
      </span>
      <span className="font-medium">{name}</span>
      {isMe && <span className="text-xs text-muted-foreground">(sen)</span>}
    </span>
  );
}

function ConnectingCard({ attempt }: ConnectingCardProps) {
  return (
    <Card className="mx-auto w-full max-w-md">
      <CardContent className="flex items-center justify-center gap-3 py-6">
        <Spinner />
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {attempt === 0
            ? "Bağlanıyor…"
            : `Bağlantı koptu — yeniden deneniyor (${attempt}. deneme)…`}
        </p>
      </CardContent>
    </Card>
  );
}

function ErrorCard({ message, onBack }: ErrorCardProps) {
  return (
    <Card className="mx-auto w-full max-w-md border-destructive/40">
      <CardContent className="flex flex-col items-center gap-4 py-6 text-center">
        <p className="text-lg font-semibold text-destructive">{message}</p>
        <Button variant="outline" onClick={onBack}>
          Ana sayfaya dön
        </Button>
      </CardContent>
    </Card>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** The room's current game, resolved from the session's `gameId` against the
 * catalog handed down as a prop — null before the host has picked one. */
function resolveSelectedGame(
  gamesById: ReadonlyMap<string, ShellGame>,
  session: LobbySessionState,
): ShellGame | null {
  if (session.phase === "roster") {
    return session.gameId !== null
      ? (gamesById.get(session.gameId) ?? null)
      : null;
  }
  if (session.phase === "playing" || session.phase === "peer-left") {
    return gamesById.get(session.gameId) ?? null;
  }
  return null;
}

/** One Turkish line: whose turn, or the result. `you` is null for a
 * spectator — every comparison below is then simply false, falling through
 * to the third-person phrasing. */
function statusText(
  status: GameStatus,
  turn: PlayerIndex | null,
  names: string[],
  you: PlayerIndex | null,
): string {
  if (status.kind === "won") {
    return status.winner === you
      ? "Kazandın! 🎉"
      : `${names[status.winner]} kazandı`;
  }
  if (status.kind === "draw") return "Berabere!";
  if (turn === null) return "Seçimler aynı anda yapılır";
  return turn === you ? "Sıra sende" : `Sıra: ${names[turn]}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** A catalog entry the shell can drive. `Board` is method-typed so concrete
 * `GameDef`/board pairs assign without casts (method parameters compare
 * bivariantly) — the shell only ever feeds it what `applyMove` accepted. */
export interface ShellGame {
  def: GameDef<unknown, unknown>;
  Board(props: BoardProps<unknown, unknown>): ReactNode;
}

export interface GameShellProps {
  /** The lobby code this route names — always present; the route itself
   * decides whether visiting it means hosting or joining. */
  code: string;
  /** True to claim `code` as host on first dial, false to join it as a
   * guest. */
  hostIntent: boolean;
  /** The full game catalog, so the host can pick one from inside the room —
   * passed in rather than imported, since the widget layer can't reach the
   * routes-layer registry. */
  games: readonly ShellGame[];
}

interface MatchViewProps {
  game: ShellGame;
  session: PlaySession;
  match: MatchState;
  canMove: boolean;
  onMove(move: unknown): void;
  rematchRequested: boolean;
  onRematch(): void;
  onLeave(): void;
  /** Host-only: ends the match for everyone and returns to game-select. */
  onChangeGame(): void;
}

interface StatusBarProps {
  game: GameDef<unknown, unknown>;
  names: string[];
  you: PlayerIndex | null;
  code: string;
  status: GameStatus;
  turn: PlayerIndex | null;
  peerLeft: boolean;
  isHost: boolean;
  onLeave(): void;
  onChangeGame(): void;
}

interface PlayerChipProps {
  name: string;
  label: string;
  index: PlayerIndex;
  isMe: boolean;
  isTurn: boolean;
}

interface ConnectingCardProps {
  attempt: number;
}

interface ErrorCardProps {
  message: string;
  onBack(): void;
}

/** The two phases that keep a board on screen. */
type PlaySession = Extract<
  LobbySessionState,
  { phase: "playing" | "peer-left" }
>;
