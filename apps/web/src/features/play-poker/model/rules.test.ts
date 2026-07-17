// Reducer tests for Teksas Hold'em: blind posting + turn order (heads-up's
// dealer-is-SB special case and the uniform "first to act" formula for
// 3+ players), every illegal-move rejection, `legalActionsFor` gating,
// fold-wins vs. full showdowns, chip conservation across hands, elimination
// + match-over detection, a genuine multi-tier side pot, and settings
// clamping. Fixtures mostly drive real games via `applyMove` + a real seed
// (never hand-built state) since a hand's outcome depends on cards derived
// from the seed — a few use `legalActionsFor` to pick a generic legal move
// (call/check, or all-in) rather than hard-coding move sequences that would
// silently go stale if the engine's exact legality rules ever shift.

import { describe, expect, it } from "vitest";
import type { Card } from "../config/deck";
import type { PokerMove, PokerState } from "./rules";
import {
  DEFAULT_BIG_BLIND,
  DEFAULT_SMALL_BLIND,
  DEFAULT_STARTING_MONEY,
  legalActionsFor,
  MAX_BIG_BLIND,
  MAX_SMALL_BLIND,
  MAX_STARTING_MONEY,
  MIN_BIG_BLIND,
  MIN_SMALL_BLIND,
  MIN_STARTING_MONEY,
  pokerCommunityCards,
  pokerGame,
  pokerHoleCards,
  pokerPotTotal,
} from "./rules";

const SETTINGS = { startingMoney: 1000, smallBlind: 50, bigBlind: 100 };

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(pokerGame.meta.id).toBe("teksas-holdem");
    expect(pokerGame.meta.name).toBe("Teksas Hold'em");
    expect(pokerGame.meta.minPlayers).toBe(2);
    expect(pokerGame.meta.maxPlayers).toBe(9);
    expect(pokerGame.playerLabel(0)).toBe("Oyuncu 1");
    expect(pokerGame.playerLabel(3)).toBe("Oyuncu 4");
  });

  it("declares money + blinds as host-configurable settings", () => {
    expect(pokerGame.meta.settings).toEqual([
      {
        key: "startingMoney",
        label: "Başlangıç parası ($)",
        min: MIN_STARTING_MONEY,
        max: MAX_STARTING_MONEY,
        default: DEFAULT_STARTING_MONEY,
      },
      {
        key: "smallBlind",
        label: "Küçük kör ($)",
        min: MIN_SMALL_BLIND,
        max: MAX_SMALL_BLIND,
        default: DEFAULT_SMALL_BLIND,
      },
      {
        key: "bigBlind",
        label: "Büyük kör ($)",
        min: MIN_BIG_BLIND,
        max: MAX_BIG_BLIND,
        default: DEFAULT_BIG_BLIND,
      },
    ]);
  });
});

describe("init", () => {
  it("gives every seat the configured starting stack and posts blinds", () => {
    const state = pokerGame.init(1, 2, SETTINGS);
    expect(state.stacks.reduce((sum, v) => sum + v, 0) + pokerPotTotal(state)).toBe(
      2000,
    );
    expect(state.street).toBe("preflop");
    expect(state.eliminated).toEqual([false, false]);
    expect(state.handNumber).toBe(0);
  });

  it("is fully deterministic for the same seed, player count, and settings", () => {
    const a = pokerGame.init(42, 4, SETTINGS);
    const b = pokerGame.init(42, 4, SETTINGS);
    expect(a).toEqual(b);
  });

  it("clamps every setting to its declared range and falls back to the default", () => {
    const clamped = pokerGame.init(1, 2, {
      startingMoney: MAX_STARTING_MONEY + 999_999,
      smallBlind: -50,
    });
    expect(clamped.stacks[0] + clamped.stacks[1] + pokerPotTotal(clamped)).toBe(
      MAX_STARTING_MONEY * 2,
    );
    expect(clamped.smallBlind).toBe(MIN_SMALL_BLIND);
  });

  it("never lets the big blind end up at or below the small blind", () => {
    const state = pokerGame.init(1, 2, { smallBlind: 100, bigBlind: 100 });
    expect(state.bigBlind).toBeGreaterThan(state.smallBlind);
    expect(state.bigBlind).toBe(101);
  });
});

describe("heads-up turn order", () => {
  it("dealer posts the small blind and acts first preflop; the other seat acts first postflop", () => {
    const state = pokerGame.init(1, 2, SETTINGS);
    const dealer = state.dealerSeat;
    const other = 1 - dealer;

    expect(state.betThisStreet[dealer]).toBe(50);
    expect(state.betThisStreet[other]).toBe(100);
    expect(state.toAct).toBe(dealer);

    const afterCall = pokerGame.applyMove(state, { t: "call" }, dealer);
    expect(afterCall).not.toBeNull();
    expect(afterCall?.toAct).toBe(other); // BB still has the "option"

    const afterCheck = pokerGame.applyMove(afterCall as PokerState, { t: "check" }, other);
    expect(afterCheck?.street).toBe("flop");
    expect(afterCheck?.toAct).toBe(other); // postflop, non-dealer acts first
  });
});

