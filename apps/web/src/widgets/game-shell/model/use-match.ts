// Local lockstep match state for the game shell. One match = one "playing"
// snapshot object from the lobby session: the session reducer mints a fresh
// object for every `start`/`rematch-start`, so object identity keys the match
// (even a rematch that happened to repeat a seed resets cleanly). Match
// begin/clear runs DURING render (React's adjust-state-on-render pattern) so
// the board is never a frame behind the socket, and both move paths settle
// against the latest state via functional updates — `applyMove` returning
// null drops the move, never throws. `game` is nullable because the shell no
// longer knows which game it's rendering until the host picks one from
// inside the room — this hook is called on every render regardless, and
// simply can't act until both a game AND a "playing" snapshot exist.

import { useState } from "react";
import type { GameDef, PlayerIndex } from "@/entities/game";
import type { LobbySessionState } from "@/features/lobby-session";

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useMatch(
  game: GameDef<unknown, unknown> | null,
  session: LobbySessionState,
): UseMatch {
  const [match, setMatch] = useState<MatchState | null>(null);

  // Adjust during render: a new playing snapshot begins a new match; any
  // settled phase clears it. peer-left keeps the final board on screen.
  if (session.phase === "playing" && game !== null) {
    if (match?.key !== session) {
      setMatch({
        key: session,
        you: session.you,
        state: game.init(session.seed, session.names.length, session.settings),
      });
    }
  } else if (session.phase !== "peer-left" && match !== null) {
    setMatch(null);
  }

  const canMove =
    game !== null &&
    match !== null &&
    session.phase === "playing" &&
    match.key === session &&
    game.status(match.state).kind === "ongoing" &&
    isMyTurn(game, match);

  const playMove = (move: unknown): boolean => {
    if (
      game === null ||
      match === null ||
      session.phase !== "playing" ||
      match.key !== session
    ) {
      return false;
    }
    if (match.you === null) return false; // spectators never send moves
    // Gate on this render's view. Between render and click only PEER events
    // can land, and a peer move never invalidates a move that was valid here
    // (turn-based: an out-of-turn move is rejected on both sides; RPS: a peer
    // commit leaves my pending slot empty) — so a `true` here is safe to
    // relay, and the functional re-apply below settles the exact state.
    if (game.applyMove(match.state, move, match.you) === null) return false;
    applyTo(match.key, move, match.you);
    return true;
  };

  /** Every relayed move now names its own seat (`from`) — the room holds up
   * to 16 members, so a spectator can't infer "the other player" the way a
   * lone opponent used to. */
  const applyPeerMove = (payload: unknown, from: PlayerIndex): void => {
    // Peer moves always target the newest match; the functional update reads
    // it directly, so a stale render closure cannot corrupt a rematch.
    setMatch((current) => {
      if (current === null || game === null) return current;
      const next = game.applyMove(current.state, payload, from);
      return next === null ? current : { ...current, state: next };
    });
  };

  return { match, canMove, playMove, applyPeerMove };

  /** Re-apply against the queued-latest state; a superseded match is a no-op. */
  function applyTo(key: object, move: unknown, player: PlayerIndex): void {
    setMatch((current) => {
      if (current === null || current.key !== key || game === null) {
        return current;
      }
      const next = game.applyMove(current.state, move, player);
      return next === null ? current : { ...current, state: next };
    });
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** My turn, or a simultaneous game — `turn()` is null while ongoing (RPS),
 * where the reducer itself blocks a second commit per round. Spectators
 * (`you === null`) never get a turn. */
function isMyTurn(game: GameDef<unknown, unknown>, match: MatchState): boolean {
  if (match.you === null) return false;
  const turn = game.turn(match.state);
  return turn === null || turn === match.you;
}

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseMatch {
  /** Null until a match starts; survives peer-left so the board stays up. */
  match: MatchState | null;
  /** Board input gate: playing, ongoing, and my turn (or simultaneous). */
  canMove: boolean;
  /** Validate + apply my move locally; true → the caller relays it. */
  playMove(move: unknown): boolean;
  /** Relayed peer payload, tagged with its seat — applyMove validates it,
   * ill-fitting drops. */
  applyPeerMove(payload: unknown, from: PlayerIndex): void;
}

/** One running (or just-finished) match. `key` is the lobby "playing"
 * snapshot that started it — an identity token, not data. `you` is null for
 * a spectator: the two-player games never change, the room just holds more
 * people around them. */
export interface MatchState {
  key: object;
  you: PlayerIndex | null;
  state: unknown;
}
