// Reducer tests for Kapmaca: one pot per seat worth 1…N, host settings
// (rounds, countdown) clamped on the way in, locked one-claim-per-round
// picking, the two ways a round ends (everyone claimed, or the countdown's
// `resolveRound`), unique-pick scoring — a pot claimed once pays face value,
// a pot claimed twice or more pays nobody, an unclaimed pot and a silent seat
// both simply score zero — the fixed reveal window (`revealing` blocks
// everything but a round-matched `advanceRound`), and end-of-match
// outright-win vs shared-top-as-draw detection.

import { describe, expect, it } from "vitest";
import {
  claimedCount,
  DEFAULT_COUNTDOWN_SECONDS,
  DEFAULT_ROUNDS,
  isFinished,
  isValidPot,
  type KapmacaMove,
  type KapmacaState,
  kapmacaGame,
  leaders,
  MAX_COUNTDOWN_SECONDS,
  MAX_ROUNDS,
  MIN_COUNTDOWN_SECONDS,
  MIN_ROUNDS,
  potValue,
  REVEAL_SECONDS,
  standings,
} from "./rules";

const { init, applyMove, status, turn } = kapmacaGame;

// ── Helpers ──────────────────────────────────────────────────────────────────

function must(
  state: KapmacaState,
  move: KapmacaMove,
  player: number,
): KapmacaState {
  const next = applyMove(state, move, player);
  expect(next).not.toBeNull();
  return next as KapmacaState;
}

/** Claims one pot per seat (null = that seat stays silent), forces the round
 * to settle, then dismisses the reveal — one full round, start to finish. */
function playRound(
  state: KapmacaState,
  picks: readonly (number | null)[],
): KapmacaState {
  let current = state;
  picks.forEach((pot, seat) => {
    if (pot !== null) current = must(current, { t: "pick", pot }, seat);
  });
  if (current.revealing === null) {
    current = must(current, { t: "resolveRound", round: current.round }, 0);
  }
  const round = current.revealing?.round as number;
  return must(current, { t: "advanceRound", round }, 0);
}

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(kapmacaGame.meta.id).toBe("kapmaca");
    expect(kapmacaGame.meta.name).toBe("Kapmaca");
    expect(kapmacaGame.meta.minPlayers).toBe(2);
    expect(kapmacaGame.meta.maxPlayers).toBe(16);
  });

  it("exposes the two host knobs", () => {
    const fields = kapmacaGame.meta.settings ?? [];
    expect(fields.map((field) => field.key)).toEqual([
      "rounds",
      "countdownSeconds",
    ]);
    expect(fields[0]).toEqual({
      key: "rounds",
      label: "Tur sayısı",
      min: MIN_ROUNDS,
      max: MAX_ROUNDS,
      default: DEFAULT_ROUNDS,
    });
    expect(fields[1].min).toBe(MIN_COUNTDOWN_SECONDS);
    expect(fields[1].max).toBe(MAX_COUNTDOWN_SECONDS);
    expect(fields[1].default).toBe(DEFAULT_COUNTDOWN_SECONDS);
  });

  it("keeps the reveal long enough to read", () => {
    expect(REVEAL_SECONDS).toBeGreaterThanOrEqual(3);
  });
});

describe("pot values", () => {
  it("runs 1 … potCount over 0-based indices", () => {
    expect(potValue(0)).toBe(1);
    expect(potValue(4)).toBe(5);
  });

  it("accepts only in-range integers", () => {
    expect(isValidPot(0, 3)).toBe(true);
    expect(isValidPot(2, 3)).toBe(true);
    expect(isValidPot(3, 3)).toBe(false);
    expect(isValidPot(-1, 3)).toBe(false);
    expect(isValidPot(1.5, 3)).toBe(false);
  });
});

describe("init", () => {
  it("gives every seat a pot and a zero score", () => {
    const state = init(0, 5, { rounds: 3, countdownSeconds: 20 });
    expect(state.potCount).toBe(5);
    expect(state.scores).toEqual([0, 0, 0, 0, 0]);
    expect(state.picks).toEqual([null, null, null, null, null]);
    expect(state.totalRounds).toBe(3);
    expect(state.countdownSeconds).toBe(20);
    expect(status(state).kind).toBe("ongoing");
    expect(turn(state)).toBeNull();
  });

  it("clamps host settings that crossed the wire", () => {
    const high = init(0, 4, { rounds: 999, countdownSeconds: 999 });
    expect(high.totalRounds).toBe(MAX_ROUNDS);
    expect(high.countdownSeconds).toBe(MAX_COUNTDOWN_SECONDS);
    const low = init(0, 4, { rounds: 0, countdownSeconds: 1 });
    expect(low.totalRounds).toBe(MIN_ROUNDS);
    expect(low.countdownSeconds).toBe(MIN_COUNTDOWN_SECONDS);
  });

  it("defaults anything the host left alone", () => {
    const state = init(0, 4);
    expect(state.totalRounds).toBe(DEFAULT_ROUNDS);
    expect(state.countdownSeconds).toBe(DEFAULT_COUNTDOWN_SECONDS);
  });

  it("ignores the seed — nothing here is random", () => {
    expect(init(1, 4, {})).toEqual(init(99999, 4, {}));
  });
});

