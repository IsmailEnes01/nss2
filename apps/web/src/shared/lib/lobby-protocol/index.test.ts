import { describe, expect, it } from "vitest";
import { parseClientMessage, parseServerMessage } from "./index";

describe("parseClientMessage", () => {
  it("accepts well-formed messages", () => {
    expect(parseClientMessage({ t: "move", payload: { cell: 4 } })).toEqual({
      t: "move",
      payload: { cell: 4 },
    });
    expect(
      parseClientMessage({
        t: "assign-role",
        memberId: "abc",
        role: "playing",
      }),
    ).toEqual({ t: "assign-role", memberId: "abc", role: "playing" });
    expect(
      parseClientMessage({ t: "randomize-roles", maxPlaying: 2 }),
    ).toEqual({ t: "randomize-roles", maxPlaying: 2 });
    expect(parseClientMessage({ t: "select-game", gameId: "xox" })).toEqual({
      t: "select-game",
      gameId: "xox",
    });
    expect(parseClientMessage({ t: "select-game", gameId: null })).toEqual({
      t: "select-game",
      gameId: null,
    });
    expect(
      parseClientMessage({ t: "start-match", settings: { countdownSeconds: 15 } }),
    ).toEqual({ t: "start-match", settings: { countdownSeconds: 15 } });
    expect(parseClientMessage({ t: "start-match", settings: {} })).toEqual({
      t: "start-match",
      settings: {},
    });
    expect(parseClientMessage({ t: "rematch" })).toEqual({ t: "rematch" });
    expect(parseClientMessage({ t: "chat", text: "selam" })).toEqual({
      t: "chat",
      text: "selam",
    });
    expect(parseClientMessage({ t: "leave" })).toEqual({ t: "leave" });
  });

  it("keeps arbitrary JSON as the move payload", () => {
    expect(parseClientMessage({ t: "move", payload: null })).toEqual({
      t: "move",
      payload: null,
    });
    expect(parseClientMessage({ t: "move", payload: [1, 2] })).toEqual({
      t: "move",
      payload: [1, 2],
    });
  });

  it("rejects non-objects and unknown tags", () => {
    expect(parseClientMessage(null)).toBeNull();
    expect(parseClientMessage(undefined)).toBeNull();
    expect(parseClientMessage("move")).toBeNull();
    expect(parseClientMessage(42)).toBeNull();
    expect(parseClientMessage([])).toBeNull();
    expect(parseClientMessage({})).toBeNull();
    expect(parseClientMessage({ t: "join", name: "x" })).toBeNull();
    expect(parseClientMessage({ t: "MOVE", payload: 1 })).toBeNull();
  });

  it("rejects a move without a payload field", () => {
    expect(parseClientMessage({ t: "move" })).toBeNull();
  });

  it("rejects ill-typed assign-role fields", () => {
    expect(
      parseClientMessage({ t: "assign-role", role: "playing" }),
    ).toBeNull();
    expect(
      parseClientMessage({ t: "assign-role", memberId: "abc", role: "A" }),
    ).toBeNull();
    expect(
      parseClientMessage({ t: "assign-role", memberId: 1, role: "playing" }),
    ).toBeNull();
    expect(
      parseClientMessage({ t: "assign-role", memberId: "abc" }),
    ).toBeNull();
  });

  it("rejects ill-typed randomize-roles fields", () => {
    expect(parseClientMessage({ t: "randomize-roles" })).toBeNull();
    expect(
      parseClientMessage({ t: "randomize-roles", maxPlaying: 0 }),
    ).toBeNull();
    expect(
      parseClientMessage({ t: "randomize-roles", maxPlaying: -1 }),
    ).toBeNull();
    expect(
      parseClientMessage({ t: "randomize-roles", maxPlaying: 2.5 }),
    ).toBeNull();
    expect(
      parseClientMessage({ t: "randomize-roles", maxPlaying: "2" }),
    ).toBeNull();
  });

  it("rejects ill-typed select-game fields (a missing gameId isn't the same as an explicit null)", () => {
    expect(parseClientMessage({ t: "select-game" })).toBeNull();
    expect(parseClientMessage({ t: "select-game", gameId: "" })).toBeNull();
    expect(parseClientMessage({ t: "select-game", gameId: 1 })).toBeNull();
  });

  it("rejects ill-typed start-match settings", () => {
    expect(parseClientMessage({ t: "start-match" })).toBeNull();
    expect(
      parseClientMessage({ t: "start-match", settings: "nope" }),
    ).toBeNull();
    expect(
      parseClientMessage({
        t: "start-match",
        settings: { countdownSeconds: "15" },
      }),
    ).toBeNull();
    expect(
      parseClientMessage({
        t: "start-match",
        settings: { countdownSeconds: Number.NaN },
      }),
    ).toBeNull();
  });

  it("trims, caps, and rejects empty/ill-typed chat text", () => {
    expect(parseClientMessage({ t: "chat" })).toBeNull();
    expect(parseClientMessage({ t: "chat", text: 1 })).toBeNull();
    expect(parseClientMessage({ t: "chat", text: "" })).toBeNull();
    expect(parseClientMessage({ t: "chat", text: "   " })).toBeNull();
    expect(
      parseClientMessage({ t: "chat", text: "  selam  " }),
    ).toEqual({ t: "chat", text: "selam" });
    expect(
      parseClientMessage({ t: "chat", text: "a".repeat(500) }),
    ).toEqual({ t: "chat", text: "a".repeat(300) });
  });

  it("drops unknown extra fields", () => {
    expect(parseClientMessage({ t: "rematch", sneaky: true })).toEqual({
      t: "rematch",
    });
    expect(parseClientMessage({ t: "move", payload: 1, extra: "no" })).toEqual({
      t: "move",
      payload: 1,
    });
    expect(
      parseClientMessage({
        t: "assign-role",
        memberId: "abc",
        role: "spectator",
        extra: "no",
      }),
    ).toEqual({ t: "assign-role", memberId: "abc", role: "spectator" });
  });
});

