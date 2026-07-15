// The only slice that talks to the lobby WebSocket. A small session class
// owns the socket and the reconnect machinery (3 redials at 1s/2s/4s while
// the tab lives) and feeds every parsed server message through a pure
// reducer; the hook surfaces the snapshot via useSyncExternalStore and hands
// peer moves to the caller through a latest-ref callback. SSR-safe: nothing
// dials until a client-side create() or join(), and the server snapshot is
// the inert idle state.

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { PlayerIndex } from "@/entities/game";
import { isValidLobbyCode } from "@/shared/lib/lobby-code";
import {
  type ClientMessage,
  type LobbyErrorReason,
  parseServerMessage,
  type Role,
  type RosterMember,
  type ServerMessage,
} from "@/shared/lib/lobby-protocol";

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useLobbySession(
  options: UseLobbySessionOptions = {},
): UseLobbySession {
  const onPeerMoveRef = useRef(options.onPeerMove);
  const [session] = useState(
    () =>
      new LobbySession((payload, from) =>
        onPeerMoveRef.current?.(payload, from),
      ),
  );

  // Latest-ref: relayed moves always reach the newest render's callback.
  useEffect(() => {
    onPeerMoveRef.current = options.onPeerMove;
  });

  // The session dies with the component — no socket or timer outlives it.
  // Deferred by a tick: React's dev-only StrictMode mounts every component
  // twice (setup → cleanup → setup) to surface exactly this kind of bug.
  // `dispose()` does real teardown (closes the socket, clears listeners) —
  // running it synchronously on that phantom cleanup would kill a
  // just-opened connection before it ever finishes connecting, and
  // `teardown()` deliberately nulls `this.socket` first so the resulting
  // stale `close` event can't trigger a reconnect — so the phantom
  // teardown would leave the session stuck in "connecting" forever. The
  // synchronous re-setup that immediately follows a phantom cleanup
  // cancels the pending timer below; only a real unmount lets it fire.
  const disposeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (disposeTimerRef.current !== null) {
      clearTimeout(disposeTimerRef.current);
      disposeTimerRef.current = null;
    }
    return () => {
      disposeTimerRef.current = setTimeout(() => {
        disposeTimerRef.current = null;
        session.dispose();
      }, 0);
    };
  }, [session]);

  const state = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    getServerSnapshot,
  );

  // A separate store from `state`: chat is phase-independent (it survives
  // roster ↔ playing transitions untouched), so it's kept out of the
  // discriminated `LobbySessionState` union entirely rather than bolted onto
  // every variant.
  const chatMessages = useSyncExternalStore(
    session.subscribeChat,
    session.getChatSnapshot,
    getServerChatSnapshot,
  );

  return useMemo(
    () => ({
      state,
      chatMessages,
      create: session.create,
      join: session.join,
      sendMove: session.sendMove,
      assignRole: session.assignRole,
      randomizeRoles: session.randomizeRoles,
      selectGame: session.selectGame,
      startMatch: session.startMatch,
      sendRematch: session.sendRematch,
      sendChat: session.sendChat,
      leave: session.leave,
    }),
    [session, state, chatMessages],
  );
}

// ── Reducer (pure — unit-tested without a socket) ─────────────────────────────

/** Pure state transitions; the session class adds sockets and timers on top. */
export function reduceSession(
  state: LobbySessionState,
  event: LobbySessionEvent,
): LobbySessionState {
  switch (event.kind) {
    case "dial":
      return { phase: "connecting", code: event.code, attempt: 0 };
    case "message":
      return applyServerMessage(state, event.message);
    case "socket-closed": {
      if (
        state.phase === "idle" ||
        state.phase === "closed" ||
        state.phase === "error"
      ) {
        return state; // already settled — nothing to recover
      }
      const attempt = state.phase === "connecting" ? state.attempt : 0;
      return attempt >= MAX_RECONNECT_ATTEMPTS
        ? sessionError("connection")
        : { phase: "connecting", code: state.code, attempt: attempt + 1 };
    }
    case "leave":
      return state.phase === "idle" ? state : { phase: "closed" };
  }
}

