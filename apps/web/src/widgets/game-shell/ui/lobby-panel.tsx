// Pre-game panels: the nickname gate, the home page's create/join panel, and
// the room's two-screen pre-game flow. Screen 1 (GameSelectPanel) is just
// "who's here + host picks a game" — no roles exist yet. Once the host
// picks one, the whole room (up to 16 people) advances to screen 2
// (GameSettingsPanel), where the host sorts people into "playing"/
// "spectator" and starts the match; most games need exactly 2 playing, some
// allow more. All presentational with local form state only — the caller
// owns the session.

import { useEffect, useState } from "react";
import { isValidLobbyCode, LOBBY_CODE_LENGTH } from "@/shared/lib/lobby-code";
import type { Role, RosterMember } from "@/shared/lib/lobby-protocol";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import type { ShellGame } from "./game-shell";

// ── Components ────────────────────────────────────────────────────────────────

/** First-visit (or "Değiştir") prompt — the nickname rides the WS URL. */
export function NicknameGate({
  initialName,
  onSave,
  onCancel,
}: NicknameGateProps) {
  const [name, setName] = useState(initialName);
  const trimmed = name.trim();

  return (
    <Card className="mx-auto w-full max-w-sm">
      <CardHeader className="items-center text-center">
        <CardTitle className="text-lg">Takma adını seç</CardTitle>
        <CardDescription>Rakibin seni bu adla görecek.</CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (trimmed !== "") onSave(trimmed);
          }}
        >
          <Input
            autoFocus
            value={name}
            maxLength={20}
            placeholder="ör. Ayşe"
            aria-label="Takma ad"
            onChange={(event) => setName(event.target.value)}
          />
          <div className="flex gap-2">
            <Button
              type="submit"
              size="lg"
              className="flex-1"
              disabled={trimmed === ""}
            >
              Devam
            </Button>
            {onCancel !== undefined && (
              <Button
                type="button"
                variant="ghost"
                size="lg"
                onClick={onCancel}
              >
                Vazgeç
              </Button>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

/** Create-or-join: "Lobi kur" mints a code, "Koda katıl" dials a shared one. */
export function LobbyPanel({
  nickname,
  initialCode,
  onEditNickname,
  onCreate,
  onJoin,
}: LobbyPanelProps) {
  const [code, setCode] = useState(initialCode ?? "");
  const normalized = code.trim().toUpperCase();

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-4">
      <p className="text-center text-sm text-muted-foreground">
        Takma adın:{" "}
        <span className="font-medium text-foreground">{nickname}</span>{" "}
        <Button variant="outline" size="xs" onClick={onEditNickname}>
          Değiştir
        </Button>
      </p>

      <Card>
        <CardHeader>
          <CardTitle>Lobi kur</CardTitle>
          <CardDescription>
            Sana 4 harflik bir kod verelim — 16 kişiye kadar katılabilir,
            takımları sen ayarlarsın.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button size="lg" className="w-full" onClick={onCreate}>
            Lobi kur
          </Button>
        </CardContent>
      </Card>

      <div
        aria-hidden="true"
        className="flex items-center gap-3 text-xs text-muted-foreground"
      >
        <span className="h-px flex-1 bg-border" />
        veya
        <span className="h-px flex-1 bg-border" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Koda katıl</CardTitle>
          <CardDescription>
            Arkadaşının paylaştığı 4 harflik kodu gir.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (isValidLobbyCode(normalized)) onJoin(normalized);
            }}
          >
            <Input
              value={code}
              maxLength={LOBBY_CODE_LENGTH}
              placeholder="KODU"
              aria-label="Lobi kodu"
              autoComplete="off"
              spellCheck={false}
              className="text-center font-mono text-lg tracking-[0.4em] uppercase"
              onChange={(event) => setCode(event.target.value.toUpperCase())}
            />
            <Button type="submit" disabled={!isValidLobbyCode(normalized)}>
              Katıl
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

/** Screen 1 — right after the lobby forms: code + invite link, who's here so
 * far (names only; nobody has a role yet), then — host-only — the game
 * picker below the roster. Picking a game is broadcast immediately and is
 * what advances the whole room to the settings screen; there's nothing else
 * to "confirm" here. */
export function GameSelectPanel({
  code,
  games,
  members,
  youId,
  onSelectGame,
  onLeave,
}: GameSelectPanelProps) {
  const isHost =
    members.find((member) => member.id === youId)?.isHost ?? false;

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader className="items-center text-center">
        <CardTitle>Lobi hazır!</CardTitle>
        <CardDescription>
          {isHost ? "Bir oyun seç." : "Ev sahibi oyunu seçiyor…"}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col items-center gap-3">
          <p
            aria-label={`Lobi kodu: ${code}`}
            className="font-mono text-4xl font-black tracking-[0.3em]"
          >
            {code}
          </p>
          <InviteLink code={code} />
        </div>

        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <MemberNameRow
              key={member.id}
              member={member}
              isMe={member.id === youId}
            />
          ))}
        </ul>

        <GamePicker
          games={games}
          selectedGameId={null}
          interactive={isHost}
          onSelect={onSelectGame}
        />

        <Button variant="outline" onClick={onLeave}>
          Ayrıl
        </Button>
      </CardContent>
    </Card>
  );
}

