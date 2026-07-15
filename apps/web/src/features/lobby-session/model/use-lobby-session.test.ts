// Pure-reducer tests — no DOM, no socket. The session class's socket wiring
// is exercised end-to-end against the Durable Object; here we pin down every
// state transition, the Turkish error copy, and the capped-backoff walk.

import { describe, expect, it } from "vitest";
import type { RosterMember, ServerMessage } from "@/shared/lib/lobby-protocol";
import {
  INITIAL_SESSION_STATE,
  type LobbySessionState,
  reduceSession,
} from "./use-lobby-session";

const CODE = "AB2C";
const GAME_ID = "xox";

const HOST: RosterMember = {
  id: "h1",
  name: "Ayşe",
  role: "playing",
  isHost: true,
};
const GUEST: RosterMember = {
  id: "g1",
  name: "Kaan",
  role: "playing",
  isHost: false,
};

const connecting: LobbySessionState = {
  phase: "connecting",
  code: CODE,
  attempt: 0,
};

const roster: LobbySessionState = {
  phase: "roster",
  code: CODE,
  members: [HOST, GUEST],
  youId: HOST.id,
  gameId: null,
};

const playing: LobbySessionState = {
  phase: "playing",
  code: CODE,
  seed: 7,
  names: ["Ayşe", "Kaan"],
  you: 0,
  gameId: GAME_ID,
  isHost: true,
};

const peerLeft: LobbySessionState = {
  phase: "peer-left",
  code: CODE,
  names: ["Ayşe", "Kaan"],
  you: 0,
  gameId: GAME_ID,
  isHost: true,
};

function afterMessage(
  state: LobbySessionState,
  message: ServerMessage,
): LobbySessionState {
  return reduceSession(state, { kind: "message", message });
}

