/// <reference types="@cloudflare/workers-types" />

// Hand-maintained mirror of wrangler.jsonc's bindings (what `wrangler types`
// would generate). The triple-slash reference also pulls in the
// `cloudflare:workers` module declaration the LobbyRoom Durable Object
// imports from; DOM/workers global overlaps are absorbed by skipLibCheck.

declare namespace Cloudflare {
  interface Env {
    LOBBY_ROOM: DurableObjectNamespace;
  }
}

interface Env extends Cloudflare.Env {}
