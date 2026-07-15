// Cloudflare Workers entry: `/lobi/:code` WebSocket upgrades go to the
// LobbyRoom Durable Object; every other request is served by TanStack Start.
import handler from "@tanstack/react-start/server-entry";
import { handleLobbyUpgrade } from "@/shared/server/lobby-room.do";

export { LobbyRoom } from "@/shared/server/lobby-room.do";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const code = lobbyUpgradeCode(request);
    if (code !== null) return handleLobbyUpgrade(request, env, code);
    return handler.fetch(request);
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** The lobby code when the request is a `/lobi/:code` WebSocket upgrade. */
function lobbyUpgradeCode(request: Request): string | null {
  if (request.method !== "GET") return null;
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return null;
  }
  const match = new URL(request.url).pathname.match(/^\/lobi\/([^/]+)$/);
  return match?.[1] ?? null;
}