describe("reduceSession — happy path", () => {
  it("dials from idle into connecting at attempt 0", () => {
    expect(
      reduceSession(INITIAL_SESSION_STATE, { kind: "dial", code: CODE }),
    ).toEqual(connecting);
  });

  it("moves into roster (no game chosen yet) once the first roster broadcast arrives", () => {
    expect(
      afterMessage(connecting, {
        t: "roster",
        members: [HOST, GUEST],
        youId: HOST.id,
        gameId: null,
      }),
    ).toEqual(roster);
  });

  it("keeps updating roster — including a host's game pick — while still arranging", () => {
    const grown = [HOST, GUEST, { ...GUEST, id: "s1", role: "spectator" }] as [
      RosterMember,
      RosterMember,
      RosterMember,
    ];
    expect(
      afterMessage(roster, {
        t: "roster",
        members: grown,
        youId: HOST.id,
        gameId: GAME_ID,
      }),
    ).toEqual({
      phase: "roster",
      code: CODE,
      members: grown,
      youId: HOST.id,
      gameId: GAME_ID,
    });
  });

  it("starts playing once the host starts the match", () => {
    const message: ServerMessage = {
      t: "start",
      seed: 7,
      names: ["Ayşe", "Kaan"],
      you: 0,
      gameId: GAME_ID,
    };
    expect(afterMessage(roster, message)).toEqual(playing);
  });

  it("starts playing with more than two seats for a multi-player game", () => {
    const names = ["Ayşe", "Kaan", "Derya", "Emre"];
    const message: ServerMessage = {
      t: "start",
      seed: 3,
      names,
      you: 2,
      gameId: "sayi-tahmini",
    };
    expect(afterMessage(roster, message)).toEqual({
      phase: "playing",
      code: CODE,
      seed: 3,
      names,
      you: 2,
      gameId: "sayi-tahmini",
      isHost: true,
    });
  });

  it("starts playing as a non-host when the starter isn't the host", () => {
    const guestRoster: LobbySessionState = { ...roster, youId: GUEST.id };
    const message: ServerMessage = {
      t: "start",
      seed: 7,
      names: ["Ayşe", "Kaan"],
      you: 1,
      gameId: GAME_ID,
    };
    expect(afterMessage(guestRoster, message)).toEqual({
      ...playing,
      you: 1,
      isHost: false,
    });
  });

  it("starts playing with a null seat for a spectator", () => {
    const message: ServerMessage = {
      t: "start",
      seed: 7,
      names: ["Ayşe", "Kaan"],
      you: null,
      gameId: GAME_ID,
    };
    expect(afterMessage(roster, message)).toEqual({ ...playing, you: null });
  });

  it("resets to playing with the new seed on rematch-start", () => {
    expect(afterMessage(playing, { t: "rematch-start", seed: 99 })).toEqual({
      ...playing,
      seed: 99,
    });
  });

  it("keeps names, seat, and game through peer-left, then restarts on rejoin", () => {
    expect(afterMessage(playing, { t: "peer-left" })).toEqual(peerLeft);
    const rejoin: ServerMessage = {
      t: "start",
      seed: 12,
      names: ["Ayşe", "Derya"],
      you: 0,
      gameId: GAME_ID,
    };
    expect(afterMessage(peerLeft, rejoin)).toEqual({
      phase: "playing",
      code: CODE,
      seed: 12,
      names: ["Ayşe", "Derya"],
      you: 0,
      gameId: GAME_ID,
      isHost: true,
    });
  });

  it("ends the match and returns to roster when the host picks a different game mid-match", () => {
    const newPick: ServerMessage = {
      t: "roster",
      members: [HOST, GUEST],
      youId: HOST.id,
      gameId: "sayi-tahmini",
    };
    expect(afterMessage(playing, newPick)).toEqual({
      phase: "roster",
      code: CODE,
      members: [HOST, GUEST],
      youId: HOST.id,
      gameId: "sayi-tahmini",
    });
    // Clearing the pick (going back to game-select) is the same interrupt.
    expect(afterMessage(playing, { ...newPick, gameId: null })).toEqual({
      phase: "roster",
      code: CODE,
      members: [HOST, GUEST],
      youId: HOST.id,
      gameId: null,
    });
    // The same interrupt also fires from peer-left (host changes the game
    // instead of waiting for a rejoin).
    expect(afterMessage(peerLeft, newPick)).toEqual({
      phase: "roster",
      code: CODE,
      members: [HOST, GUEST],
      youId: HOST.id,
      gameId: "sayi-tahmini",
    });
  });

  it("treats peer-move as a side channel — state is untouched", () => {
    expect(
      afterMessage(playing, { t: "peer-move", payload: { cell: 4 }, from: 1 }),
    ).toBe(playing);
  });

  it("treats chat as a side channel — state is untouched", () => {
    expect(
      afterMessage(playing, {
        t: "chat",
        from: GUEST.id,
        fromName: GUEST.name,
        text: "selam",
        ts: 1,
      }),
    ).toBe(playing);
  });

  it("ignores a same-game roster broadcast (e.g. someone joining/leaving) once a match is live", () => {
    expect(
      afterMessage(playing, {
        t: "roster",
        members: [HOST, GUEST],
        youId: HOST.id,
        gameId: GAME_ID,
      }),
    ).toBe(playing);
  });

  it("refreshes isHost (without ending the match) when the host is reassigned mid-match", () => {
    // The guest's own connection: host disconnected, DO promoted them.
    const promoted: RosterMember = { ...GUEST, isHost: true };
    const formerHost: RosterMember = { ...HOST, isHost: false };
    const guestPlaying: LobbySessionState = {
      ...playing,
      you: 1,
      isHost: false,
    };
    expect(
      afterMessage(guestPlaying, {
        t: "roster",
        members: [formerHost, promoted],
        youId: GUEST.id,
        gameId: GAME_ID,
      }),
    ).toEqual({ ...guestPlaying, isHost: true });
    // Same, from peer-left — the promoted host still needs the refresh even
    // though the departure already forced peer-left on everyone else.
    const guestPeerLeft: LobbySessionState = { ...peerLeft, isHost: false };
    expect(
      afterMessage(guestPeerLeft, {
        t: "roster",
        members: [formerHost, promoted],
        youId: GUEST.id,
        gameId: GAME_ID,
      }),
    ).toEqual({ ...guestPeerLeft, isHost: true });
  });
});