/** Parsed DO messages → phase changes (peer-move is a side channel, not state). */
function applyServerMessage(
  state: LobbySessionState,
  message: ServerMessage,
): LobbySessionState {
  switch (message.t) {
    case "roster": {
      // Reached while connecting (first roster after joining) or already
      // arranging (a later join/leave/role change/game pick).
      if (state.phase === "connecting" || state.phase === "roster") {
        return {
          phase: "roster",
          code: state.code,
          members: message.members,
          youId: message.youId,
          gameId: message.gameId,
        };
      }
      // A stray broadcast (someone joining/leaving) must not interrupt a
      // live match — but the host changing the game IS a roster broadcast,
      // and that's exactly meant to interrupt it, so the two are told apart
      // by whether the game actually changed.
      if (state.phase === "playing" || state.phase === "peer-left") {
        if (message.gameId !== state.gameId) {
          return {
            phase: "roster",
            code: state.code,
            members: message.members,
            youId: message.youId,
            gameId: message.gameId,
          };
        }
        // Same match, but the roster still moved — most commonly the host
        // disconnecting and someone else getting promoted. `isHost` came
        // from a snapshot taken when the match started (or last changed
        // hands), so it needs refreshing here too, or a newly-promoted
        // host would have no way to reach "Oyunu değiştir" short of
        // leaving the room outright.
        const isHost =
          message.members.find((m) => m.id === message.youId)?.isHost ??
          false;
        return isHost === state.isHost ? state : { ...state, isHost };
      }
      return state;
    }
    case "start":
      // Reached from roster (host started, or a guest's first start), or
      // playing/peer-left (rejoin after a peer reconnect mid-game, or the
      // host picked a fresh game and just restarted). `isHost` isn't on the
      // wire — it rides along from whichever prior state actually knew it;
      // a "connecting" state (a reconnect that hasn't seen a roster yet)
      // has no way to know, so it defaults to non-host until one arrives.
      return state.phase === "idle" ||
        state.phase === "closed" ||
        state.phase === "error"
        ? state
        : {
            phase: "playing",
            code: state.code,
            seed: message.seed,
            names: message.names,
            you: message.you,
            gameId: message.gameId,
            isHost:
              state.phase === "roster"
                ? (state.members.find((m) => m.id === state.youId)?.isHost ??
                  false)
                : state.phase === "playing" || state.phase === "peer-left"
                  ? state.isHost
                  : false,
          };
    case "rematch-start":
      return state.phase === "playing"
        ? { ...state, seed: message.seed }
        : state;
    case "peer-left":
      return state.phase === "playing"
        ? {
            phase: "peer-left",
            code: state.code,
            names: state.names,
            you: state.you,
            gameId: state.gameId,
            isHost: state.isHost,
          }
        : state;
    case "error":
      return sessionError(message.reason);
    case "peer-move":
      return state;
    case "chat":
      // Intercepted in `receive()` before it ever reaches `dispatch()` — the
      // case exists only so this switch stays exhaustive over `ServerMessage`.
      return state;
  }
}

function sessionError(reason: LobbySessionErrorReason): LobbySessionState {
  return { phase: "error", reason, message: SESSION_ERROR_MESSAGES[reason] };
}

// ── Session (socket + reconnect machinery behind the store) ───────────────────

class LobbySession {
  private state: LobbySessionState = INITIAL_SESSION_STATE;
  private readonly listeners = new Set<() => void>();
  private socket: WebSocket | null = null;
  private redialTimer: ReturnType<typeof setTimeout> | null = null;
  private dialParams: DialParams | null = null;