/** Screen 2 — between game-select and playing: the chosen game up top
 * (host-only "Oyunu değiştir" clears the pick, sending everyone back to
 * screen 1), then the "oynasın/izlesin" roster arrangement and "start"
 * (disabled until the playing count is within the game's min/maxPlayers).
 * Guests see the same roster read-only while they wait. */
export function GameSettingsPanel({
  code,
  game,
  members,
  youId,
  onAssignRole,
  onRandomize,
  onChangeGame,
  onStart,
  onLeave,
}: GameSettingsPanelProps) {
  const isHost =
    members.find((member) => member.id === youId)?.isHost ?? false;
  const playingCount = members.filter(
    (member) => member.role === "playing",
  ).length;
  const { minPlayers, maxPlayers } = game.def.meta;
  const canStart = playingCount >= minPlayers && playingCount <= maxPlayers;

  return (
    <Card className="mx-auto w-full max-w-lg">
      <CardHeader className="items-center text-center">
        <Badge variant="outline" className="font-mono tracking-widest">
          {code}
        </Badge>
        <CardTitle className="flex items-center gap-2">
          <span aria-hidden="true">{game.def.meta.icon}</span>
          {game.def.meta.name}
        </CardTitle>
        <CardDescription>
          {isHost
            ? maxPlayers > minPlayers
              ? `Oynayacakları seç (${minPlayers}-${maxPlayers} kişi), sonra başlat.`
              : "Oynayacak iki kişiyi seç, sonra başlat."
            : "Ev sahibi oyuncuları seçiyor…"}
        </CardDescription>
        {isHost && (
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={onChangeGame}
          >
            Oyunu değiştir
          </Button>
        )}
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-2">
          {members.map((member) => (
            <MemberRow
              key={member.id}
              member={member}
              isMe={member.id === youId}
              editable={isHost}
              locked={
                member.role === "spectator" && playingCount >= maxPlayers
              }
              onToggle={() =>
                onAssignRole(
                  member.id,
                  member.role === "playing" ? "spectator" : "playing",
                )
              }
            />
          ))}
        </ul>

        {isHost ? (
          <div className="flex flex-col gap-2">
            <Button type="button" variant="outline" onClick={onRandomize}>
              Karışık dağıt
            </Button>
            <Button
              type="button"
              size="lg"
              disabled={!canStart}
              onClick={onStart}
            >
              Oyunu başlat
            </Button>
          </div>
        ) : (
          <p className="text-center text-sm text-muted-foreground">
            Ev sahibi oyuncuları seçince oyun başlar.
          </p>
        )}

        <Button variant="outline" onClick={onLeave}>
          Ayrıl
        </Button>
      </CardContent>
    </Card>
  );
}

/** Grid of game tiles — everyone in the lobby sees the catalog this way, but
 * only the host can actually tap one (`interactive`); guests get the same
 * tiles inert, just to browse what's on offer while they wait. Each tile is
 * a square "thumbnail" (a stand-in cover shot; games have no real
 * screenshots yet, so the icon fills the square) with the icon and name
 * repeated in a compact caption row underneath, icon-then-name. */
