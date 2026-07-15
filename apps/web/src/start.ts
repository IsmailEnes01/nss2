import { createStart } from "@tanstack/react-start";

// No global middleware — the Worker entry (src/server.ts) owns the only
// cross-cutting concern (routing WebSocket upgrades to the LobbyRoom DO).
export const startInstance = createStart(() => ({}));