  // Chat lives entirely outside `state` — a phase-independent side channel
  // (like peer-move) but, unlike peer-move, accumulated here rather than
  // just handed to a callback, since every screen wants to render the same
  // running log. `myId` tracks this connection's own member id purely to
  // flag which messages are "self" — it rides in on every roster broadcast,
  // including ones received mid-match, so it stays current after a host
  // handoff or any other roster change.
  private chat: ChatMessage[] = [];
  private chatSeq = 0;
  private myId: string | null = null;
  private readonly chatListeners = new Set<() => void>();

  constructor(
    private readonly onPeerMove: (payload: unknown, from: PlayerIndex) => void,
  ) {}

  // Public surface as arrow properties — safe to pass around unbound.

  readonly subscribe = (onChange: () => void): (() => void) => {
    this.listeners.add(onChange);
    return () => this.listeners.delete(onChange);
  };

  readonly getSnapshot = (): LobbySessionState => this.state;

  readonly subscribeChat = (onChange: () => void): (() => void) => {
    this.chatListeners.add(onChange);
    return () => this.chatListeners.delete(onChange);
  };

  readonly getChatSnapshot = (): ChatMessage[] => this.chat;

  readonly sendChat = (text: string): void => {
    this.send({ t: "chat", text });
  };

  /** Host flow: claim a room for a code minted by the caller (the router
   * needs the code before it navigates, so it's supplied, not generated
   * here). */
  readonly create = (options: { name: string; code: string }): void => {
    this.dial({ code: options.code, name: options.name, joinOnly: false });
  };

  /** Guest flow: dial an existing code (`join=1` keeps dead rooms dead). */
  readonly join = (options: { code: string; name: string }): void => {
    const code = options.code.trim().toUpperCase();
    if (!isValidLobbyCode(code)) {
      // The Worker would 404 this upgrade anyway; fail fast with the same
      // stable message instead of burning three doomed redials.
      this.teardown();
      this.dialParams = null;
      this.dispatch({
        kind: "message",
        message: { t: "error", reason: "not-found" },
      });
      return;
    }
    this.dial({ code, name: options.name, joinOnly: true });
  };

  readonly sendMove = (payload: unknown): void => {
    this.send({ t: "move", payload });
  };

  /** Host-only; the DO silently ignores this from a non-host. */
  readonly assignRole = (memberId: string, role: Role): void => {
    this.send({ t: "assign-role", memberId, role });
  };

  /** Host-only: shuffles everyone, seating up to `maxPlaying` (the game's
   * `meta.maxPlayers`) and benching the rest. */
  readonly randomizeRoles = (maxPlaying: number): void => {
    this.send({ t: "randomize-roles", maxPlaying });
  };

  /** Host-only: picks (or replaces) the game to play, from inside the room.
   * `null` clears the pick, going back to the game-select screen. */
  readonly selectGame = (gameId: string | null): void => {
    this.send({ t: "select-game", gameId });
  };

  /** Host-only: starts the match once a game is chosen and two or more
   * members are "playing". */
  readonly startMatch = (): void => {
    this.send({ t: "start-match" });
  };

  readonly sendRematch = (): void => {
    this.send({ t: "rematch" });
  };

  readonly leave = (): void => {
    this.dialParams = null;
    this.send({ t: "leave" });
    this.teardown();
    this.dispatch({ kind: "leave" });
  };

  /** Unmount cleanup: drop socket, timer, and subscribers — no dispatch. */
  readonly dispose = (): void => {
    this.dialParams = null;
    this.teardown();
    this.listeners.clear();
    this.chatListeners.clear();
  };

  private dial(params: DialParams): void {
    if (typeof window === "undefined") return; // SSR: never dial on the server
    this.teardown();
    this.dialParams = params;
    // A fresh dial means a different room (or a from-scratch reconnect after
    // "error"/"closed") — last room's chat log and member id shouldn't bleed
    // into this one.
    this.resetChat();
    this.dispatch({ kind: "dial", code: params.code });
    this.openSocket();
  }

