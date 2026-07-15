// The one dynamic lobby page: no game is fixed by the URL anymore — the
// route just names a room (by its code) and whether visiting it means
// claiming that code as host or joining it as a guest. The host later picks
// a game from inside the room; this page just hands the whole thing to the
// game-shell widget along with the full catalog (widgets can't reach the
// routes-layer registry themselves). The shell renders ClientOnly — it reads
// localStorage and dials WebSockets, neither of which SSRs.

import { ClientOnly, createFileRoute, Link } from "@tanstack/react-router";
import { BRAND } from "@/shared/config";
import { isValidLobbyCode } from "@/shared/lib/lobby-code";
import { buttonVariants } from "@/shared/ui/button";
import { Spinner } from "@/shared/ui/spinner";
import { GameShell } from "@/widgets/game-shell";
import { gamesList } from "./-catalog";

export const Route = createFileRoute("/lobi/$code")({
  validateSearch: validateLobbySearch,
  component: LobbyPage,
});

function LobbyPage() {
  const { code } = Route.useParams();
  const { host } = Route.useSearch();
  const normalized = code.trim().toUpperCase();

  if (!isValidLobbyCode(normalized)) return <LobbyNotFound />;

  return (
    <main className="mx-auto flex min-h-svh w-full max-w-3xl flex-col gap-8 px-4 py-8">
      <header className="flex items-center justify-between gap-4">
        <Link
          to="/"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          ← {BRAND}
        </Link>
        <span className="font-mono text-sm tracking-widest text-muted-foreground">
          {normalized}
        </span>
      </header>

      <ClientOnly fallback={<ShellFallback />}>
        <GameShell code={normalized} hostIntent={host} games={gamesList} />
      </ClientOnly>
    </main>
  );
}

// ── Components ────────────────────────────────────────────────────────────────

function LobbyNotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <span aria-hidden="true" className="text-5xl">
        🧭
      </span>
      <h1 className="text-2xl font-bold">Lobi kodu geçersiz</h1>
      <p className="text-muted-foreground">
        Bağlantıyı kontrol et ya da yeni bir lobi kur.
      </p>
      <Link to="/" className={buttonVariants({ size: "lg" })}>
        Ana sayfaya dön
      </Link>
    </main>
  );
}

function ShellFallback() {
  return (
    <div className="flex justify-center py-24">
      <Spinner className="size-6" />
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** `?host=1` (or a truthy JSON-encoded boolean, depending on the router's
 * search serializer) means "claim this code as host"; anything else joins. */
function validateLobbySearch(search: Record<string, unknown>): LobbySearch {
  const raw = search.host;
  return { host: raw === true || raw === "1" || raw === "true" };
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface LobbySearch {
  host: boolean;
}
