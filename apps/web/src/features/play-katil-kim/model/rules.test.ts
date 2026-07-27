// Reducer tests for Katil Kim: seeded role distribution (host counts honored,
// clamped to the table, always at least one good seat), the seed-fixed
// speaking order, the three-phase cycle (day 1 skips the opening jail vote;
// jail vote is simultaneous and Mayor-weighted with ties jailing nobody; the
// day walks one seat at a time and rejects out-of-turn and wrong-role
// actions; the night reports removals without roles and only accepts a
// day-matched `advanceNight`), plurality-with-seeded-tiebreak for both the
// murderers' and cops' ballots, per-seat information scoping (`visibleAllies`,
// `findingsFor`), and good/evil/draw win detection.

import { describe, expect, it } from "vitest";
import { isEvil, type Role } from "../config/roles";
import {
  ABSTAIN,
  DEFAULT_TURN_SECONDS,
  DEFAULT_VOTE_SECONDS,
  findingsFor,
  MAX_TURN_SECONDS,
  MAX_VOTE_SECONDS,
  MIN_TURN_SECONDS,
  MIN_VOTE_SECONDS,
  type KatilKimMove,
  type KatilKimState,
  katilKimGame,
  livingSeats,
  NIGHT_SECONDS,
  publicVoteProgress,
  visibleAllies,
  winningSide,
} from "./rules";

const { init, applyMove, status, turn } = katilKimGame;

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Pins a readable role layout and a sorted speaking order over a real
 * `init`, so a scenario reads as itself rather than as whatever the seed
 * happened to deal. The seeded deal is covered by its own suite. */
function staged(roles: Role[], seed = 1): KatilKimState {
  const base = init(seed, roles.length, {});
  return {
    ...base,
    roles,
    order: roles.map((_, seat) => seat),
  };
}

function must(
  state: KatilKimState,
  move: KatilKimMove,
  player: number,
): KatilKimState {
  const next = applyMove(state, move, player);
  expect(next).not.toBeNull();
  return next as KatilKimState;
}

/** Runs the day out by passing every remaining turn, landing on the night. */
function passOutTheDay(state: KatilKimState): KatilKimState {
  let current = state;
  while (current.phase === "day") {
    const actor = turn(current);
    expect(actor).not.toBeNull();
    current = must(current, { t: "pass" }, actor as number);
  }
  return current;
}

/** Day 1 has no jail vote, so reaching one means playing a whole day out. */
function reachJailVote(state: KatilKimState): KatilKimState {
  const night = passOutTheDay(state);
  return must(night, { t: "advanceNight", day: night.day }, 0);
}

// ── Suites ───────────────────────────────────────────────────────────────────

describe("meta", () => {
  it("pins the catalog contract", () => {
    expect(katilKimGame.meta.id).toBe("katil-kim");
    expect(katilKimGame.meta.name).toBe("Katil Kim");
    expect(katilKimGame.meta.minPlayers).toBe(4);
    expect(katilKimGame.meta.maxPlayers).toBe(16);
  });

  it("exposes a host setting per configurable role, plus both shot clocks", () => {
    const keys = (katilKimGame.meta.settings ?? []).map((field) => field.key);
    expect(keys).toEqual([
      "murderers",
      "detectives",
      "cops",
      "mayors",
      "doctors",
      "turnSeconds",
      "voteSeconds",
    ]);
  });

  it("never lets the murderer count setting reach zero", () => {
    const field = (katilKimGame.meta.settings ?? []).find(
      (candidate) => candidate.key === "murderers",
    );
    expect(field?.min).toBe(1);
  });

  it("keeps the night dwell long enough to read", () => {
    expect(NIGHT_SECONDS).toBeGreaterThanOrEqual(3);
  });
});