describe("parseServerMessage", () => {
  it("accepts well-formed messages", () => {
    expect(
      parseServerMessage({
        t: "roster",
        members: [
          { id: "1", name: "Ayşe", role: "playing", isHost: true },
          { id: "2", name: "Kaan", role: "spectator", isHost: false },
        ],
        youId: "1",
        gameId: null,
      }),
    ).toEqual({
      t: "roster",
      members: [
        { id: "1", name: "Ayşe", role: "playing", isHost: true },
        { id: "2", name: "Kaan", role: "spectator", isHost: false },
      ],
      youId: "1",
      gameId: null,
    });
    expect(
      parseServerMessage({
        t: "roster",
        members: [{ id: "1", name: "Ayşe", role: "playing", isHost: true }],
        youId: "1",
        gameId: "xox",
      }),
    ).toEqual({
      t: "roster",
      members: [{ id: "1", name: "Ayşe", role: "playing", isHost: true }],
      youId: "1",
      gameId: "xox",
    });
    expect(
      parseServerMessage({
        t: "start",
        seed: 123,
        names: ["Ayşe", "Mehmet", "Derya"],
        you: 2,
        gameId: "sayi-tahmini",
        settings: {},
      }),
    ).toEqual({
      t: "start",
      seed: 123,
      names: ["Ayşe", "Mehmet", "Derya"],
      you: 2,
      gameId: "sayi-tahmini",
      settings: {},
    });
    expect(
      parseServerMessage({
        t: "start",
        seed: 123,
        names: ["Ayşe", "Mehmet"],
        you: null,
        gameId: "xox",
        settings: { countdownSeconds: 20 },
      }),
    ).toEqual({
      t: "start",
      seed: 123,
      names: ["Ayşe", "Mehmet"],
      you: null,
      gameId: "xox",
      settings: { countdownSeconds: 20 },
    });
    expect(
      parseServerMessage({ t: "peer-move", payload: { r: 0 }, from: 3 }),
    ).toEqual({
      t: "peer-move",
      payload: { r: 0 },
      from: 3,
    });
    expect(parseServerMessage({ t: "rematch-start", seed: 9 })).toEqual({
      t: "rematch-start",
      seed: 9,
    });
    expect(parseServerMessage({ t: "peer-left" })).toEqual({ t: "peer-left" });
    expect(
      parseServerMessage({
        t: "chat",
        from: "1",
        fromName: "Ayşe",
        text: "selam",
        ts: 1000,
      }),
    ).toEqual({ t: "chat", from: "1", fromName: "Ayşe", text: "selam", ts: 1000 });
    expect(parseServerMessage({ t: "error", reason: "full" })).toEqual({
      t: "error",
      reason: "full",
    });
  });

  it("rejects non-objects and unknown tags", () => {
    expect(parseServerMessage(null)).toBeNull();
    expect(parseServerMessage("start")).toBeNull();
    expect(parseServerMessage([])).toBeNull();
    expect(parseServerMessage({ t: "restart" })).toBeNull();
  });

  it("rejects ill-typed roster fields", () => {
    const valid = {
      t: "roster",
      members: [{ id: "1", name: "a", role: "playing", isHost: true }],
      youId: "1",
      gameId: null,
    };
    expect(parseServerMessage(valid)).not.toBeNull();
    expect(parseServerMessage({ ...valid, members: "nope" })).toBeNull();
    expect(parseServerMessage({ ...valid, youId: 1 })).toBeNull();
    expect(parseServerMessage({ ...valid, gameId: 5 })).toBeNull();
    expect(
      parseServerMessage({
        ...valid,
        members: [{ id: "1", name: "a", role: "A", isHost: true }],
      }),
    ).toBeNull();
    expect(
      parseServerMessage({
        ...valid,
        members: [{ id: "1", name: "a", role: "playing" }],
      }),
    ).toBeNull();
  });

  it("rejects ill-typed start fields", () => {
    const valid = {
      t: "start",
      seed: 1,
      names: ["a", "b"],
      you: 0,
      gameId: "xox",
      settings: {},
    };
    expect(parseServerMessage(valid)).not.toBeNull();
    expect(parseServerMessage({ ...valid, seed: "1" })).toBeNull();
    expect(parseServerMessage({ ...valid, seed: Number.NaN })).toBeNull();
    expect(parseServerMessage({ ...valid, names: ["a"] })).toBeNull();
    expect(parseServerMessage({ ...valid, names: ["a", 2] })).toBeNull();
    expect(parseServerMessage({ ...valid, names: "ab" })).toBeNull();
    expect(parseServerMessage({ ...valid, you: -1 })).toBeNull();
    expect(parseServerMessage({ ...valid, you: 1.5 })).toBeNull();
    expect(parseServerMessage({ ...valid, you: "0" })).toBeNull();
    expect(parseServerMessage({ ...valid, gameId: "" })).toBeNull();
    expect(parseServerMessage({ ...valid, gameId: null })).toBeNull();
    expect(parseServerMessage({ ...valid, gameId: 1 })).toBeNull();
    expect(parseServerMessage({ ...valid, settings: "nope" })).toBeNull();
    expect(
      parseServerMessage({ ...valid, settings: { countdownSeconds: "15" } }),
    ).toBeNull();
  });

  it("accepts a names list longer than two for multi-player games", () => {
    const many = {
      t: "start",
      seed: 1,
      names: Array.from({ length: 10 }, (_, i) => `Oyuncu ${i}`),
      you: 9,
      gameId: "sayi-tahmini",
      settings: { countdownSeconds: 15 },
    };
    expect(parseServerMessage(many)).toEqual(many);
  });

  it("rejects a peer-move without a valid seat index", () => {
    expect(parseServerMessage({ t: "peer-move", payload: 1 })).toBeNull();
    expect(
      parseServerMessage({ t: "peer-move", payload: 1, from: -1 }),
    ).toBeNull();
    expect(
      parseServerMessage({ t: "peer-move", payload: 1, from: 1.5 }),
    ).toBeNull();
    expect(parseServerMessage({ t: "peer-move", from: 0 })).toBeNull();
  });

  it("rejects other ill-typed fields", () => {
    expect(parseServerMessage({ t: "rematch-start", seed: "9" })).toBeNull();
    expect(parseServerMessage({ t: "error", reason: "banned" })).toBeNull();
    expect(parseServerMessage({ t: "error" })).toBeNull();
  });

  it("rejects ill-typed chat fields", () => {
    const valid = { t: "chat", from: "1", fromName: "a", text: "hi", ts: 1 };
    expect(parseServerMessage(valid)).not.toBeNull();
    expect(parseServerMessage({ ...valid, from: 1 })).toBeNull();
    expect(parseServerMessage({ ...valid, fromName: 1 })).toBeNull();
    expect(parseServerMessage({ ...valid, text: "" })).toBeNull();
    expect(parseServerMessage({ ...valid, text: 1 })).toBeNull();
    expect(parseServerMessage({ ...valid, ts: "1" })).toBeNull();
    expect(parseServerMessage({ ...valid, ts: Number.NaN })).toBeNull();
  });

  it("drops unknown extra fields", () => {
    expect(parseServerMessage({ t: "peer-left", ghost: 1 })).toEqual({
      t: "peer-left",
    });
    expect(
      parseServerMessage({
        t: "start",
        seed: 5,
        names: ["a", "b"],
        you: 0,
        gameId: "xox",
        settings: {},
        injected: "nope",
      }),
    ).toEqual({
      t: "start",
      seed: 5,
      names: ["a", "b"],
      you: 0,
      gameId: "xox",
      settings: {},
    });
  });
});