function GamePicker({
  games,
  selectedGameId,
  interactive,
  onSelect,
}: GamePickerProps) {
  return (
    <div
      aria-label="Oyunlar"
      className="grid grid-cols-2 gap-3 sm:grid-cols-3"
    >
      {games.map((game) => {
        const selected = game.def.meta.id === selectedGameId;
        return (
          <button
            key={game.def.meta.id}
            type="button"
            disabled={!interactive}
            aria-pressed={selected}
            onClick={() => onSelect(game.def.meta.id)}
            className={cn(
              "flex flex-col overflow-hidden rounded-xl border bg-card text-left shadow-sm transition-colors",
              selected
                ? "border-primary ring-2 ring-primary/30"
                : interactive && "hover:bg-muted",
              !interactive && "opacity-70",
            )}
          >
            <span
              aria-hidden="true"
              className="flex aspect-square w-full items-center justify-center bg-accent text-5xl"
            >
              {game.def.meta.icon}
            </span>
            <span className="flex items-center gap-1.5 px-2 py-2 text-sm">
              <span aria-hidden="true">{game.def.meta.icon}</span>
              <span className="truncate font-medium">
                {game.def.meta.name}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** A screen-1 row: just who's here — no role exists yet, so no toggle/badge. */
function MemberNameRow({ member, isMe }: MemberNameRowProps) {
  return (
    <li className="flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm">
      {member.isHost && <span aria-hidden="true">👑</span>}
      <span className="truncate font-medium">{member.name}</span>
      {isMe && <span className="text-xs text-muted-foreground">(sen)</span>}
    </li>
  );
}

/** One roster row: name (+ host crown, + "sen"), and either the host's
 * playing/spectator toggle or a read-only role badge for everyone else. */
function MemberRow({
  member,
  isMe,
  editable,
  locked,
  onToggle,
}: MemberRowProps) {
  const playing = member.role === "playing";

  return (
    <li className="flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="flex min-w-0 items-center gap-1.5 text-sm">
        {member.isHost && <span aria-hidden="true">👑</span>}
        <span className="truncate font-medium">{member.name}</span>
        {isMe && <span className="text-xs text-muted-foreground">(sen)</span>}
      </span>

      {editable ? (
        <Button
          type="button"
          size="xs"
          variant={playing ? "default" : "outline"}
          disabled={!playing && locked}
          onClick={onToggle}
        >
          {playing ? "Oynuyor" : "İzliyor"}
        </Button>
      ) : (
        <Badge variant={playing ? "default" : "outline"}>
          {playing ? "Oynuyor" : "İzliyor"}
        </Badge>
      )}
    </li>
  );
}

/** Readonly invite URL + clipboard button — the lobby page IS the invite
 * link, so no query params or game id are needed to join through it. */
function InviteLink({ code }: InviteLinkProps) {
  const [copied, setCopied] = useState(false);
  const link = buildInviteLink(code);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  if (link === null) return null;

  async function copy(url: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      // Clipboard can be blocked — the field stays selectable for manual copy.
    }
  }

  return (
    <div className="flex w-full items-center gap-2">
      <Input
        readOnly
        value={link}
        aria-label="Davet bağlantısı"
        className="font-mono text-xs"
        onFocus={(event) => event.target.select()}
      />
      <Button
        variant="outline"
        className="shrink-0"
        onClick={() => void copy(link)}
      >
        {copied ? "Kopyalandı ✓" : "Kopyala"}
      </Button>
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Absolute /lobi/CODE link for this room — null during SSR (no origin). */
function buildInviteLink(code: string): string | null {
  if (typeof window === "undefined") return null;
  return `${window.location.origin}/lobi/${code}`;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface NicknameGateProps {
  initialName: string;
  onSave(name: string): void;
  /** Present only when editing an existing name (first visit can't cancel). */
  onCancel?(): void;
}

interface LobbyPanelProps {
  nickname: string;
  /** Prefill for the join input (e.g. an invite code after a leave). */
  initialCode?: string;
  onEditNickname(): void;
  onCreate(): void;
  onJoin(code: string): void;
}

interface GameSelectPanelProps {
  code: string;
  /** The full catalog — the host picks from these. */
  games: readonly ShellGame[];
  members: RosterMember[];
  /** This connection's own member id — picks it out of `members`. */
  youId: string;
  onSelectGame(gameId: string): void;
  onLeave(): void;
}

interface GameSettingsPanelProps {
  code: string;
  /** The room's chosen game — this screen never renders without one. */
  game: ShellGame;
  members: RosterMember[];
  youId: string;
  onAssignRole(memberId: string, role: Role): void;
  onRandomize(): void;
  /** Host-only: clears the pick, sending the room back to game-select. */
  onChangeGame(): void;
  onStart(): void;
  onLeave(): void;
}

interface GamePickerProps {
  games: readonly ShellGame[];
  selectedGameId: string | null;
  /** False renders the same tiles inert — for guests, who can only watch
   * the host pick. */
  interactive: boolean;
  onSelect(gameId: string): void;
}

interface MemberNameRowProps {
  member: RosterMember;
  isMe: boolean;
}

interface MemberRowProps {
  member: RosterMember;
  isMe: boolean;
  /** Host controls render the toggle button; everyone else gets a badge. */
  editable: boolean;
  /** Disables turning a spectator into a player once maxPlayers is full. */
  locked: boolean;
  onToggle(): void;
}

interface InviteLinkProps {
  code: string;
}
