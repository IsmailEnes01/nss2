// Reducer tests for Spektrum Çarkı: clue-phase gating (only the round's Clue
// Giver may submit, exactly one word, exactly once), guess-phase gating
// (every *other* seat may guess exactly once, and only the last outstanding
// guess resolves the round immediately), the `resolve` timeout move (missing
// guesses score 0, stale/premature proposals are no-ops), the score bands,
// round resolution + rotation across a full match, and the final win/draw
// call. Most fixtures build state by hand (never through `init`'s RNG) so
// the target/spectrum/rotation are pinned for exact assertions.

import { describe, expect, it } from "vitest";
import { SPECTRUMS } from "../config/spectrums";
import type { SpectrumMove, SpectrumState } from "./rules";
import {
  DEFAULT_COUNTDOWN_SECONDS,
  MAX_CLUE_LENGTH,
  MAX_COUNTDOWN_SECONDS,
  MAX_TARGET,
  MIN_COUNTDOWN_SECONDS,
  MIN_TARGET,
  pointsForDistance,
  spectrumGame,
} from "./rules";

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(spectrumGame.meta.id).toBe("spektrum-carki");
    expect(spectrumGame.meta.name).toBe("Spektrum Çarkı");
    expect(spectrumGame.meta.minPlayers).toBe(2);
    expect(spectrumGame.meta.maxPlayers).toBe(16);
    expect(spectrumGame.playerLabel(0)).toBe("Oyuncu 1");
    expect(spectrumGame.playerLabel(3)).toBe("Oyuncu 4");
  });

  it("declares the countdown as a host-configurable setting", () => {
    expect(spectrumGame.meta.settings).toEqual([
      {
        key: "countdownSeconds",
        label: "Tahmin süresi (sn)",
        min: MIN_COUNTDOWN_SECONDS,
        max: MAX_COUNTDOWN_SECONDS,
        default: DEFAULT_COUNTDOWN_SECONDS,
      },
    ]);
  });
});

describe("init", () => {
  it("fixes one spectrum, one target, and one Clue Giver seat per player", () => {
    const state = spectrumGame.init(1, 4, {});
    expect(state.spectrums).toHaveLength(4);
    expect(state.targets).toHaveLength(4);
    expect(state.clueGivers).toHaveLength(4);
    for (const target of state.targets) {
      expect(target).toBeGreaterThanOrEqual(MIN_TARGET);
      expect(target).toBeLessThanOrEqual(MAX_TARGET);
    }
    expect(state.current).toBe(0);
    expect(state.clue).toBeNull();
    expect(state.guesses).toEqual([null, null, null, null]);
    expect(state.rounds).toEqual([]);
    expect(state.score).toEqual([0, 0, 0, 0]);
  });

  it("rotates every seat through Clue Giver exactly once", () => {
    const state = spectrumGame.init(7, 5, {});
    expect([...state.clueGivers].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4]);
    for (let i = 1; i < state.clueGivers.length; i += 1) {
      expect(state.clueGivers[i]).toBe((state.clueGivers[i - 1] + 1) % 5);
    }
  });

  it("is deterministic for the same seed and settings", () => {
    expect(spectrumGame.init(42, 3, {})).toEqual(spectrumGame.init(42, 3, {}));
  });

  it("the first round's turn is its Clue Giver", () => {
    const state = spectrumGame.init(1, 4, {});
    expect(spectrumGame.turn(state)).toBe(state.clueGivers[0]);
  });

  it("defaults the countdown to 15s when no setting is supplied", () => {
    expect(spectrumGame.init(1, 2, {}).countdownSeconds).toBe(
      DEFAULT_COUNTDOWN_SECONDS,
    );
  });

  it("takes the host's chosen countdown, clamped to the declared range", () => {
    expect(
      spectrumGame.init(1, 2, { countdownSeconds: 30 }).countdownSeconds,
    ).toBe(30);
    expect(
      spectrumGame.init(1, 2, { countdownSeconds: 1 }).countdownSeconds,
    ).toBe(MIN_COUNTDOWN_SECONDS);
    expect(
      spectrumGame.init(1, 2, { countdownSeconds: 999 }).countdownSeconds,
    ).toBe(MAX_COUNTDOWN_SECONDS);
    expect(
      spectrumGame.init(1, 2, { countdownSeconds: Number.NaN }).countdownSeconds,
    ).toBe(DEFAULT_COUNTDOWN_SECONDS);
  });
});