describe("reduceSession — errors (stable Turkish copy)", () => {
  it("maps every protocol rejection to its message", () => {
    expect(
      afterMessage(connecting, { t: "error", reason: "not-found" }),
    ).toEqual({
      phase: "error",
      reason: "not-found",
      message: "Lobi bulunamadı",
    });
    expect(afterMessage(connecting, { t: "error", reason: "full" })).toEqual({
      phase: "error",
      reason: "full",
      message: "Lobi dolu",
    });
    expect(
      afterMessage(connecting, { t: "error", reason: "name-required" }),
    ).toEqual({
      phase: "error",
      reason: "name-required",
      message: "Takma ad gerekli",
    });
  });

  it("reports the generic message once redials are exhausted", () => {
    const exhausted = reduceSession(
      { phase: "connecting", code: CODE, attempt: 3 },
      { kind: "socket-closed" },
    );
    expect(exhausted).toEqual({
      phase: "error",
      reason: "connection",
      message: "Bağlantı koptu",
    });
  });
});

describe("reduceSession — reconnect backoff", () => {
  it("schedules redials 1..3 and only then gives up", () => {
    let state = reduceSession(playing, { kind: "socket-closed" });
    expect(state).toEqual({ phase: "connecting", code: CODE, attempt: 1 });
    state = reduceSession(state, { kind: "socket-closed" });
    expect(state).toEqual({ phase: "connecting", code: CODE, attempt: 2 });
    state = reduceSession(state, { kind: "socket-closed" });
    expect(state).toEqual({ phase: "connecting", code: CODE, attempt: 3 });
    state = reduceSession(state, { kind: "socket-closed" });
    expect(state.phase).toBe("error");
  });

  it("redials from roster and peer-left as well", () => {
    expect(reduceSession(roster, { kind: "socket-closed" })).toEqual({
      phase: "connecting",
      code: CODE,
      attempt: 1,
    });
    expect(reduceSession(peerLeft, { kind: "socket-closed" })).toEqual({
      phase: "connecting",
      code: CODE,
      attempt: 1,
    });
  });

  it("a successful reconnect resets the budget (roster clears attempt)", () => {
    const redialing: LobbySessionState = {
      phase: "connecting",
      code: CODE,
      attempt: 2,
    };
    const recovered = afterMessage(redialing, {
      t: "roster",
      members: [HOST, GUEST],
      youId: HOST.id,
      gameId: null,
    });
    expect(recovered).toEqual(roster);
    expect(reduceSession(recovered, { kind: "socket-closed" })).toEqual({
      phase: "connecting",
      code: CODE,
      attempt: 1,
    });
  });

  it("ignores closes after the session settled", () => {
    const closed: LobbySessionState = { phase: "closed" };
    const failed: LobbySessionState = {
      phase: "error",
      reason: "full",
      message: "Lobi dolu",
    };
    expect(
      reduceSession(INITIAL_SESSION_STATE, { kind: "socket-closed" }),
    ).toBe(INITIAL_SESSION_STATE);
    expect(reduceSession(closed, { kind: "socket-closed" })).toBe(closed);
    expect(reduceSession(failed, { kind: "socket-closed" })).toBe(failed);
  });
});

describe("reduceSession — leaving and retrying", () => {
  it("leave settles every live phase to closed (idle stays idle)", () => {
    expect(reduceSession(INITIAL_SESSION_STATE, { kind: "leave" })).toBe(
      INITIAL_SESSION_STATE,
    );
    for (const state of [connecting, roster, playing, peerLeft]) {
      expect(reduceSession(state, { kind: "leave" })).toEqual({
        phase: "closed",
      });
    }
  });

  it("a fresh dial restarts from error or closed", () => {
    const failed: LobbySessionState = {
      phase: "error",
      reason: "connection",
      message: "Bağlantı koptu",
    };
    expect(reduceSession(failed, { kind: "dial", code: "XY34" })).toEqual({
      phase: "connecting",
      code: "XY34",
      attempt: 0,
    });
    expect(
      reduceSession({ phase: "closed" }, { kind: "dial", code: "XY34" }),
    ).toEqual({ phase: "connecting", code: "XY34", attempt: 0 });
  });

  it("ignores out-of-phase messages without inventing states", () => {
    expect(afterMessage(roster, { t: "rematch-start", seed: 5 })).toBe(
      roster,
    );
    expect(afterMessage(roster, { t: "peer-left" })).toBe(roster);
    expect(
      afterMessage(INITIAL_SESSION_STATE, {
        t: "start",
        seed: 1,
        names: ["a", "b"],
        you: 1,
        gameId: GAME_ID,
      }),
    ).toBe(INITIAL_SESSION_STATE);
  });
});