describe("picking", () => {
  it("records my claim and nobody else's", () => {
    const state = must(init(0, 3, { rounds: 2 }), { t: "pick", pot: 2 }, 0);
    expect(state.picks).toEqual([2, null, null]);
    expect(claimedCount(state)).toBe(1);
    expect(state.revealing).toBeNull();
  });

  it("locks the claim for the round", () => {
    const state = must(init(0, 3, { rounds: 2 }), { t: "pick", pot: 2 }, 0);
    expect(applyMove(state, { t: "pick", pot: 1 }, 0)).toBeNull();
  });

  it("rejects an off-range pot or an off-table seat", () => {
    const state = init(0, 3, { rounds: 2 });
    expect(applyMove(state, { t: "pick", pot: 3 }, 0)).toBeNull();
    expect(applyMove(state, { t: "pick", pot: -1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "pick", pot: 1.5 }, 0)).toBeNull();
    expect(applyMove(state, { t: "pick", pot: 0 }, 9)).toBeNull();
  });

  it("settles the round on the final claim", () => {
    let state = init(0, 3, { rounds: 2 });
    state = must(state, { t: "pick", pot: 0 }, 0);
    state = must(state, { t: "pick", pot: 1 }, 1);
    expect(state.revealing).toBeNull();
    state = must(state, { t: "pick", pot: 2 }, 2);
    expect(state.revealing).not.toBeNull();
  });
});

describe("scoring", () => {
  it("pays face value when every claim is unique", () => {
    let state = init(0, 3, { rounds: 2 });
    state = must(state, { t: "pick", pot: 0 }, 0);
    state = must(state, { t: "pick", pot: 1 }, 1);
    state = must(state, { t: "pick", pot: 2 }, 2);
    expect(state.scores).toEqual([1, 2, 3]);
    expect(state.revealing?.awarded).toEqual([1, 2, 3]);
    expect(state.revealing?.contestedPots).toEqual([]);
  });

  it("pays nobody for a pot two seats grabbed", () => {
    let state = init(0, 3, { rounds: 2 });
    state = must(state, { t: "pick", pot: 2 }, 0);
    state = must(state, { t: "pick", pot: 2 }, 1);
    state = must(state, { t: "pick", pot: 0 }, 2);
    expect(state.scores).toEqual([0, 0, 1]);
    expect(state.revealing?.contestedPots).toEqual([2]);
  });

  it("pays nobody for a three-way grab either", () => {
    let state = init(0, 3, { rounds: 2 });
    state = must(state, { t: "pick", pot: 1 }, 0);
    state = must(state, { t: "pick", pot: 1 }, 1);
    state = must(state, { t: "pick", pot: 1 }, 2);
    expect(state.scores).toEqual([0, 0, 0]);
    expect(state.revealing?.contestedPots).toEqual([1]);
  });

  it("scores a silent seat zero without blocking the round", () => {
    let state = init(0, 3, { rounds: 2 });
    state = must(state, { t: "pick", pot: 2 }, 0);
    state = must(state, { t: "pick", pot: 1 }, 1);
    expect(state.revealing).toBeNull();
    state = must(state, { t: "resolveRound", round: 0 }, 0);
    expect(state.scores).toEqual([3, 2, 0]);
    // Two nulls must never read as "both grabbed the same pot".
    expect(state.revealing?.contestedPots).toEqual([]);
  });

  it("handles a round nobody claimed anything in", () => {
    const state = must(init(0, 3, { rounds: 2 }), { t: "resolveRound", round: 0 }, 1);
    expect(state.scores).toEqual([0, 0, 0]);
    expect(state.revealing).not.toBeNull();
  });

  it("accumulates across rounds", () => {
    let state = init(0, 3, { rounds: 3 });
    state = playRound(state, [2, 1, 0]);
    expect(state.scores).toEqual([3, 2, 1]);
    state = playRound(state, [0, 2, 1]);
    expect(state.scores).toEqual([4, 5, 3]);
  });
});