  private openSocket(): void {
    const params = this.dialParams;
    if (params === null) return;
    const ws = new WebSocket(buildSocketUrl(params));
    this.socket = ws;
    ws.addEventListener("message", (event) => {
      if (ws === this.socket) this.receive(event.data);
    });
    ws.addEventListener("close", () => {
      if (ws !== this.socket) return; // superseded or torn down — stale event
      this.socket = null;
      this.recover();
    });
  }

  private receive(data: unknown): void {
    const message = parseServerMessage(
      typeof data === "string" ? parseJson(data) : null,
    );
    if (message === null) return; // parse-don't-cast: ill-formed is dropped
    if (message.t === "peer-move") {
      // Side channel, not reducer state.
      this.onPeerMove(message.payload, message.from);
      return;
    }
    if (message.t === "roster") this.myId = message.youId;
    if (message.t === "chat") {
      // Side channel, same as peer-move — never reaches `dispatch()`.
      this.pushChat(message);
      return;
    }
    this.dispatch({ kind: "message", message });
  }

  private pushChat(message: Extract<ServerMessage, { t: "chat" }>): void {
    const entry: ChatMessage = {
      id: String(this.chatSeq++),
      from: message.from,
      fromName: message.fromName,
      text: message.text,
      ts: message.ts,
      self: message.from === this.myId,
    };
    this.chat = [...this.chat, entry].slice(-CHAT_HISTORY_LIMIT);
    for (const listener of this.chatListeners) listener();
  }

  private resetChat(): void {
    this.chat = [];
    this.chatSeq = 0;
    this.myId = null;
    for (const listener of this.chatListeners) listener();
  }

  /** Capped backoff while the tab lives: redial after 1s/2s/4s, then error. */
  private recover(): void {
    this.dispatch({ kind: "socket-closed" });
    const state = this.state;
    if (state.phase !== "connecting" || state.attempt === 0) return;
    const delay = RECONNECT_DELAYS_MS[state.attempt - 1];
    this.redialTimer = setTimeout(() => {
      this.redialTimer = null;
      this.openSocket();
    }, delay);
  }

  private send(message: ClientMessage): void {
    const ws = this.socket;
    if (ws !== null && ws.readyState === ws.OPEN) {
      ws.send(JSON.stringify(message));
    }
  }

  /** Silence and drop the current socket plus any pending redial. */
  private teardown(): void {
    if (this.redialTimer !== null) {
      clearTimeout(this.redialTimer);
      this.redialTimer = null;
    }
    const ws = this.socket;
    if (ws === null) return;
    this.socket = null; // handlers compare identity, so stale events no-op
    ws.close(1000);
  }

