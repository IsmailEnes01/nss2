// Home: nickname gate, then create/join — no game is picked here anymore.
// "Lobi kur" mints a code client-side and heads straight into that room as
// its host; "Koda katıl" heads into an existing one as a guest. The host
// picks the game from inside the room once everyone's in. The catalog still
// gets a small showcase section below so people know what they're walking
// into, but it's purely informational now — nothing here deep-links to a
// specific game.

import {
  ClientOnly,
  createFileRoute,
  useNavigate,
} from "@tanstack/react-router";
import { useState } from "react";
import { getNickname, setNickname } from "@/entities/player";
import { BRAND } from "@/shared/config";
import { generateLobbyCode } from "@/shared/lib/lobby-code";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/shared/ui/card";
import { Spinner } from "@/shared/ui/spinner";
import { LobbyPanel, NicknameGate } from "@/widgets/game-shell";
import { gamesList } from "./-catalog";

export const Route = createFileRoute("/")({ component: HomePage });

function HomePage() {
  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col items-center gap-12 px-4 py-16">
      <header className="flex flex-col items-center gap-4 text-center">
        <h1 className="text-6xl font-black tracking-tight sm:text-7xl">
          {BRAND}
          <span className="text-primary">.</span>
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Lobi kur, kodu arkadaşlarına gönder, sonra hangi oyunu
          oynayacağınızı seç. 16 kişiye kadar katılabilir. Kayıt yok, kurulum
          yok.
        </p>
        <HowItWorks />
      </header>

      <ClientOnly fallback={<EntryFallback />}>
        <LobbyEntry />
      </ClientOnly>

      <GamesShowcase />
    </main>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

/** Reads the saved nickname (localStorage) and renders the gate/panel pair —
 * isolated behind ClientOnly so the server (which has no localStorage) never
 * has to guess which one to render. Mirrors the same pattern GameShell uses
 * for its own nickname gate. */
function LobbyEntry() {
  const navigate = useNavigate();
  const [nickname, setNicknameState] = useState<string | null>(getNickname);
  const [editingName, setEditingName] = useState(false);

  function saveNickname(name: string): void {
    setNickname(name);
    setNicknameState(name);
    setEditingName(false);
  }

  function createLobby(): void {
    navigate({
      to: "/lobi/$code",
      params: { code: generateLobbyCode() },
      search: { host: true },
    });
  }

  function joinLobby(code: string): void {
    navigate({ to: "/lobi/$code", params: { code }, search: { host: false } });
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

  return (
    <LobbyPanel
      nickname={nickname}
      onEditNickname={() => setEditingName(true)}
      onCreate={createLobby}
      onJoin={joinLobby}
    />
  );
}

function EntryFallback() {
  return (
    <div className="flex justify-center py-8">
      <Spinner className="size-6" />
    </div>
  );
}

/** Informational only — the games live inside the lobby now, not behind a
 * link from here. */
function GamesShowcase() {
  return (
    <section
      aria-label="Oyunlar"
      className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      {gamesList.map(({ def }) => (
        <Card key={def.meta.id} className="gap-3">
          <CardHeader className="gap-2">
            <span
              aria-hidden="true"
              className="flex size-12 items-center justify-center rounded-xl bg-accent text-3xl"
            >
              {def.meta.icon}
            </span>
            <CardTitle className="text-lg">{def.meta.name}</CardTitle>
            <CardDescription>{def.meta.tagline}</CardDescription>
          </CardHeader>
          <CardContent className="mt-auto text-sm text-muted-foreground">
            {def.meta.minPlayers === def.meta.maxPlayers
              ? `${def.meta.minPlayers} kişilik`
              : `${def.meta.minPlayers}-${def.meta.maxPlayers} kişilik`}
          </CardContent>
        </Card>
      ))}
    </section>
  );
}

function HowItWorks() {
  return (
    <ol className="flex flex-wrap items-center justify-center gap-2 text-sm text-muted-foreground">
      <Step number={1} label="Lobi kur" />
      <span aria-hidden="true">→</span>
      <Step number={2} label="Kodu paylaş" />
      <span aria-hidden="true">→</span>
      <Step number={3} label="Oyunu seç" />
      <span aria-hidden="true">→</span>
      <Step number={4} label="Oyna" />
    </ol>
  );
}

function Step({ number, label }: StepProps) {
  return (
    <li className="flex items-center gap-1.5">
      <span className="flex size-5 items-center justify-center rounded-full bg-primary/10 font-mono text-xs font-bold text-primary">
        {number}
      </span>
      {label}
    </li>
  );
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface StepProps {
  number: number;
  label: string;
}
