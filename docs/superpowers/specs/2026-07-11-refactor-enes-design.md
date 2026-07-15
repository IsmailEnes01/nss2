# refactor-enes ("Lobi") — Design

**Date:** 2026-07-11 · **Status:** approved

A greenfield two-player games site: 6 simple games playable over lobby codes,
built on the same FSD architecture and conventions as refactor-taha (FSD v2.1,
written declaration order, Bun + Biome, TanStack Start, Cloudflare Workers),
with CI/CD files ready and a polished Turkish README.

## Decisions (settled with the user)

| Axis | Decision |
| --- | --- |
| Games | XOX, Dört Taş (Connect Four), Taş-Kağıt-Makas, Amiral Battı, Noktalar & Kutular, Adam Asmaca |
| Transport | Durable Object WebSocket relay (no WebRTC, no TURN); "P2P feel" via lobby codes, game state lives only in the clients |
| Persistence | None — nickname in localStorage, no DB, no auth, no docker |
| Brand | "Lobi" · repo folder `refactor-enes` |
| Language | UI + README Turkish; code, comments, AGENTS.md English |
| Slicing | Pure game-engine contract + one feature slice per game |
| CI/CD | Local-first, deploy-ready: ci.yml secret-free; preview/deploy need only CLOUDFLARE_API_TOKEN |
| Hard constraint | The reference codebase's name must never appear anywhere in this repo |

## Architecture

### FSD map

- **app** — `router.tsx`, `server.ts` (Worker entry: TanStack Start handler +
  `LobbyRoom` DO export + `/lobi/:code` WebSocket upgrade routing), `start.ts`.
- **routes (pages)** — `index.tsx` (home: 6 game cards), `oyun.$gameId.tsx`
  (the one dynamic game page; lobby query param `?lobi=CODE` for invite
  links), `-catalog.ts` (page-level composition registering the six GameDefs).
- **widgets** — `game-shell`: nickname prompt, create/join lobby panel,
  connection status, board frame, turn/status bar, rematch flow. Game-agnostic;
  receives a `GameDef` and renders its board through `BoardProps`.
- **features** — `lobby-session` (WebSocket state machine: connect, join,
  presence, reconnect-with-backoff, message dispatch — the only slice that
  talks to the socket) and six `play-<game>` slices, each: `model/rules.ts`
  pure reducer + colocated tests, `ui/board.tsx` presentational board,
  `index.ts` exporting its `GameDef`.
- **entities** — `game` (GameDef/GameStatus/BoardProps contract types),
  `player` (nickname get/set over localStorage).
- **shared** — `ui/` (button, input, card, badge, spinner), `config/brand.ts`
  ("Lobi"), `lib/` (cn, `lobby-code` generator — 4 chars, ambiguity-free
  alphabet, `seeded-rng` mulberry32), `lib/lobby-protocol/` (versioned
  client↔DO message schema, parse-don't-cast; imported by BOTH sides),
  `server/lobby-room.do.ts` (the Durable Object).

### Lobby & sync model

`LobbyRoom` DO instance per lobby code (idFromName). WebSocket Hibernation
API. Room lifecycle: `waiting` (1 player) → `playing` (2) → closed on both
leaving; join of a full room is rejected with a stable Turkish error. On the
second join the DO broadcasts `start` carrying `{seed, players:[names],
yourIndex}`. After that it blindly relays `{type:"move", payload}` (and
`rematch` / `leave` / ping) to the other socket — it never interprets game
messages. Both clients run the same pure reducer over the same move stream
(lockstep); all randomness (ship placement, hangman word, first turn) derives
from the shared seed, so states cannot diverge. Disconnect: the peer sees
"rakip ayrıldı" with a rejoin window while the room holds.

### Error handling

- Protocol: every inbound message (both directions) goes through
  lobby-protocol's parser; ill-formed messages are dropped, never thrown.
- Invalid moves: `applyMove` returns null → ignored locally, never sent.
- Socket: lobby-session exposes `connecting | open | closed | error` states;
  reconnect with capped backoff; stable Turkish user-facing strings
  ("Lobi bulunamadı", "Lobi dolu", "Rakip ayrıldı", "Bağlantı koptu").

### Testing (minimal posture)

Pure logic only, no DOM/socket tests: six rule reducers (win/draw matrices,
invalid moves, seed determinism), lobby-protocol parse, lobby-code generator,
seeded RNG. CI gate: `tsc` + `biome` + `vitest`.

### CI/CD

`ci.yml` (PR: bun t / check / test — works with zero secrets),
`preview.yml` (PR: `wrangler deploy --name lobi-pr-N`),
`deploy-prod.yml` (main: CI → build → `wrangler deploy --env production`).
Both deploy workflows need only `CLOUDFLARE_API_TOKEN`; `ci/README.md` is the
wiring runbook. No DB/preview-branch machinery — there is no database.

### README (Turkish)

Product blurb, game table, "nasıl çalışır" ASCII flow (lobi → relay →
lockstep), 3-command quick start, command table, deploy guide, a 5-step
"Yeni oyun nasıl eklenir" section mirroring AGENTS.md's contract, and an
architecture summary pointing to AGENTS.md.