describe("pointsForDistance", () => {
  it("matches the published score bands", () => {
    expect(pointsForDistance(0)).toBe(4);
    expect(pointsForDistance(3)).toBe(4);
    expect(pointsForDistance(4)).toBe(3);
    expect(pointsForDistance(7)).toBe(3);
    expect(pointsForDistance(8)).toBe(2);
    expect(pointsForDistance(12)).toBe(2);
    expect(pointsForDistance(13)).toBe(1);
    expect(pointsForDistance(18)).toBe(1);
    expect(pointsForDistance(19)).toBe(0);
    expect(pointsForDistance(100)).toBe(0);
  });
});

describe("applyMove — clue phase", () => {
  it("only the round's Clue Giver may submit the clue", () => {
    const state = fixture({ clueGivers: [0, 1, 2] });
    expect(
      spectrumGame.applyMove(state, { t: "clue", text: "Tesla" }, 1),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "clue", text: "Tesla" }, 2),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "clue", text: "Tesla" }, 0)?.clue,
    ).toBe("Tesla");
  });

  it("rejects an empty, multi-word, or too-long clue", () => {
    const state = fixture({ clueGivers: [0, 1, 2] });
    expect(spectrumGame.applyMove(state, { t: "clue", text: "" }, 0)).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "clue", text: "   " }, 0),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "clue", text: "iki kelime" }, 0),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(
        state,
        { t: "clue", text: "a".repeat(MAX_CLUE_LENGTH + 1) },
        0,
      ),
    ).toBeNull();
  });

  it("trims the clue before storing it", () => {
    const state = fixture({ clueGivers: [0, 1, 2] });
    const next = spectrumGame.applyMove(state, { t: "clue", text: "  Tesla  " }, 0);
    expect(next?.clue).toBe("Tesla");
  });

  it("rejects a second clue once one is already set", () => {
    const state = fixture({ clueGivers: [0, 1, 2], clue: "Tesla" });
    expect(
      spectrumGame.applyMove(state, { t: "clue", text: "Volt" }, 0),
    ).toBeNull();
  });

  it("rejects malformed clue payloads", () => {
    const state = fixture({ clueGivers: [0, 1, 2] });
    for (const payload of [null, {}, "Tesla", { t: "clue" }, { t: "clue", text: 5 }]) {
      expect(
        spectrumGame.applyMove(state, payload as unknown as SpectrumMove, 0),
      ).toBeNull();
    }
  });
});

