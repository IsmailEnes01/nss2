// Reducer tests for Sakla Kazma: grid-size schedule (5x5 → 4x4 → 3x3 → 2x2
// forever), hide/dig legality (range, integer, once per round, dig requires
// having hidden first but never waits for anyone else, never after
// elimination), the round countdown (`resolveRound`, idempotent,
// round-scoped, started by the round's first hide from anyone), the fixed
// reveal window (`revealing` blocks every move but `advanceRound`, which
// itself only fires once the reveal is actually pending), the two very
// different penalties (missing the hide window eliminates you outright;
// missing the dig window costs nothing), the "at least one OTHER player"
// self-dig exemption, early resolution once everyone's fully acted, and
// win/draw detection.

import { describe, expect, it } from "vitest";
import {
  DEFAULT_COUNTDOWN_SECONDS,
  gridSizeForRound,
  hideDigGame,
  isValidTile,
  MAX_COUNTDOWN_SECONDS,
  MIN_COUNTDOWN_SECONDS,
  REVEAL_SECONDS,
} from "./rules";
import type { HideDigState } from "./rules";

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(hideDigGame.meta.id).toBe("sakla-kazma");
    expect(hideDigGame.meta.name).toBe("Sakla Kazma");
    expect(hideDigGame.meta.minPlayers).toBe(2);
    expect(hideDigGame.meta.maxPlayers).toBe(12);
    expect(hideDigGame.playerLabel(0)).toBe("Oyuncu 1");
    expect(hideDigGame.playerLabel(3)).toBe("Oyuncu 4");
    expect(REVEAL_SECONDS).toBe(5);
  });

  it("declares the countdown as a host-configurable setting", () => {
    expect(hideDigGame.meta.settings).toEqual([
      {
        key: "countdownSeconds",
        label: "Sakla/kaz süresi (sn)",
        min: MIN_COUNTDOWN_SECONDS,
        max: MAX_COUNTDOWN_SECONDS,
        default: DEFAULT_COUNTDOWN_SECONDS,
      },
    ]);
  });
});

describe("gridSizeForRound", () => {
  it("shrinks 5x5 -> 4x4 -> 3x3 -> 2x2, then stays 2x2 forever", () => {
    expect(gridSizeForRound(0)).toBe(5);
    expect(gridSizeForRound(1)).toBe(4);
    expect(gridSizeForRound(2)).toBe(3);
    expect(gridSizeForRound(3)).toBe(2);
    expect(gridSizeForRound(10)).toBe(2);
  });
});

describe("isValidTile", () => {
  it("accepts only in-range integers", () => {
    expect(isValidTile(0, 5)).toBe(true);
    expect(isValidTile(24, 5)).toBe(true);
    expect(isValidTile(25, 5)).toBe(false);
    expect(isValidTile(-1, 5)).toBe(false);
    expect(isValidTile(1.5, 5)).toBe(false);
  });
});

describe("init", () => {
  it("starts round 0 on a 5x5 grid, nobody eliminated, nothing committed, no reveal pending", () => {
    const state = hideDigGame.init(1, 3, { countdownSeconds: 20 });
    expect(state.round).toBe(0);
    expect(state.gridSize).toBe(5);
    expect(state.countdownSeconds).toBe(20);
    expect(state.eliminated).toEqual([false, false, false]);
    expect(state.hides).toEqual([null, null, null]);
    expect(state.digs).toEqual([null, null, null]);
    expect(state.revealing).toBeNull();
    expect(hideDigGame.turn(state)).toBeNull(); // fully simultaneous, no exclusive turn
    expect(hideDigGame.status(state)).toEqual({ kind: "ongoing" });
  });

  it("ignores the seed entirely — two different seeds still start identically", () => {
    const a = hideDigGame.init(1, 3, {});
    const b = hideDigGame.init(999, 3, {});
    expect(a).toEqual(b);
  });
});