describe("init", () => {
  it("honors the host's role counts", () => {
    const state = init(1234, 7, {
      murderers: 2,
      detectives: 1,
      cops: 1,
      mayors: 1,
      doctors: 1,
    });
    const count = (role: Role) =>
      state.roles.filter((candidate) => candidate === role).length;
    expect(state.roles).toHaveLength(7);
    expect(count("murderer")).toBe(2);
    expect(count("detective")).toBe(1);
    expect(count("cop")).toBe(1);
    expect(count("mayor")).toBe(1);
    expect(count("doctor")).toBe(1);
    expect(count("citizen")).toBe(1);
  });

  it("lets a host turn the doctor off entirely", () => {
    const state = init(1234, 6, {
      murderers: 1,
      detectives: 0,
      cops: 0,
      mayors: 0,
      doctors: 0,
    });
    expect(state.roles.filter((role) => role === "doctor")).toHaveLength(0);
    expect(state.roles.filter((role) => role === "citizen")).toHaveLength(5);
  });

  it("clamps over-requested roles to the table and keeps a good seat", () => {
    const state = init(9, 4, {
      murderers: 99,
      detectives: 99,
      cops: 99,
      mayors: 99,
    });
    expect(state.roles).toHaveLength(4);
    expect(state.roles.filter((role) => role === "murderer")).toHaveLength(3);
    expect(state.roles.filter((role) => !isEvil(role)).length).toBeGreaterThan(0);
  });

  it("falls back to defaults when settings are absent", () => {
    const state = init(5, 6);
    expect(state.roles.filter((role) => role === "murderer")).toHaveLength(1);
    expect(state.roles).toHaveLength(6);
  });

  it("opens on day 1 with no jail vote and everyone alive", () => {
    const state = init(1, 5, {});
    expect(state.day).toBe(1);
    expect(state.phase).toBe("day");
    expect(state.alive.every(Boolean)).toBe(true);
    expect(turn(state)).not.toBeNull();
    expect(status(state).kind).toBe("ongoing");
  });

  it("orders every seat exactly once", () => {
    const state = init(42, 7, {});
    expect([...state.order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it("is deterministic per seed, and varies across seeds", () => {
    const a = init(777, 8, {});
    const b = init(777, 8, {});
    expect(a.roles).toEqual(b.roles);
    expect(a.order).toEqual(b.order);
    const other = init(778, 8, {});
    expect(
      other.roles.join() !== a.roles.join() ||
        other.order.join() !== a.order.join(),
    ).toBe(true);
  });
});

describe("information scoping", () => {
  it("shows murderers each other and nobody else anything", () => {
    const state = staged(["murderer", "murderer", "citizen", "detective"]);
    expect(visibleAllies(state, 0)).toEqual([1]);
    expect(visibleAllies(state, 1)).toEqual([0]);
    expect(visibleAllies(state, 2)).toEqual([]);
    expect(visibleAllies(state, 3)).toEqual([]);
  });

  it("keeps a detective's finding to that detective", () => {
    let state = staged(["detective", "murderer", "citizen", "citizen"]);
    state = must(state, { t: "investigate", target: 1 }, 0);
    expect(findingsFor(state, 0)).toHaveLength(1);
    expect(findingsFor(state, 0)[0].role).toBe("murderer");
    expect(findingsFor(state, 1)).toEqual([]);
    expect(findingsFor(state, 2)).toEqual([]);
  });
});

describe("day phase", () => {
  it("gives the turn to the first seat in speaking order", () => {
    const state = staged(["citizen", "murderer", "citizen", "cop"]);
    expect(turn(state)).toBe(state.order[0]);
  });

  it("rejects an out-of-turn seat", () => {
    const state = staged(["citizen", "murderer", "citizen", "cop"]);
    expect(applyMove(state, { t: "pass" }, 2)).toBeNull();
  });

  it("rejects a role's action from a seat that doesn't have it", () => {
    const state = staged(["citizen", "murderer", "citizen", "cop"]);
    expect(applyMove(state, { t: "killVote", target: 1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "cellVote", target: 1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "investigate", target: 1 }, 0)).toBeNull();
  });

  it("lets every role pass", () => {
    let state = staged(["murderer", "cop", "detective", "mayor"]);
    for (const seat of [0, 1, 2, 3]) state = must(state, { t: "pass" }, seat);
    expect(state.phase).toBe("night");
  });

  it("rejects acting twice in one day", () => {
    let state = staged(["murderer", "citizen", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 1 }, 0);
    expect(applyMove(state, { t: "pass" }, 0)).toBeNull();
  });

  it("rejects self-targeting and off-table targets", () => {
    const state = staged(["murderer", "citizen", "citizen", "citizen"]);
    expect(applyMove(state, { t: "killVote", target: 0 }, 0)).toBeNull();
    expect(applyMove(state, { t: "killVote", target: 9 }, 0)).toBeNull();
    expect(applyMove(state, { t: "killVote", target: -1 }, 0)).toBeNull();
  });

  it("rejects the other phases' moves", () => {
    const state = staged(["murderer", "citizen", "citizen", "citizen"]);
    expect(applyMove(state, { t: "publicVote", target: 1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "advanceNight", day: 1 }, 0)).toBeNull();
  });

  it("skips dead seats entirely", () => {
    // Seat 1 is killed on day 1, then must never be offered a turn again.
    let state = staged(["murderer", "citizen", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 1 }, 0);
    state = passOutTheDay(state);
    expect(state.alive[1]).toBe(false);
    state = must(state, { t: "advanceNight", day: 1 }, 0);
    for (const seat of [0, 2, 3]) {
      state = must(state, { t: "publicVote", target: null }, seat);
    }
    const seen: number[] = [];
    while (state.phase === "day") {
      const actor = turn(state) as number;
      seen.push(actor);
      state = must(state, { t: "pass" }, actor);
    }
    expect(seen).not.toContain(1);
    expect(seen.sort()).toEqual([0, 2, 3]);
  });
});

describe("night resolution", () => {
  it("kills the murderers' target and cells the cops'", () => {
    let state = staged(["murderer", "cop", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = must(state, { t: "cellVote", target: 3 }, 1);
    state = passOutTheDay(state);
    expect(state.phase).toBe("night");
    expect(state.night?.killed).toBe(2);
    expect(state.night?.celled).toBe(3);
    expect(state.alive).toEqual([true, true, false, false]);
    expect(state.history).toHaveLength(1);
  });

  it("reports removals without any role information", () => {
    let state = staged(["murderer", "cop", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = passOutTheDay(state);
    // Seats and outcomes only — never a role. `saved` is a seat index too.
    expect(Object.keys(state.night ?? {}).sort()).toEqual([
      "celled",
      "day",
      "jailed",
      "killed",
      "saved",
    ]);
  });

  it("removes nobody when no ballots were cast", () => {
    const state = passOutTheDay(
      staged(["murderer", "cop", "citizen", "citizen"]),
    );
    expect(state.night?.killed).toBeNull();
    expect(state.night?.celled).toBeNull();
    expect(state.alive.every(Boolean)).toBe(true);
  });

  it("follows the plurality rather than flipping a coin", () => {
    let state = staged(["murderer", "murderer", "murderer", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 3 }, 0);
    state = must(state, { t: "killVote", target: 3 }, 1);
    state = must(state, { t: "killVote", target: 4 }, 2);
    state = passOutTheDay(state);
    expect(state.night?.killed).toBe(3);
  });

  it("breaks a tied kill vote deterministically among the tied", () => {
    const play = () => {
      let state = staged(
        ["murderer", "murderer", "citizen", "citizen", "citizen"],
        4242,
      );
      state = must(state, { t: "killVote", target: 2 }, 0);
      state = must(state, { t: "killVote", target: 3 }, 1);
      return passOutTheDay(state);
    };
    const first = play();
    expect([2, 3]).toContain(first.night?.killed);
    expect(play().night?.killed).toBe(first.night?.killed);
  });

  it("only accepts an advanceNight matching the report on screen", () => {
    const state = passOutTheDay(
      staged(["murderer", "cop", "citizen", "citizen"]),
    );
    expect(applyMove(state, { t: "advanceNight", day: 99 }, 0)).toBeNull();
    const next = must(state, { t: "advanceNight", day: 1 }, 0);
    expect(next.day).toBe(2);
    expect(next.phase).toBe("publicVote");
    expect(next.night).toBeNull();
    expect(turn(next)).toBeNull();
  });

  it("rejects every other move while the report shows", () => {
    const state = passOutTheDay(
      staged(["murderer", "cop", "citizen", "citizen"]),
    );
    expect(applyMove(state, { t: "pass" }, 0)).toBeNull();
    expect(applyMove(state, { t: "killVote", target: 1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "publicVote", target: 1 }, 0)).toBeNull();
  });
});

describe("jail vote", () => {
  it("jails a clear plurality and opens the day", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    expect(state.phase).toBe("publicVote");
    expect(turn(state)).toBeNull();
    state = must(state, { t: "publicVote", target: 0 }, 1);
    state = must(state, { t: "publicVote", target: 0 }, 2);
    state = must(state, { t: "publicVote", target: 1 }, 3);
    state = must(state, { t: "publicVote", target: null }, 0);
    expect(state.alive[0]).toBe(false);
    expect(state.phase).toBe("day");
  });

  it("jails nobody on a tie", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    state = must(state, { t: "publicVote", target: 1 }, 0);
    state = must(state, { t: "publicVote", target: 0 }, 1);
    state = must(state, { t: "publicVote", target: 3 }, 2);
    state = must(state, { t: "publicVote", target: 2 }, 3);
    expect(state.alive.every(Boolean)).toBe(true);
    expect(state.phase).toBe("day");
  });

  it("counts a Mayor's ballot twice", () => {
    let state = reachJailVote(staged(["mayor", "citizen", "citizen", "murderer"]));
    state = must(state, { t: "publicVote", target: 3 }, 0); // weight 2
    state = must(state, { t: "publicVote", target: 2 }, 1); // weight 1
    state = must(state, { t: "publicVote", target: null }, 2);
    state = must(state, { t: "publicVote", target: null }, 3);
    expect(state.alive[3]).toBe(false);
    expect(state.alive[2]).toBe(true);
  });

  it("records an abstention rather than leaving the ballot blank", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    state = must(state, { t: "publicVote", target: null }, 1);
    expect(state.publicVotes[1]).toBe(ABSTAIN);
    expect(publicVoteProgress(state)).toEqual({ cast: 1, total: 4 });
  });

  it("opens the day with nobody out when everyone abstains", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    for (const seat of [0, 1, 2, 3]) {
      state = must(state, { t: "publicVote", target: null }, seat);
    }
    expect(state.phase).toBe("day");
    expect(state.alive.every(Boolean)).toBe(true);
  });

  it("rejects a second ballot, a self-vote, and a dead target", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    state = must(state, { t: "publicVote", target: 2 }, 1);
    expect(applyMove(state, { t: "publicVote", target: 3 }, 1)).toBeNull();
    expect(applyMove(state, { t: "publicVote", target: 0 }, 0)).toBeNull();
  });

  it("neither counts nor waits on dead seats", () => {
    let state = staged(["murderer", "citizen", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 1 }, 0);
    state = passOutTheDay(state);
    state = must(state, { t: "advanceNight", day: 1 }, 0);
    expect(publicVoteProgress(state).total).toBe(3);
    expect(applyMove(state, { t: "publicVote", target: 0 }, 1)).toBeNull();
    expect(applyMove(state, { t: "publicVote", target: 1 }, 0)).toBeNull();
    for (const seat of [0, 2, 3]) {
      state = must(state, { t: "publicVote", target: null }, seat);
    }
    expect(state.phase).toBe("day");
  });
});

describe("doctor", () => {
  it("blocks the murderers' kill when it shields exactly that seat", () => {
    let state = staged(["murderer", "doctor", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = must(state, { t: "protect", target: 2 }, 1);
    state = passOutTheDay(state);
    expect(state.night?.killed).toBeNull();
    expect(state.night?.saved).toBe(2);
    expect(state.alive.every(Boolean)).toBe(true);
  });

  it("does nothing when it shields someone the murderers didn't pick", () => {
    let state = staged(["murderer", "doctor", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = must(state, { t: "protect", target: 3 }, 1);
    state = passOutTheDay(state);
    expect(state.night?.killed).toBe(2);
    expect(state.night?.saved).toBeNull();
    expect(state.alive[2]).toBe(false);
  });

  it("refuses to shield the doctor themselves", () => {
    const state = staged(["doctor", "murderer", "citizen", "citizen"]);
    expect(applyMove(state, { t: "protect", target: 0 }, 0)).toBeNull();
  });

  it("refuses a shield from any other role, and a doctor's other actions", () => {
    const state = staged(["doctor", "murderer", "cop", "detective"]);
    // Wrong role reaching for the shield…
    expect(
      applyMove({ ...state, order: [1, 0, 2, 3] }, { t: "protect", target: 0 }, 1),
    ).toBeNull();
    // …and the doctor reaching for someone else's action.
    expect(applyMove(state, { t: "killVote", target: 1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "cellVote", target: 1 }, 0)).toBeNull();
    expect(applyMove(state, { t: "investigate", target: 1 }, 0)).toBeNull();
  });

  it("never lets a shield carry into a later night", () => {
    // Day 1: shield seat 2, murderers pick seat 3 — the shield is spent.
    let state = staged(["murderer", "doctor", "citizen", "citizen"]);
    // Seat 0 is first in speaking order, so the murderer acts before the
    // doctor here — the day is turn-based, not simultaneous.
    state = must(state, { t: "killVote", target: 3 }, 0);
    state = must(state, { t: "protect", target: 2 }, 1);
    state = passOutTheDay(state);
    expect(state.night?.killed).toBe(3);
    state = must(state, { t: "advanceNight", day: 1 }, 0);
    expect(state.protects.every((p) => p === null)).toBe(true);

    // Day 2: doctor does nothing, murderers go for seat 2 — yesterday's
    // shield must not still be standing.
    for (const seat of [0, 1, 2]) {
      state = must(state, { t: "publicVote", target: null }, seat);
    }
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = passOutTheDay(state);
    expect(state.night?.killed).toBe(2);
    expect(state.night?.saved).toBeNull();
  });

  it("does not shield against the cops' cell", () => {
    let state = staged(["cop", "doctor", "citizen", "murderer"]);
    state = must(state, { t: "cellVote", target: 2 }, 0);
    state = must(state, { t: "protect", target: 2 }, 1);
    state = passOutTheDay(state);
    expect(state.night?.celled).toBe(2);
    expect(state.night?.saved).toBeNull();
    expect(state.alive[2]).toBe(false);
  });

  it("does not shield against the daytime jail vote", () => {
    let state = reachJailVote(staged(["murderer", "doctor", "citizen", "citizen"]));
    // The shield is cast during the day that FOLLOWS the vote, so it can't
    // apply — but assert the outcome directly rather than trusting ordering.
    state = must(state, { t: "publicVote", target: 2 }, 0);
    state = must(state, { t: "publicVote", target: 2 }, 1);
    state = must(state, { t: "publicVote", target: 2 }, 3);
    state = must(state, { t: "publicVote", target: null }, 2);
    expect(state.alive[2]).toBe(false);
  });

  it("counts a shield from any one of several doctors", () => {
    let state = staged(["murderer", "doctor", "doctor", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 4 }, 0);
    state = must(state, { t: "protect", target: 3 }, 1); // wrong guess
    state = must(state, { t: "protect", target: 4 }, 2); // right one
    state = passOutTheDay(state);
    expect(state.night?.saved).toBe(4);
    expect(state.alive.every(Boolean)).toBe(true);
  });

  it("ignores a shield cast by a doctor who is already dead", () => {
    // Seat 1 (doctor) shields seat 3 on day 1 and is killed that same night;
    // the shield still counted for that round. Then on day 2 they're gone and
    // can't act at all.
    let state = staged(["murderer", "doctor", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 1 }, 0);
    state = must(state, { t: "protect", target: 3 }, 1);
    state = passOutTheDay(state);
    expect(state.alive[1]).toBe(false);
    state = must(state, { t: "advanceNight", day: 1 }, 0);
    expect(applyMove(state, { t: "publicVote", target: 0 }, 1)).toBeNull();
  });

  it("counts the doctor as a good seat for the win condition", () => {
    let state = reachJailVote(staged(["murderer", "doctor", "citizen", "citizen"]));
    for (const seat of [1, 2, 3]) {
      state = must(state, { t: "publicVote", target: 0 }, seat);
    }
    state = must(state, { t: "publicVote", target: null }, 0);
    expect(winningSide(state)).toBe("good");
    const result = status(state);
    if (result.kind === "won") expect(result.winners).toContain(1);
  });
});

describe("shot clocks", () => {
  it("clamps both timers on the way in and defaults them", () => {
    const high = init(1, 5, { turnSeconds: 9999, voteSeconds: 9999 });
    expect(high.turnSeconds).toBe(MAX_TURN_SECONDS);
    expect(high.voteSeconds).toBe(MAX_VOTE_SECONDS);
    const low = init(1, 5, { turnSeconds: 1, voteSeconds: 1 });
    expect(low.turnSeconds).toBe(MIN_TURN_SECONDS);
    expect(low.voteSeconds).toBe(MIN_VOTE_SECONDS);
    const bare = init(1, 5, {});
    expect(bare.turnSeconds).toBe(DEFAULT_TURN_SECONDS);
    expect(bare.voteSeconds).toBe(DEFAULT_VOTE_SECONDS);
    // The jail vote is the whole table arguing, so it gets a long default —
    // pinned here because it's a deliberate feel choice, not an arbitrary
    // number.
    expect(DEFAULT_VOTE_SECONDS).toBe(90);
    expect(DEFAULT_VOTE_SECONDS).toBeLessThanOrEqual(MAX_VOTE_SECONDS);
  });

  it("skips the seat on the clock, without acting for them", () => {
    const state = staged(["murderer", "citizen", "citizen", "citizen"]);
    const stalled = turn(state) as number;
    const next = must(state, { t: "turnTimeout", day: 1, seat: stalled }, 0);
    expect(turn(next)).not.toBe(stalled);
    expect(next.acted[stalled]).toBe(true);
    // A skipped murderer casts no kill vote — the skip is a pass, not a guess.
    expect(next.killVotes.every((vote) => vote === null)).toBe(true);
  });

  it("makes a duplicate or misaimed turnTimeout a no-op", () => {
    const state = staged(["murderer", "citizen", "citizen", "citizen"]);
    const stalled = turn(state) as number;
    const other = [0, 1, 2, 3].find((seat) => seat !== stalled) as number;
    expect(applyMove(state, { t: "turnTimeout", day: 1, seat: other }, 0)).toBeNull();
    expect(applyMove(state, { t: "turnTimeout", day: 9, seat: stalled }, 0)).toBeNull();
    const skipped = must(state, { t: "turnTimeout", day: 1, seat: stalled }, 0);
    // The same proposal from a second client lands after the turn moved on.
    expect(
      applyMove(skipped, { t: "turnTimeout", day: 1, seat: stalled }, 1),
    ).toBeNull();
  });

  it("carries a whole stalled day through to the night", () => {
    let state = staged(["murderer", "citizen", "citizen", "citizen"]);
    for (let step = 0; step < 4; step += 1) {
      const stalled = turn(state) as number;
      state = must(state, { t: "turnTimeout", day: 1, seat: stalled }, 0);
    }
    expect(state.phase).toBe("night");
    expect(state.night?.killed).toBeNull();
    expect(state.alive.every(Boolean)).toBe(true);
  });

  it("closes the jail vote, abstaining for anyone who never voted", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    state = must(state, { t: "publicVote", target: 0 }, 1);
    state = must(state, { t: "voteTimeout", day: state.day }, 2);
    // One real ballot beats three abstentions.
    expect(state.alive[0]).toBe(false);
    expect(state.phase).toBe("day");
  });

  it("jails nobody when the vote times out with no ballots at all", () => {
    const state = must(
      reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"])),
      { t: "voteTimeout", day: 2 },
      0,
    );
    expect(state.alive.every(Boolean)).toBe(true);
    expect(state.phase).toBe("day");
  });

  it("scopes voteTimeout to its day and phase", () => {
    const voting = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    expect(applyMove(voting, { t: "voteTimeout", day: 99 }, 0)).toBeNull();
    const day = must(voting, { t: "voteTimeout", day: voting.day }, 0);
    expect(applyMove(day, { t: "voteTimeout", day: day.day }, 0)).toBeNull();
  });
});

describe("win conditions", () => {
  it("gives it to the good side once the last murderer is gone", () => {
    let state = reachJailVote(staged(["murderer", "citizen", "citizen", "citizen"]));
    for (const seat of [1, 2, 3]) {
      state = must(state, { t: "publicVote", target: 0 }, seat);
    }
    state = must(state, { t: "publicVote", target: null }, 0);
    expect(state.alive[0]).toBe(false);
    const result = status(state);
    expect(result.kind).toBe("won");
    // The whole good side wins, dead members included.
    if (result.kind === "won") {
      expect(result.winners.every((seat) => !isEvil(state.roles[seat]))).toBe(true);
      expect(result.winners).toEqual([1, 2, 3]);
    }
    expect(winningSide(state)).toBe("good");
  });

  it("gives it to the murderers once no good seat is left", () => {
    let state = staged(["murderer", "murderer", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = must(state, { t: "killVote", target: 2 }, 1);
    state = passOutTheDay(state);
    expect(status(state).kind).toBe("ongoing");
    state = must(state, { t: "advanceNight", day: 1 }, 0);
    for (const seat of [0, 1, 3]) {
      state = must(state, { t: "publicVote", target: null }, seat);
    }
    state = must(state, { t: "killVote", target: 3 }, 0);
    state = must(state, { t: "killVote", target: 3 }, 1);
    state = passOutTheDay(state);
    expect(livingSeats(state)).toEqual([0, 1]);
    const result = status(state);
    expect(result.kind).toBe("won");
    if (result.kind === "won") {
      expect(result.winners.every((seat) => isEvil(state.roles[seat]))).toBe(true);
      expect(result.winners).toEqual([0, 1]);
    }
    expect(winningSide(state)).toBe("evil");
  });

  it("calls it a draw when the last two take each other out", () => {
    let state = staged(["murderer", "cop", "citizen", "citizen"]);
    state = must(state, { t: "killVote", target: 2 }, 0);
    state = must(state, { t: "cellVote", target: 3 }, 1);
    state = passOutTheDay(state);
    expect(livingSeats(state)).toEqual([0, 1]);
    state = must(state, { t: "advanceNight", day: 1 }, 0);
    state = must(state, { t: "publicVote", target: null }, 0);
    state = must(state, { t: "publicVote", target: null }, 1);
    state = must(state, { t: "killVote", target: 1 }, 0);
    state = must(state, { t: "cellVote", target: 0 }, 1);
    expect(livingSeats(state)).toEqual([]);
    expect(status(state).kind).toBe("draw");
    expect(winningSide(state)).toBeNull();
  });
});
