---
alwaysApply: true
---

# Lobi — Engineering Conventions

Lobi is a TanStack Start SSR app deployed to Cloudflare Workers, organized by
**Feature-Sliced Design (FSD v2.1)**. A room holds up to 16 members; each game
declares its own player range (most are fixed at 2, some allow up to
`maxPlayers`), and members the host hasn't marked "playing" just spectate.
Games run client-side on pure deterministic reducers; a game-agnostic
`LobbyRoom` Durable Object relays roster state, the host's game/role picks,
moves, and chat between everyone in the room over WebSockets — it never
interprets any of it. This document is the law of the repo: layer mapping,
import rules, naming, declaration order, and the server isolation rule. When
code and this document disagree, fix one of them in the same change — never
let them drift.

## Layers

| Layer | Location | What lives there |
| --- | --- | --- |
| app | `src/app/**` + `src/router.tsx`, `src/server.ts`, `src/start.ts` | Bootstrap: router creation, the Worker entry (exports the `LobbyRoom` Durable Object class) |
| pages | `src/routes/**` | TanStack Router file routes ARE the pages layer. Page-private code sits in dash-prefixed folders beside the route (`-ui/`, `-model/`, `-lib/`) — still the same page slice, not a new layer |
| widgets | `src/widgets/**` | Large self-sufficient UI compositions (e.g. `game-shell`: lobby panel + board frame + turn/status bar + rematch + chat panel) |
| features | `src/features/**` | User-facing actions, **verb–noun kebab-case** names: `play-xox`, `play-battleship`, `lobby-session` |
| entities | `src/entities/**` | Core domain contracts: `game` (the GameDef/BoardProps contract every game implements), `player` (nickname) |
| shared | `src/shared/**` | Infrastructure only — segments, no slices, **no business rules**: `ui/`, `lib/`, `config/`, `server/` |

**Import direction (strict, top → bottom only):** routes (pages) → widgets |
features | entities → shared. A module may import only from layers below it,
never from peers on the same layer. Game features never import the lobby
feature or each other; the page composes them. When two same-layer slices need
each other, resolve in this order: merge them → extract the shared part to
entities → compose at a higher layer (IoC) → `@x` re-export as a last resort.

**Start simple, extract when needed.** Do not add empty slices "just in case".
Duplication in route-local code is acceptable until a second real consumer
justifies extraction.

## Public API of a slice

Every multi-file slice exposes a root `index.ts` with **named exports** — the
client-safe surface only. Import via the alias (`@/features/play-xox`,
`@/entities/game`), never deep paths. A game feature's public API is its
`GameDef`, its board component, and its state/move types — `GameDef`
deliberately carries no component reference, so the catalog pairs def + board.
Reducer helpers and word/config lists stay internal behind it.

## Server isolation rule (machine-enforced)

The only server-side code is the `LobbyRoom` Durable Object under
`shared/server/`. Nothing outside a server segment may runtime-import from
`@/**/server/**` — Biome's `noRestrictedImports` errors on it; the rule is off
inside `**/server/**`, `src/server.ts`, `src/start.ts`, and `src/router.tsx`
(see biome.json — that list is canonical). Client code talks to the lobby
exclusively over its WebSocket protocol, whose message schema lives in
`@/shared/lib/lobby-protocol` (client-safe, parse-don't-cast — both the client
and the Durable Object import it). `import type` from server modules is always
allowed.

## The game contract

Games are pure and deterministic; the lobby is game-agnostic.

- `entities/game` owns the contract: `GameDef<S, M>` = `meta` (id, Turkish
  display name, icon, tagline, `minPlayers`/`maxPlayers`) + `init(seed,
  playerCount)` + `applyMove(state, move, player)` + `status(state)` +
  `turn(state)` + `playerLabel(index)`; plus the shared `BoardProps<S, M>`
  every board component receives (`state`, `me: PlayerIndex`, `canMove`,
  `onMove(m)`). `PlayerIndex` is a plain 0-based seat number, not a fixed
  `0 | 1` — `maxPlayers` can be as high as 16.