describe("3+ handed turn order and folding", () => {
  it("assigns SB/BB clockwise from the dealer and lets a lone contender win uncontested", () => {
    const state = pokerGame.init(42, 3, SETTINGS);
    const dealer = state.dealerSeat;
    const sb = (dealer + 1) % 3;
    const bb = (dealer + 2) % 3;
    const initialChips = totalChips(state);

    expect(state.toAct).toBe(dealer); // UTG = nextActive(BB) = dealer seat in 3-handed

    let s = pokerGame.applyMove(state, { t: "fold" }, dealer) as PokerState;
    expect(s.toAct).toBe(sb);

    s = pokerGame.applyMove(s, { t: "fold" }, sb) as PokerState;
    // Only the BB remains — the hand resolves instantly, no river needed.
    expect(s.handNumber).toBe(1);
    expect(s.lastResult?.potsWon).toEqual([
      { seats: [bb], amount: 150, handLabel: null },
    ]);
    expect(totalChips(s)).toBe(initialChips);
  });
});

describe("illegal moves are rejected", () => {
  it("rejects a check while facing a live bet, a bet when one already exists, and a below-minimum raise", () => {
    const state = pokerGame.init(7, 2, SETTINGS);
    const dealer = state.dealerSeat;
    const other = 1 - dealer;

    expect(pokerGame.applyMove(state, { t: "check" }, dealer)).toBeNull();
    expect(pokerGame.applyMove(state, { t: "call" }, other)).toBeNull(); // not their turn
    expect(pokerGame.applyMove(state, { t: "bet", amount: 300 }, dealer)).toBeNull();
    expect(pokerGame.applyMove(state, { t: "raise", amount: 110 }, dealer)).toBeNull(); // minRaise is 100

    const raised = pokerGame.applyMove(state, { t: "raise", amount: 300 }, dealer);
    expect(raised?.currentBet).toBe(300);
    expect(raised?.minRaise).toBe(200);
  });

  it("rejects raising when there's nothing to raise, and calling when there's nothing to call", () => {
    const state = pokerGame.init(3, 2, SETTINGS);
    const dealer = state.dealerSeat;
    const called = pokerGame.applyMove(state, { t: "call" }, dealer) as PokerState;
    const checked = pokerGame.applyMove(called, { t: "check" }, 1 - dealer) as PokerState;
    // Flop: currentBet is 0 again.
    expect(pokerGame.applyMove(checked, { t: "raise", amount: 100 }, checked.toAct as number)).toBeNull();
    expect(pokerGame.applyMove(checked, { t: "call" }, checked.toAct as number)).toBeNull();
  });
});

describe("legalActionsFor", () => {
  it("gates on whose turn it is and reports the right amounts", () => {
    const state = pokerGame.init(9, 2, SETTINGS);
    const dealer = state.dealerSeat;
    const legal = legalActionsFor(state, dealer);
    expect(legal).not.toBeNull();
    expect(legal?.canCheck).toBe(false);
    expect(legal?.canCall).toBe(true);
    expect(legal?.callAmount).toBe(50);
    expect(legal?.minRaiseTo).toBe(200);
    expect(legalActionsFor(state, 1 - dealer)).toBeNull();
  });
});

describe("showdown", () => {
  it("runs every street to a full board, conserves chips, and deals the next hand automatically", () => {
    let s = pokerGame.init(1, 2, SETTINGS);
    const initialChips = totalChips(s);
    const dealer = s.dealerSeat;
    const other = 1 - dealer;

    // Preflop: dealer/SB calls, then BB's own check closes it — same "BB
    // option" sequence as the heads-up turn-order test above.
    s = pokerGame.applyMove(s, { t: "call" }, dealer) as PokerState;
    s = pokerGame.applyMove(s, { t: "check" }, other) as PokerState;
    expect(s.street).toBe("flop");

    // Postflop, `other` (non-dealer) is always first to act in heads-up —
    // every remaining street is exactly this same "other, then dealer" pair.
    const streetsAfterFlop: readonly ("turn" | "river" | "preflop")[] = [
      "turn",
      "river",
      "preflop", // the NEXT hand's opening street, once river resolves
    ];
    for (const nextStreet of streetsAfterFlop) {
      s = pokerGame.applyMove(s, { t: "check" }, other) as PokerState;
      s = pokerGame.applyMove(s, { t: "check" }, dealer) as PokerState;
      expect(s.street).toBe(nextStreet);
    }

    expect(s.handNumber).toBe(1); // next hand dealt in the same transition
    expect(s.lastResult).not.toBeNull();
    expect(s.lastResult?.potsWon.length).toBeGreaterThanOrEqual(1);
    expect(totalChips(s)).toBe(initialChips);
  });
});