describe("applyMove — guess phase", () => {
  it("rejects a guess before a clue exists", () => {
    const state = fixture({ clueGivers: [0, 1, 2] });
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: 60 }, 1),
    ).toBeNull();
  });

  it("the Clue Giver cannot guess their own round", () => {
    const state = fixture({ clueGivers: [0, 1, 2], clue: "Tesla" });
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: 60 }, 0),
    ).toBeNull();
  });

  it("rejects an out-of-range or non-integer guess", () => {
    const state = fixture({ clueGivers: [0, 1, 2], clue: "Tesla" });
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: -1 }, 1),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: 101 }, 1),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: 50.5 }, 1),
    ).toBeNull();
  });

  it("rejects a second guess from the same seat", () => {
    const state = fixture({
      clueGivers: [0, 1, 2],
      clue: "Tesla",
      guesses: [null, 40, null],
    });
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: 60 }, 1),
    ).toBeNull();
  });

  it("records a guess without resolving while other guessers are still out", () => {
    const state = fixture({ clueGivers: [0, 1, 2], clue: "Tesla" });
    const next = spectrumGame.applyMove(state, { t: "guess", value: 60 }, 1);
    expect(next?.guesses).toEqual([null, 60, null]);
    expect(next?.current).toBe(0); // round still ongoing — seat 2 hasn't guessed
    expect(next?.rounds).toEqual([]);
  });

  it("the last outstanding guess resolves the round immediately", () => {
    const state = fixture({
      clueGivers: [0, 1, 2],
      targets: [50, 50, 50],
      clue: "Tesla",
      guesses: [null, 48, null], // seat 1 already in — distance 2 → 4 points
    });
    const next = spectrumGame.applyMove(state, { t: "guess", value: 62 }, 2); // distance 12 → 2 points
    expect(next?.current).toBe(1);
    expect(next?.rounds).toHaveLength(1);
    expect(next?.rounds[0].guesses).toEqual([null, 48, 62]);
    expect(next?.rounds[0].points).toEqual([3, 4, 2]); // clue giver: avg(4, 2) = 3
    expect(next?.score).toEqual([3, 4, 2]);
    expect(next?.guesses).toEqual([null, null, null]); // reset for the next round
  });

  it("a two-player round resolves the instant the sole guesser locks in", () => {
    const state = fixture({
      clueGivers: [0, 1],
      targets: [72, 10],
      clue: "Tesla",
    });
    const next = spectrumGame.applyMove(state, { t: "guess", value: 72 }, 1);
    expect(next?.rounds).toEqual([
      {
        spectrum: state.spectrums[0],
        clueGiver: 0,
        clue: "Tesla",
        target: 72,
        guesses: [null, 72],
        points: [4, 4],
      },
    ]);
    expect(next?.score).toEqual([4, 4]);
    expect(next?.current).toBe(1);
    expect(next?.clue).toBeNull();
  });
});

describe("applyMove — resolve (countdown timeout)", () => {
  it("is a no-op for a round other than the one it was scheduled for", () => {
    const state = fixture({ clueGivers: [0, 1, 2], clue: "Tesla", guesses: [null, 40, null] });
    expect(
      spectrumGame.applyMove(state, { t: "resolve", round: 1 }, 1),
    ).toBeNull();
  });

  it("is a no-op before a clue has even been given", () => {
    const state = fixture({ clueGivers: [0, 1, 2] });
    expect(
      spectrumGame.applyMove(state, { t: "resolve", round: 0 }, 1),
    ).toBeNull();
  });

  it("is a no-op if nobody has guessed yet (no countdown could have started)", () => {
    const state = fixture({ clueGivers: [0, 1, 2], clue: "Tesla" });
    expect(
      spectrumGame.applyMove(state, { t: "resolve", round: 0 }, 1),
    ).toBeNull();
  });

  it("scores missing guesses as 0 and resolves the round early", () => {
    const state = fixture({
      clueGivers: [0, 1, 2],
      targets: [50, 50, 50],
      clue: "Tesla",
      guesses: [null, 50, null], // seat 1 in (distance 0 → 4 pts), seat 2 never got to it
    });
    const next = spectrumGame.applyMove(state, { t: "resolve", round: 0 }, 2);
    expect(next?.rounds[0].guesses).toEqual([null, 50, null]);
    expect(next?.rounds[0].points).toEqual([2, 4, 0]); // clue giver: avg(4, 0) = 2
    expect(next?.score).toEqual([2, 4, 0]);
    expect(next?.current).toBe(1);
  });

  it("can be proposed by any seat, including the Clue Giver", () => {
    const state = fixture({
      clueGivers: [0, 1, 2],
      clue: "Tesla",
      guesses: [null, 40, null],
    });
    expect(
      spectrumGame.applyMove(state, { t: "resolve", round: 0 }, 0)?.current,
    ).toBe(1);
  });
});