describe("reveal window", () => {
  it("blocks every move but a round-matched advanceRound", () => {
    let state = init(0, 3, { rounds: 3 });
    state = must(state, { t: "pick", pot: 0 }, 0);
    state = must(state, { t: "pick", pot: 1 }, 1);
    state = must(state, { t: "pick", pot: 2 }, 2);
    expect(applyMove(state, { t: "pick", pot: 0 }, 0)).toBeNull();
    expect(applyMove(state, { t: "resolveRound", round: 0 }, 0)).toBeNull();
    expect(applyMove(state, { t: "advanceRound", round: 7 }, 0)).toBeNull();
    const next = must(state, { t: "advanceRound", round: 0 }, 0);
    expect(next.round).toBe(1);
    expect(next.revealing).toBeNull();
    expect(next.picks).toEqual([null, null, null]);
    expect(next.scores).toEqual([1, 2, 3]);
    expect(next.history).toHaveLength(1);
  });

  it("makes a duplicate advanceRound a harmless no-op", () => {
    let state = init(0, 2, { rounds: 3 });
    state = must(state, { t: "pick", pot: 0 }, 0);
    state = must(state, { t: "pick", pot: 1 }, 1);
    const next = must(state, { t: "advanceRound", round: 0 }, 0);
    expect(applyMove(next, { t: "advanceRound", round: 0 }, 1)).toBeNull();
  });

  it("scopes resolveRound to the round it names", () => {
    let state = init(0, 3, { rounds: 3 });
    state = playRound(state, [0, 1, 2]);
    expect(state.round).toBe(1);
    expect(applyMove(state, { t: "resolveRound", round: 0 }, 0)).toBeNull();
    expect(applyMove(state, { t: "resolveRound", round: 1 }, 0)).not.toBeNull();
  });
});

describe("match end", () => {
  it("ends after the configured rounds and names the top scorer", () => {
    let state = init(0, 3, { rounds: 2 });
    state = playRound(state, [2, 1, 0]);
    expect(isFinished(state)).toBe(false);
    expect(status(state).kind).toBe("ongoing");
    state = playRound(state, [2, 1, 0]);
    expect(isFinished(state)).toBe(true);
    expect(state.scores).toEqual([6, 4, 2]);
    expect(status(state)).toEqual({ kind: "won", winners: [0] });
    expect(leaders(state)).toEqual([0]);
    expect(standings(state)).toEqual([0, 1, 2]);
    expect(state.history).toHaveLength(2);
  });

  it("refuses further moves once finished", () => {
    let state = init(0, 2, { rounds: 1 });
    state = playRound(state, [1, 0]);
    expect(isFinished(state)).toBe(true);
    expect(applyMove(state, { t: "pick", pot: 0 }, 0)).toBeNull();
    expect(applyMove(state, { t: "resolveRound", round: 1 }, 0)).toBeNull();
  });

  it("gives a shared top to everyone tied for it, not a draw", () => {
    let state = init(0, 3, { rounds: 1 });
    // Seats 0 and 1 both bank 3; seat 2 clashes with nobody but scores less.
    state = playRound(state, [2, null, 0]);
    state = { ...state, scores: [3, 3, 1], round: 1 };
    expect(status(state)).toEqual({ kind: "won", winners: [0, 1] });
    expect(leaders(state)).toEqual([0, 1]);
  });

  it("reports an everybody-tied table as a draw", () => {
    let state = init(0, 3, { rounds: 2 });
    state = playRound(state, [2, 1, 0]); // 3,2,1
    state = playRound(state, [0, 1, 2]); // 4,4,4
    expect(state.scores).toEqual([4, 4, 4]);
    expect(status(state).kind).toBe("draw");
    expect(leaders(state)).toEqual([0, 1, 2]);
  });

  it("treats an all-zero match as a draw between everyone", () => {
    let state = init(0, 2, { rounds: 1 });
    state = playRound(state, [1, 1]);
    expect(state.scores).toEqual([0, 0]);
    expect(status(state).kind).toBe("draw");
    expect(leaders(state)).toEqual([0, 1]);
  });

  it("sorts standings by score, keeping seat order on ties", () => {
    let state = init(0, 4, { rounds: 1 });
    state = playRound(state, [0, 3, 1, 3]); // seats 1 & 3 clash on pot 3
    expect(state.scores).toEqual([1, 0, 2, 0]);
    expect(standings(state)).toEqual([2, 0, 1, 3]);
  });

  it("runs the longest configured match to completion", () => {
    let state = init(0, 4, { rounds: MAX_ROUNDS });
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      state = playRound(state, [3, 2, 1, 0]);
    }
    expect(isFinished(state)).toBe(true);
    expect(state.scores).toEqual([80, 60, 40, 20]);
    expect(status(state)).toEqual({ kind: "won", winners: [0] });
  });
});