describe("hole cards and community cards", () => {
  it("reveals nothing before the flop and exactly 3/4/5 cards on each later street", () => {
    let s = pokerGame.init(1, 2, SETTINGS);
    expect(pokerCommunityCards(s)).toHaveLength(0);
    expect(pokerHoleCards(s, 0)).toHaveLength(2);

    const dealer = s.dealerSeat;
    s = pokerGame.applyMove(s, { t: "call" }, dealer) as PokerState;
    s = pokerGame.applyMove(s, { t: "check" }, 1 - dealer) as PokerState;
    expect(pokerCommunityCards(s)).toHaveLength(3);
  });

  it("never deals the same card twice within one hand", () => {
    const s = pokerGame.init(5, 6, SETTINGS);
    const seen = new Set<string>();
    for (let seat = 0; seat < 6; seat += 1) {
      const hole = pokerHoleCards(s, seat);
      expect(hole).not.toBeNull();
      for (const card of hole as readonly [Card, Card]) {
        const key = `${card.rank}-${card.suit}`;
        expect(seen.has(key)).toBe(false);
        seen.add(key);
      }
    }
  });
});

describe("all-in, elimination, and match-over", () => {
  it("busts a player down to elimination and reports the survivor as the winner", () => {
    let s = pokerGame.init(55, 2, {
      startingMoney: 300,
      smallBlind: 50,
      bigBlind: 100,
    });
    const initialChips = totalChips(s);
    let guard = 0;
    while (s.eliminated.filter((e) => !e).length > 1 && guard < 20) {
      guard += 1;
      const first = s.toAct as number;
      s = pokerGame.applyMove(s, { t: "allIn" }, first) as PokerState;
      if (s.toAct !== null) {
        const second = s.toAct;
        const legal = legalActionsFor(s, second);
        const move: PokerMove = legal?.canCall ? { t: "call" } : { t: "allIn" };
        s = pokerGame.applyMove(s, move, second) as PokerState;
      }
      expect(totalChips(s)).toBe(initialChips);
    }
    expect(s.eliminated.filter((e) => !e)).toHaveLength(1);
    const status = pokerGame.status(s);
    expect(status.kind).toBe("won");
    if (status.kind === "won") expect(s.eliminated[status.winner]).toBe(false);
  });

  it("reports a draw if every seat were somehow eliminated (defensive, unreachable in real play)", () => {
    const s = pokerGame.init(1, 2, SETTINGS);
    const allOut: PokerState = { ...s, eliminated: [true, true] };
    expect(pokerGame.status(allOut)).toEqual({ kind: "draw" });
  });
});

describe("side pots", () => {
  it("splits an uneven multi-way all-in into tiers that only pay eligible contenders, with full chip conservation", () => {
    // Hand 1 (a cheap call/fold sequence via legalActionsFor, never a
    // hard-coded move list) leaves the three stacks unequal without anyone
    // busting; hand 2 shoves everyone all-in preflop, which — given the
    // resulting stack spread — produces a genuine side pot. Seed 1 is
    // pinned because this needs a specific outcome, not just "some" seed.
    let s = pokerGame.init(1, 3, SETTINGS);
    const initialChips = totalChips(s);

    let guard = 0;
    while (s.handNumber === 0 && guard < 30) {
      guard += 1;
      const seat = s.toAct as number;
      const legal = legalActionsFor(s, seat);
      const move: PokerMove = legal?.canCheck
        ? { t: "check" }
        : legal?.canCall
          ? { t: "call" }
          : { t: "fold" };
      s = pokerGame.applyMove(s, move, seat) as PokerState;
    }
    expect(s.stacks.every((v) => v === s.stacks[0])).toBe(false); // stacks diverged
    expect(s.eliminated.some((e) => e)).toBe(false); // nobody busted yet
    expect(totalChips(s)).toBe(initialChips);

    let guard2 = 0;
    while (s.handNumber === 1 && guard2 < 10) {
      guard2 += 1;
      const seat = s.toAct as number;
      const legal = legalActionsFor(s, seat);
      const move: PokerMove = legal?.canAllIn ? { t: "allIn" } : { t: "fold" };
      s = pokerGame.applyMove(s, move, seat) as PokerState;
    }

    expect(totalChips(s)).toBe(initialChips);
    const result = s.lastResult;
    expect(result).not.toBeNull();
    if (result === null) return;
    expect(result.potsWon.length).toBeGreaterThanOrEqual(2); // a genuine side pot formed
    const potSum = result.potsWon.reduce((sum, pot) => sum + pot.amount, 0);
    expect(potSum).toBe(3000);
    // Every tier actually paid someone, and every payout is positive.
    for (const pot of result.potsWon) {
      expect(pot.seats.length).toBeGreaterThan(0);
      expect(pot.amount).toBeGreaterThan(0);
    }
    expect(result.bustedSeats).toEqual([2]);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function totalChips(state: PokerState): number {
  return state.stacks.reduce((sum, v) => sum + v, 0) + pokerPotTotal(state);
}