describe("full match — rotation and cumulative score", () => {
  it("accumulates score across rounds and rotates the Clue Giver", () => {
    let state = fixture({
      clueGivers: [0, 1, 2],
      targets: [50, 50, 50],
      clue: "A",
    });
    state = apply(state, { t: "guess", value: 50 }, 1); // distance 0 → 4
    state = apply(state, { t: "guess", value: 50 }, 2); // distance 0 → 4, resolves
    expect(state.current).toBe(1);
    expect(state.score).toEqual([4, 4, 4]);
    expect(spectrumGame.turn(state)).toBe(1); // round 1's Clue Giver

    state = apply(state, { t: "clue", text: "B" }, 1);
    state = apply(state, { t: "guess", value: 45 }, 0); // distance 5 → 3
    state = apply(state, { t: "guess", value: 50 }, 2); // distance 0 → 4, resolves
    expect(state.current).toBe(2);
    // seat 1 (clue giver): avg(3, 4) = 4 → prior [4,4,4] + [3,4,4]
    expect(state.score).toEqual([7, 8, 8]);

    state = apply(state, { t: "clue", text: "C" }, 2);
    state = apply(state, { t: "guess", value: 70 }, 0); // distance 20 → 0
    state = apply(state, { t: "guess", value: 50 }, 1); // distance 0 → 4, resolves
    expect(state.current).toBeNull(); // every seat has been Clue Giver
    // seat 2 (clue giver): avg(0, 4) = 2 → prior [7,8,8] + [0,4,2]
    expect(state.score).toEqual([7, 12, 10]);
  });

  it("rejects any move once every seat has been Clue Giver", () => {
    const state = fixture({ clueGivers: [0, 1], current: null });
    expect(spectrumGame.applyMove(state, { t: "clue", text: "X" }, 0)).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "guess", value: 5 }, 1),
    ).toBeNull();
    expect(
      spectrumGame.applyMove(state, { t: "resolve", round: 1 }, 1),
    ).toBeNull();
  });
});

describe("status and turn once the match ends", () => {
  it("declares a single top scorer the winner", () => {
    const state = fixture({ clueGivers: [0, 1, 2], current: null, score: [5, 9, 3] });
    expect(spectrumGame.status(state)).toEqual({ kind: "won", winner: 1 });
    expect(spectrumGame.turn(state)).toBeNull();
  });

  it("is a draw when the top score is shared", () => {
    const state = fixture({ clueGivers: [0, 1, 2], current: null, score: [9, 9, 3] });
    expect(spectrumGame.status(state)).toEqual({ kind: "draw" });
  });

  it("is ongoing while a round remains", () => {
    const state = fixture({ clueGivers: [0, 1], current: 1, score: [4, 0] });
    expect(spectrumGame.status(state)).toEqual({ kind: "ongoing" });
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

/** A hand-built state, never routed through `init`'s RNG, so tests can pin
 * exact targets/rotation. `current` defaults to round 0; every other field
 * defaults to "round 0, nobody's guessed yet". */
function fixture(
  overrides: Partial<SpectrumState> & { clueGivers: readonly number[] },
): SpectrumState {
  const playerCount = overrides.clueGivers.length;
  return {
    spectrums: Array.from(
      { length: playerCount },
      (_, i) => SPECTRUMS[i % SPECTRUMS.length],
    ),
    targets: Array(playerCount).fill(50),
    rounds: [],
    current: 0,
    clue: null,
    guesses: Array(playerCount).fill(null),
    countdownSeconds: DEFAULT_COUNTDOWN_SECONDS,
    score: Array(playerCount).fill(0),
    ...overrides,
  };
}

function apply(
  state: SpectrumState,
  move: SpectrumMove,
  player: number,
): SpectrumState {
  const next = spectrumGame.applyMove(state, move, player);
  if (next === null) throw new Error("expected a legal move in this fixture");
  return next;
}