  private dispatch(event: LobbySessionEvent): void {
    const next = reduceSession(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) {
      listener();
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function getServerSnapshot(): LobbySessionState {
  return INITIAL_SESSION_STATE;
}

/** A single stable empty array — SSR/first-hydration snapshot for chat,
 * mirroring `getServerSnapshot` above (a fresh array each call would fail
 * `useSyncExternalStore`'s reference-equality check and loop). */
function getServerChatSnapshot(): ChatMessage[] {
  return EMPTY_CHAT_LOG;
}

/** ws(s)://<host>/lobi/:code?name=…[&join=1] from window.location. */
function buildSocketUrl(params: DialParams): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const url = new URL(
    `${protocol}//${window.location.host}/lobi/${params.code}`,
  );
  url.searchParams.set("name", params.name);
  if (params.joinOnly) url.searchParams.set("join", "1");
  return url.toString();
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

export const INITIAL_SESSION_STATE: LobbySessionState = { phase: "idle" };

/** Stable Turkish copy the UI renders verbatim from `state.message`. */
const SESSION_ERROR_MESSAGES: Record<LobbySessionErrorReason, string> = {
  "not-found": "Lobi bulunamadı",
  full: "Lobi dolu",
  "name-required": "Takma ad gerekli",
  connection: "Bağlantı koptu",
};

/** Redial attempt N waits RECONNECT_DELAYS_MS[N - 1]; after the last, error. */
const RECONNECT_DELAYS_MS = [1000, 2000, 4000];
const MAX_RECONNECT_ATTEMPTS = RECONNECT_DELAYS_MS.length;

/** How many chat messages a session keeps in memory — old lines just fall
 * off the front; nothing here is persisted server-side either. */
const CHAT_HISTORY_LIMIT = 200;
const EMPTY_CHAT_LOG: ChatMessage[] = [];

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * idle → connecting → roster (everyone arranges roles and — host-only —
 * picks the game; the shareable code lives here) → playing → peer-left |
 * closed | error, with one extra edge back from "playing"/"peer-left" to
 * "roster": the host picking a different game mid-match ends it and returns
 * everyone to arranging, same as if the match had never started.
 * `connecting.attempt` is 0 on the first dial and 1..3 on redials;
 * peer-left keeps the room alive so a rejoin (fresh `start`) returns to
 * playing. `you` is null while spectating; `names` has one entry per active
 * seat — most games fix that at 2, some allow more. `gameId` is null in
 * "roster" until the host picks one; "playing"/"peer-left" always carry the
 * id the match actually started with. `isHost` rides along through
 * "playing"/"peer-left" so the match screen can offer the host (and only
 * the host) the "change game" control.
 */
export type LobbySessionState =
  | { phase: "idle" }
  | { phase: "connecting"; code: string; attempt: number }
  | {
      phase: "roster";
      code: string;
      members: RosterMember[];
      youId: string;
      gameId: string | null;
    }
  | {
      phase: "playing";
      code: string;
      seed: number;
      names: string[];
      you: PlayerIndex | null;
      gameId: string;
      isHost: boolean;
    }
  | {
      phase: "peer-left";
      code: string;
      names: string[];
      you: PlayerIndex | null;
      gameId: string;
      isHost: boolean;
    }
  | { phase: "closed" }
  | { phase: "error"; reason: LobbySessionErrorReason; message: string };

/** Protocol rejections plus the client-side "ran out of redials" case. */
export type LobbySessionErrorReason = LobbyErrorReason | "connection";

/** Reducer inputs — produced by the session class, never by the UI. */
export type LobbySessionEvent =
  | { kind: "dial"; code: string }
  | { kind: "message"; message: ServerMessage }
  | { kind: "socket-closed" }
  | { kind: "leave" };

export interface UseLobbySessionOptions {
  /** Called with every relayed peer move — a side channel, not in `state`. */
  onPeerMove?(payload: unknown, from: PlayerIndex): void;
}

export interface UseLobbySession {
  state: LobbySessionState;
  /** The room's running chat log — phase-independent, so it's a sibling of
   * `state` rather than nested inside it; survives roster ↔ playing
   * transitions and only resets on a fresh `create`/`join`. */
  chatMessages: ChatMessage[];
  /** Claims the room for a code the caller already minted, as its host. */
  create(options: { name: string; code: string }): void;
  /** Connects to an existing lobby code (normalized to uppercase). */
  join(options: { code: string; name: string }): void;
  sendMove(payload: unknown): void;
  assignRole(memberId: string, role: Role): void;
  randomizeRoles(maxPlaying: number): void;
  /** Host-only: picks (or replaces) the game to play; null clears the pick. */
  selectGame(gameId: string | null): void;
  startMatch(): void;
  sendRematch(): void;
  /** Anyone, any phase — trimmed client-side and re-validated by the DO. */
  sendChat(text: string): void;
  leave(): void;
}

/** A chat message as rendered by the UI — `self` says whether this
 * connection sent it (compared against the class's own tracked member id,
 * refreshed off every roster broadcast); `id` is a locally-minted,
 * monotonic React list key, not part of the wire message. */
export interface ChatMessage {
  id: string;
  from: string;
  fromName: string;
  text: string;
  ts: number;
  self: boolean;
}

/** Everything needed to (re)dial the same room with the same identity. */
interface DialParams {
  code: string;
  name: string;
  joinOnly: boolean;
}