describe("digging doesn't wait for the whole table to finish hiding", () => {
  it("lets a seat dig right after its own hide, before anyone else has hidden at all", () => {
    let s = hideDigGame.init(1, 3);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 0 }, 0) as HideDigState;
    // seats 1 and 2 haven't hidden yet — seat 0 should still be able to dig.
    const afterDig = hideDigGame.applyMove(s, { t: "dig", tile: 4 }, 0);
    expect(afterDig).not.toBeNull();
    expect(afterDig?.digs[0]).toBe(4);
    expect(afterDig?.hides[1]).toBeNull();
    expect(afterDig?.hides[2]).toBeNull();
  });

  it("rejects digging before that same seat has hidden", () => {
    const s = hideDigGame.init(1, 2);
    expect(hideDigGame.applyMove(s, { t: "dig", tile: 0 }, 0)).toBeNull();
  });
});

describe("reveal window", () => {
  it("enters a reveal (not the next round) as soon as the round resolves, and blocks every move but advanceRound", () => {
    let s = hideDigGame.init(1, 2);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 0 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "dig", tile: 0 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "hide", tile: 1 }, 1) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "dig", tile: 1 }, 1) as HideDigState;

    expect(s.revealing).not.toBeNull();
    expect(s.revealing?.round).toBe(0);
    expect(s.round).toBe(0); // hasn't advanced yet — still mid-reveal
    expect(s.history).toHaveLength(1);

    // Nothing else is legal mid-reveal.
    expect(hideDigGame.applyMove(s, { t: "hide", tile: 2 }, 0)).toBeNull();
    expect(hideDigGame.applyMove(s, { t: "resolveRound", round: 0 }, 0)).toBeNull();
    // A stale advanceRound (wrong round number) is a no-op.
    expect(hideDigGame.applyMove(s, { t: "advanceRound", round: 99 }, 0)).toBeNull();

    const advanced = hideDigGame.applyMove(
      s,
      { t: "advanceRound", round: 0 },
      0,
    ) as HideDigState;
    expect(advanced.revealing).toBeNull();
    expect(advanced.round).toBe(1);
    expect(advanced.gridSize).toBe(4);
    expect(advanced.hides).toEqual([null, null]);

    // A second advanceRound for the same (now-consumed) round is a no-op.
    expect(hideDigGame.applyMove(advanced, { t: "advanceRound", round: 0 }, 0)).toBeNull();
  });

  it("ends the match without dealing a next round once the reveal is advanced past, if 0-1 seats remain", () => {
    let s = hideDigGame.init(2, 3);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 5 }, 0) as HideDigState;
    s = hideDigGame.applyMove(
      s,
      { t: "resolveRound", round: 0 },
      0,
    ) as HideDigState;
    expect(s.revealing).not.toBeNull(); // still shows the reveal even though the match already has a winner
    expect(hideDigGame.status(s)).toEqual({ kind: "won", winner: 0 });

    const advanced = hideDigGame.applyMove(
      s,
      { t: "advanceRound", round: 0 },
      0,
    ) as HideDigState;
    expect(advanced.revealing).toBeNull();
    expect(advanced.round).toBe(0); // no next round was dealt
    expect(hideDigGame.status(advanced)).toEqual({ kind: "won", winner: 0 });
  });
});

describe("self-dig exemption and cross-seat elimination", () => {
  it("exempts a self-dig on your own hide tile, but eliminates anyone dug by an OTHER seat", () => {
    let s = hideDigGame.init(1, 3);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 0 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "hide", tile: 1 }, 1) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "hide", tile: 2 }, 2) as HideDigState;

    s = hideDigGame.applyMove(s, { t: "dig", tile: 1 }, 0) as HideDigState; // seat0 digs seat1's tile
    s = hideDigGame.applyMove(s, { t: "dig", tile: 0 }, 1) as HideDigState; // seat1 digs seat0's tile
    s = hideDigGame.applyMove(s, { t: "dig", tile: 2 }, 2) as HideDigState; // seat2 digs their OWN tile — last action, resolves the round

    expect(s.eliminated[0]).toBe(true); // dug by seat1 (an other seat)
    expect(s.eliminated[1]).toBe(true); // dug by seat0 (an other seat)
    expect(s.eliminated[2]).toBe(false); // only self-dug — exempt
    expect(hideDigGame.status(s)).toEqual({ kind: "won", winner: 2 });

    const round = s.history[0];
    expect([...round.eliminated].sort()).toEqual([0, 1]);
  });

  it("resolves early the instant every alive seat has both hidden and dug — no need to wait out the countdown", () => {
    let s = hideDigGame.init(1, 2);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 0 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "dig", tile: 0 }, 0) as HideDigState;
    expect(s.revealing).toBeNull(); // seat1 hasn't finished yet
    s = hideDigGame.applyMove(s, { t: "hide", tile: 1 }, 1) as HideDigState;
    const resolved = hideDigGame.applyMove(s, { t: "dig", tile: 1 }, 1) as HideDigState;
    expect(resolved.revealing).not.toBeNull(); // both fully acted — round auto-resolved into reveal
  });
});