- Each game is `features/play-<game>/`: `model/rules.ts` (the pure reducer —
  framework-free, fully unit-tested), `ui/board.tsx` (presentational; receives
  `BoardProps`, never touches the socket), `index.ts` (exports the `GameDef`
  and the board component).
- Determinism: anything random (battleship placement, hangman word, the
  shared number in Sayı Tahmini, first turn) derives from the room `seed`
  every seated player gets via the seeded RNG in `@/shared/lib` — never
  `Math.random()` in game code.
- Every client applies the same reducer to the same move stream (lockstep);
  the relay never interprets moves. An `applyMove` rejection returns `null` —
  invalid moves are ignored, never thrown.

## File naming

kebab-case for all source file names; PascalCase only for exported component
names. Framework-generated names keep their required shape (`__root.tsx`,
`routeTree.gen.ts`, `lobi.$code.tsx`). Role suffixes: `*.do.ts` (Durable
Object), `*.test.ts` (colocated). Hooks are `use-*.ts(x)`. Name files after
the business domain, not the technical role — no `types.ts`/`utils.ts` sprawl.
UI copy is Turkish; identifiers, comments, and docs-for-developers stay
English.

## Declaration order

**Goal:** structure and the main screen first; **machinery and detail last**
so nothing heavy jumps out before you've seen what the file is about.

**Order:**

1. `imports`
2. `exports` (right after imports) — e.g.
   `export const Route = createFileRoute(...)({ component: GamePage })` so the
   contract is obvious. Use **function declarations** for route components
   (`function GamePage() {}`) so names are hoisted and safe to reference from
   an early `Route` export.
3. **Main route / page component** — the primary `function GamePage()` (or
   equivalent) for that module.
4. **File-local components** it composes.
5. **Helpers, hooks, and small utilities** used by the above — last among
   implementation, so fine-grained logic stays at the bottom.
6. `// ── Types ──` last when TypeScript allows: `interface` and most shapes
   in a final section. `type` aliases are not hoisted like interfaces; if the
   compiler errors on "used before declaration", move that alias just above
   its first use or use an `interface` until types can stay at the end.

**Hoisting:** anything defined below its first use must be a `function`
declaration (hoisted) or otherwise ordered so it exists in time.
`const foo = () => {}` is **not** hoisted — keep it above first use or convert
to `function foo() {}`.

Canonical flow: imports → exports → definitions (main component, then local
components) → constants (optional) → implementation (helpers, handlers, hooks —
detail last) → types (as far down as TS permits). If a section becomes huge,
split it into another module instead of stacking everything in one file.

## Section separators (comment style)

Separate logical blocks with `// ──` banners padded to ~80 characters with `─`
(U+2500):

```ts
// ── Components ───────────────────────────────────────────────────────────────
```

One blank line before each banner and one after it. Title-case, short labels:
`Route`, `Constants`, `Helpers`, `Types`, `Components`, `Utils`. Use banners
only when the file has two or more real sections; skip them in tiny files.
Parentheticals for context are fine.

Import ordering inside the imports block is manual (Biome organizeImports is
off); the house habit is externals first, then `@/` aliases, then relative
`./` imports.

## Adding a new game

1. Create `features/play-<game>/` with `model/rules.ts` — a pure
   `GameDef<S, M>` implementation. No React, no sockets, no `Math.random()`.
2. Write `model/rules.test.ts` first: win/draw detection, every invalid-move
   rejection, seed determinism.
3. Add `ui/board.tsx` taking `BoardProps<S, M>` — render state, call
   `onMove`, disable itself when `canMove` is false.
4. Export the `GameDef`, the board component, and the state/move types from
   `index.ts`.
5. Register it in `src/routes/-catalog.ts` — the only place `play-*` features
   are enumerated. There's no per-game route; the home grid's showcase and
   the in-room game picker both resolve games from this one list, and the
   host picks one from inside the lobby. No other file changes.

## Commands

`bun dev` (port 3000) · `bun t` (typecheck — the canonical gate) ·
`bun check` (Biome) · `bun test` (vitest) · `bun run build` ·
`bun run deploy`. CI runs `bun t`, `bun check`, and `bun test` on every PR.