describe("hide timeout: missing the hide window eliminates you", () => {
  it("eliminates every seat that never hid once resolveRound fires, but leaves hiders alone", () => {
    let s = hideDigGame.init(2, 3);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 5 }, 0) as HideDigState;
    // seats 1 and 2 never hide — a stale round number is a no-op first
    expect(hideDigGame.applyMove(s, { t: "resolveRound", round: 99 }, 0)).toBeNull();
    const resolved = hideDigGame.applyMove(
      s,
      { t: "resolveRound", round: 0 },
      0,
    ) as HideDigState;
    expect(resolved.eliminated).toEqual([false, true, true]);
    expect(hideDigGame.status(resolved)).toEqual({ kind: "won", winner: 0 });
  });

  it("rejects resolveRound before any hide has landed (no countdown could have started)", () => {
    const s = hideDigGame.init(3, 2);
    expect(hideDigGame.applyMove(s, { t: "resolveRound", round: 0 }, 0)).toBeNull();
  });
});

describe("dig timeout: missing the dig window costs nothing", () => {
  it("eliminates nobody just for failing to dig in time, and deals the next (smaller) round after the reveal advances", () => {
    let s = hideDigGame.init(3, 2);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 0 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "hide", tile: 1 }, 1) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "dig", tile: 0 }, 0) as HideDigState; // digs own tile — no-op
    // seat1 hid but never digs
    s = hideDigGame.applyMove(s, { t: "resolveRound", round: 0 }, 0) as HideDigState;
    expect(s.eliminated).toEqual([false, false]);
    expect(hideDigGame.status(s)).toEqual({ kind: "ongoing" });

    const advanced = hideDigGame.applyMove(
      s,
      { t: "advanceRound", round: 0 },
      0,
    ) as HideDigState;
    expect(advanced.round).toBe(1);
    expect(advanced.gridSize).toBe(4);
  });
});

describe("draw", () => {
  it("declares a draw when a round eliminates every remaining seat at once", () => {
    let s = hideDigGame.init(4, 2);
    s = hideDigGame.applyMove(s, { t: "hide", tile: 3 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "hide", tile: 7 }, 1) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "dig", tile: 7 }, 0) as HideDigState;
    s = hideDigGame.applyMove(s, { t: "dig", tile: 3 }, 1) as HideDigState;
    expect(s.eliminated).toEqual([true, true]);
    expect(hideDigGame.status(s)).toEqual({ kind: "draw" });
    expect([...s.history[0].eliminated].sort()).toEqual([0, 1]);
  });
});

describe("illegal moves are rejected", () => {
  it("rejects out-of-range tiles, double commits, and any move from an eliminated seat", () => {
    let s = hideDigGame.init(9, 2);
    expect(hideDigGame.applyMove(s, { t: "hide", tile: -1 }, 0)).toBeNull();
    expect(hideDigGame.applyMove(s, { t: "hide", tile: 25 }, 0)).toBeNull(); // 5x5 = 0..24
    expect(hideDigGame.applyMove(s, { t: "hide", tile: 1.5 }, 0)).toBeNull();

    s = hideDigGame.applyMove(s, { t: "hide", tile: 0 }, 0) as HideDigState;
    expect(hideDigGame.applyMove(s, { t: "hide", tile: 1 }, 0)).toBeNull(); // one hide per round

    const eliminatedState: HideDigState = { ...s, eliminated: [true, false] };
    expect(hideDigGame.applyMove(eliminatedState, { t: "hide", tile: 2 }, 0)).toBeNull();
  });
});
