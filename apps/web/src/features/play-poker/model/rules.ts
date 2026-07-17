// Teksas Hold'em — No-Limit, up to 9 seats. A hand deals every non-eliminated
// seat 2 hole cards and runs 4 betting streets (preflop/flop/turn/river) over
// a 5-card shared board; blinds rotate with the dealer button each hand.
// Nothing about the deck is ever stored in state — `dealtCards` re-derives
// every seat's hole cards and the community cards from `(seed, handNumber)`
// on every call (see config/deck.ts), so the reducer only carries two small
// integers for "which cards are in play," same trust model as Amiral
// Battı's fleets: hidden until the board decides to render them.
//
// Turn order needs no heads-up special case beyond blind *assignment*
// (heads-up: dealer posts small blind) — "first to act" is always
// `nextActive(bigBlindSeat)` preflop and `nextActive(dealerSeat)` on every
// later street, which happens to fall out to the correct heads-up rule too
// (dealer/SB acts first preflop, BB acts first postflop) without an if.
//
// A hand never needs a manual "next hand" move: `resolveHand` deals the next
// hand (or ends the match) inside the same reducer transition that settled
// the previous one, stashing the payout in `lastResult` so the board can
// show a "last hand" banner without blocking play.
//
// Two deliberate simplifications from the full casino rulebook, both
// documented at their call site: (1) any bet/raise reopens action for every
// other live seat, even a short all-in below the technical minimum raise —
// the real rule exempts players already facing a full bet from having to
// act again in that case. (2) A folded seat's locked-in contribution that
// ends up higher than every remaining contender's total (only possible if
// every seat that ever matched it also folded) rolls into the next
// resolvable side-pot tier rather than being computed as its own
// zero-winner tier — chip-conserving, just not the literal casino ruling.
import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";
import { mulberry32, pickIndex } from "@/shared/lib/seeded-rng";
import { type Card, shuffledDeck } from "../config/deck";
import {
  bestHand,
  compareHandRanks,
  type EvaluatedHand,
  handLabel,
} from "./hand-rank";

// ── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_STARTING_MONEY = 1000;
export const MIN_STARTING_MONEY = 200;
export const MAX_STARTING_MONEY = 100_000;

export const DEFAULT_SMALL_BLIND = 50;
export const MIN_SMALL_BLIND = 5;
export const MAX_SMALL_BLIND = 5000;

export const DEFAULT_BIG_BLIND = 100;
export const MIN_BIG_BLIND = 10;
export const MAX_BIG_BLIND = 10_000;

const STREET_ORDER: readonly Street[] = ["preflop", "flop", "turn", "river"];
const STREET_REVEAL_COUNT: Readonly<Record<Street, number>> = {
  preflop: 0,
  flop: 3,
  turn: 4,
  river: 5,
};

// ── Game definition ──────────────────────────────────────────────────────────

export const pokerGame: GameDef<PokerState, PokerMove> = {
  meta: {
    id: "teksas-holdem",
    name: "Teksas Hold'em",
    icon: "🃏",
    tagline: "Blöf yap, en iyi eli kur, rakiplerini masadan sil.",
    minPlayers: 2,
    maxPlayers: 9,
    settings: [
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
    ],
  },
  playerLabel: (index) => `Oyuncu ${index + 1}`,
  init,
  applyMove,
  status,
  turn,
};

// ── Rules ────────────────────────────────────────────────────────────────────

function init(
  seed: number,
  playerCount: number,
  settings: Readonly<Record<string, number>> = {},
): PokerState {
  const startingMoney = clampSetting(
    settings.startingMoney,
    MIN_STARTING_MONEY,
    MAX_STARTING_MONEY,
    DEFAULT_STARTING_MONEY,
  );
  const smallBlind = clampSetting(
    settings.smallBlind,
    MIN_SMALL_BLIND,
    MAX_SMALL_BLIND,
    DEFAULT_SMALL_BLIND,
  );
  const bigBlindSetting = clampSetting(
    settings.bigBlind,
    MIN_BIG_BLIND,
    MAX_BIG_BLIND,
    DEFAULT_BIG_BLIND,
  );
  // Never let a degenerate settings combination leave the big blind at or
  // below the small blind — every downstream formula assumes it's strictly
  // bigger.
  const bigBlind = Math.max(bigBlindSetting, smallBlind + 1);

  const dealerSeat = pickIndex(mulberry32(seed), playerCount);
  const stacks = Array<number>(playerCount).fill(startingMoney);
  const eliminated = Array<boolean>(playerCount).fill(false);
  return startHand(
    seed,
    0,
    dealerSeat,
    stacks,
    eliminated,
    smallBlind,
    bigBlind,
    playerCount,
    null,
  );
}

function applyMove(
  state: PokerState,
  move: PokerMove,
  player: PlayerIndex,
): PokerState | null {
  if (state.toAct !== player) return null;

  const amountToCall = state.currentBet - state.betThisStreet[player];

  if (isFoldMove(move)) return afterFold(state, player);

  if (isCheckMove(move)) {
    if (amountToCall !== 0) return null;
    return settleAction(
      { ...state, actedThisStreet: markActed(state, player) },
      player,
    );
  }

  if (isCallMove(move)) {
    if (amountToCall <= 0) return null; // nothing to call — must check
    return afterCall(state, player, amountToCall);
  }

  if (isBetMove(move)) {
    if (state.currentBet !== 0) return null; // there's already a bet — must raise
    if (!Number.isInteger(move.amount) || move.amount <= 0) return null;
    if (move.amount > state.stacks[player]) return null;
    const isAllInShove = move.amount === state.stacks[player];
    if (move.amount < state.bigBlind && !isAllInShove) return null;
    return afterBetOrRaise(state, player, move.amount, isAllInShove);
  }

  if (isRaiseMove(move)) {
    if (state.currentBet === 0) return null; // nothing to raise — must bet
    if (!Number.isInteger(move.amount) || move.amount <= state.currentBet) {
      return null;
    }
    const additional = move.amount - state.betThisStreet[player];
    if (additional <= 0 || additional > state.stacks[player]) return null;
    const isAllInShove = additional === state.stacks[player];
    const raiseIncrement = move.amount - state.currentBet;
    if (raiseIncrement < state.minRaise && !isAllInShove) return null;
    return afterBetOrRaise(state, player, move.amount, isAllInShove);
  }

  if (isAllInMove(move)) return afterAllIn(state, player);

  return null;
}

function status(state: PokerState): GameStatus {
  const remainingSeats = seatsWhere(
    state.playerCount,
    (seat) => !state.eliminated[seat],
  );
  if (remainingSeats.length === 0) return { kind: "draw" };
  if (remainingSeats.length === 1) {
    return { kind: "won", winner: remainingSeats[0] };
  }
  return { kind: "ongoing" };
}

function turn(state: PokerState): PlayerIndex | null {
  return state.toAct;
}

// ── Betting engine ───────────────────────────────────────────────────────────

/** Deals a brand-new hand: rotates blinds onto `dealerSeat`, posts them
 * (capped to a short stack's remaining chips, going all-in if that empties
 * it), and hands off to `settleAction` immediately — a heads-up short stack
 * that's already all-in from just posting blinds is exactly as valid a
 * starting position as a full betting round, and `settleAction` treats it
 * identically either way. */
function startHand(
  seed: number,
  handNumber: number,
  dealerSeat: PlayerIndex,
  stacks: readonly number[],
  eliminated: readonly boolean[],
  smallBlind: number,
  bigBlind: number,
  playerCount: number,
  lastResult: PokerHandResult | null,
): PokerState {
  const notEliminated = (seat: PlayerIndex) => !eliminated[seat];
  const activeCount = seatsWhere(playerCount, notEliminated).length;
  const sbSeat =
    activeCount === 2
      ? dealerSeat
      : nextSeat(dealerSeat, playerCount, notEliminated);
  const bbSeat =
    activeCount === 2
      ? nextSeat(dealerSeat, playerCount, notEliminated)
      : nextSeat(sbSeat, playerCount, notEliminated);

  const nextStacks = stacks.slice();
  const betThisStreet = Array<number>(playerCount).fill(0);
  const totalContributed = Array<number>(playerCount).fill(0);
  const allIn = Array<boolean>(playerCount).fill(false);

  const postBlind = (seat: PlayerIndex, amount: number) => {
    const actual = Math.min(amount, nextStacks[seat]);
    nextStacks[seat] -= actual;
    betThisStreet[seat] += actual;
    totalContributed[seat] += actual;
    if (nextStacks[seat] === 0) allIn[seat] = true;
  };
  postBlind(sbSeat, smallBlind);
  postBlind(bbSeat, bigBlind);

  const raw: PokerState = {
    seed,
    playerCount,
    handNumber,
    dealerSeat,
    smallBlind,
    bigBlind,
    stacks: nextStacks,
    eliminated,
    folded: eliminated.slice(),
    allIn,
    betThisStreet,
    totalContributed,
    actedThisStreet: Array<boolean>(playerCount).fill(false),
    street: "preflop",
    currentBet: betThisStreet[bbSeat],
    minRaise: bigBlind,
    toAct: null,
    lastResult,
  };
  return settleAction(raw, bbSeat);
}

/** The one place that decides "what happens next" after any action or deal:
 * fold out to a lone contender, run out remaining streets once nobody can
 * act any more, advance a completed street, or hand the turn to whoever's
 * next. Every move handler and `startHand`/`advanceStreet` funnel through
 * here so this logic only exists once. */
function settleAction(state: PokerState, searchFrom: PlayerIndex): PokerState {
  const contenders = seatsWhere(state.playerCount, (seat) => !state.folded[seat]);
  if (contenders.length <= 1) return resolveHand(state, contenders);

  const canAct = contenders.filter((seat) => !state.allIn[seat]);
  const roundDone =
    canAct.length === 0
      ? true
      : canAct.length === 1
        ? state.actedThisStreet[canAct[0]] &&
          state.betThisStreet[canAct[0]] === state.currentBet
        : canAct.every(
            (seat) =>
              state.actedThisStreet[seat] &&
              state.betThisStreet[seat] === state.currentBet,
          );

  if (!roundDone) {
    return {
      ...state,
      toAct: nextSeat(searchFrom, state.playerCount, (seat) =>
        canAct.includes(seat),
      ),
    };
  }
  if (state.street !== "river") return advanceStreet(state);
  return resolveHand(state, contenders);
}

/** Opens the next street: streets never carry a bet over (only the running
 * `totalContributed` does), and the minimum bet/raise size resets to the big
 * blind every street. */
function advanceStreet(state: PokerState): PokerState {
  const nextStreetIndex = STREET_ORDER.indexOf(state.street) + 1;
  const advanced: PokerState = {
    ...state,
    street: STREET_ORDER[nextStreetIndex],
    currentBet: 0,
    minRaise: state.bigBlind,
    betThisStreet: Array<number>(state.playerCount).fill(0),
    actedThisStreet: Array<boolean>(state.playerCount).fill(false),
  };
  return settleAction(advanced, state.dealerSeat);
}

function afterFold(state: PokerState, player: PlayerIndex): PokerState {
  const folded = state.folded.map((f, seat) => (seat === player ? true : f));
  const next: PokerState = {
    ...state,
    folded,
    actedThisStreet: markActed(state, player),
  };
  return settleAction(next, player);
}

function afterCall(
  state: PokerState,
  player: PlayerIndex,
  amountToCall: number,
): PokerState {
  const effective = Math.min(amountToCall, state.stacks[player]);
  const stacks = state.stacks.map((v, seat) =>
    seat === player ? v - effective : v,
  );
  const betThisStreet = state.betThisStreet.map((v, seat) =>
    seat === player ? v + effective : v,
  );
  const totalContributed = state.totalContributed.map((v, seat) =>
    seat === player ? v + effective : v,
  );
  const allIn =
    stacks[player] === 0
      ? state.allIn.map((v, seat) => (seat === player ? true : v))
      : state.allIn;
  const next: PokerState = {
    ...state,
    stacks,
    betThisStreet,
    totalContributed,
    allIn,
    actedThisStreet: markActed(state, player),
  };
  return settleAction(next, player);
}

/** Shared by `bet`, `raise`, and the raise/bet branch of `allIn` — `total`
 * is the seat's new `betThisStreet` level ("raise TO", not "raise BY"). */
function afterBetOrRaise(
  state: PokerState,
  player: PlayerIndex,
  total: number,
  isAllInShove: boolean,
): PokerState {
  const additional = total - state.betThisStreet[player];
  const stacks = state.stacks.map((v, seat) =>
    seat === player ? v - additional : v,
  );
  const betThisStreet = state.betThisStreet.map((v, seat) =>
    seat === player ? total : v,
  );
  const totalContributed = state.totalContributed.map((v, seat) =>
    seat === player ? v + additional : v,
  );
  const allIn = isAllInShove
    ? state.allIn.map((v, seat) => (seat === player ? true : v))
    : state.allIn;
  const raiseIncrement = total - state.currentBet;
  const actedThisStreet = state.actedThisStreet.map((acted, seat) => {
    if (seat === player) return true;
    if (state.folded[seat] || state.allIn[seat]) return acted;
    return false; // faces a new level — must respond again
  });
  const next: PokerState = {
    ...state,
    stacks,
    betThisStreet,
    totalContributed,
    allIn,
    actedThisStreet,
    currentBet: total,
    minRaise: Math.max(state.minRaise, raiseIncrement),
  };
  return settleAction(next, player);
}

function afterAllIn(state: PokerState, player: PlayerIndex): PokerState | null {
  const stack = state.stacks[player];
  if (stack <= 0) return null;
  const amountToCall = state.currentBet - state.betThisStreet[player];
  if (stack <= amountToCall) return afterCall(state, player, amountToCall);
  const total = state.betThisStreet[player] + stack;
  return afterBetOrRaise(state, player, total, true);
}

/** Ends the hand: an uncontested fold-win takes the whole pot, otherwise a
 * showdown splits it (possibly into several side-pot tiers) among the best
 * hand(s) among `contenders`. Either way, pays out into fresh `stacks`,
 * marks anyone who hit 0 as `eliminated`, and — unless that leaves fewer
 * than 2 seats standing — immediately deals the next hand. */
function resolveHand(
  state: PokerState,
  contenders: readonly PlayerIndex[],
): PokerState {
  const potTotal = state.totalContributed.reduce((sum, v) => sum + v, 0);
  let potsWon: readonly PotWin[];
  let revealedHands: readonly { seat: PlayerIndex; cards: readonly Card[] }[] =
    [];

  if (contenders.length <= 1) {
    const winner = contenders[0];
    potsWon =
      winner === undefined
        ? []
        : [{ seats: [winner], amount: potTotal, handLabel: null }];
  } else {
    const { holeBySeat, community } = dealtCards(state);
    const evaluated = new Map<PlayerIndex, EvaluatedHand>();
    for (const seat of contenders) {
      const hole = holeBySeat.get(seat);
      if (hole === undefined) continue;
      evaluated.set(seat, bestHand([...hole, ...community]));
    }
    potsWon = distributeSidePots(state, contenders, evaluated);
    revealedHands = contenders.flatMap((seat) => {
      const hole = holeBySeat.get(seat);
      return hole === undefined ? [] : [{ seat, cards: hole }];
    });
  }

  const stacks = state.stacks.slice();
  for (const pot of potsWon) {
    if (pot.seats.length === 0) continue;
    const share = Math.floor(pot.amount / pot.seats.length);
    const remainder = pot.amount - share * pot.seats.length;
    for (const seat of pot.seats) stacks[seat] += share;
    const remainderOrder = orderSeatsFromDealer(state, pot.seats);
    for (let i = 0; i < remainder; i += 1) {
      stacks[remainderOrder[i % remainderOrder.length]] += 1;
    }
  }

  const eliminated = state.eliminated.map(
    (wasOut, seat) => wasOut || stacks[seat] <= 0,
  );
  const bustedSeats = seatsWhere(
    state.playerCount,
    (seat) => !state.eliminated[seat] && eliminated[seat],
  );

  const lastResult: PokerHandResult = {
    handNumber: state.handNumber,
    potsWon,
    revealedHands,
    bustedSeats,
  };

  const remainingSeats = seatsWhere(state.playerCount, (seat) => !eliminated[seat]);
  if (remainingSeats.length <= 1) {
    // Match over — every chip already moved into `stacks` above, so the
    // hand's now-stale contribution/bet arrays must clear too, or
    // `pokerPotTotal` would keep reporting the just-distributed pot as
    // still outstanding.
    return {
      ...state,
      stacks,
      eliminated,
      lastResult,
      toAct: null,
      betThisStreet: Array<number>(state.playerCount).fill(0),
      totalContributed: Array<number>(state.playerCount).fill(0),
    };
  }

  const nextDealer = nextSeat(
    state.dealerSeat,
    state.playerCount,
    (seat) => !eliminated[seat],
  );
  return startHand(
    state.seed,
    state.handNumber + 1,
    nextDealer,
    stacks,
    eliminated,
    state.smallBlind,
    state.bigBlind,
    state.playerCount,
    lastResult,
  );
}

/** Splits the pot into tiers at each distinct total-contribution level so an
 * all-in for less than a later caller's stack only ever contends for the
 * chips actually put up to its own cap — the standard side-pot algorithm.
 * `evaluated` is precomputed once by the caller so every tier reuses the
 * same hand evaluations instead of re-deriving cards per tier. */
function distributeSidePots(
  state: PokerState,
  contenders: readonly PlayerIndex[],
  evaluated: ReadonlyMap<PlayerIndex, EvaluatedHand>,
): readonly PotWin[] {
  const contributions = state.totalContributed;
  const levels = [
    ...new Set(
      seatsWhere(state.playerCount, (seat) => contributions[seat] > 0).map(
        (seat) => contributions[seat],
      ),
    ),
  ].sort((a, b) => a - b);

  const pots: PotWin[] = [];
  let previousLevel = 0;
  let carry = 0;
  for (const level of levels) {
    const layerWidth = level - previousLevel;
    const contributorsAtLevel = seatsWhere(
      state.playerCount,
      (seat) => contributions[seat] >= level,
    ).length;
    const tierAmount = layerWidth * contributorsAtLevel + carry;
    const eligible = contenders.filter((seat) => contributions[seat] >= level);

    if (eligible.length === 0) {
      // Orphaned tier — see the file header's second documented
      // simplification. Rolls forward instead of vanishing.
      carry = tierAmount;
      previousLevel = level;
      continue;
    }

    const winners = bestSeatsAmong(evaluated, eligible);
    const anyWinner = winners[0];
    pots.push({
      seats: winners,
      amount: tierAmount,
      handLabel:
        anyWinner === undefined
          ? null
          : handLabel(evaluated.get(anyWinner)?.rank ?? []),
    });
    carry = 0;
    previousLevel = level;
  }
  return pots;
}

function bestSeatsAmong(
  evaluated: ReadonlyMap<PlayerIndex, EvaluatedHand>,
  eligible: readonly PlayerIndex[],
): readonly PlayerIndex[] {
  let bestRank: readonly number[] | null = null;
  let winners: PlayerIndex[] = [];
  for (const seat of eligible) {
    const hand = evaluated.get(seat);
    if (hand === undefined) continue;
    if (bestRank === null || compareHandRanks(hand.rank, bestRank) > 0) {
      bestRank = hand.rank;
      winners = [seat];
    } else if (compareHandRanks(hand.rank, bestRank) === 0) {
      winners.push(seat);
    }
  }
  return winners;
}

// ── Helpers (shared with the board) ─────────────────────────────────────────

/** A seat's 2 hole cards, or null once it's out for the match — re-derived
 * from the seed every call, never stored. */
export function pokerHoleCards(
  state: PokerState,
  seat: PlayerIndex,
): readonly [Card, Card] | null {
  if (state.eliminated[seat]) return null;
  return dealtCards(state).holeBySeat.get(seat) ?? null;
}

/** The community cards revealed so far this street (0/3/4/5) — always the
 * same 5 cards underneath, just progressively sliced. */
export function pokerCommunityCards(state: PokerState): readonly Card[] {
  return dealtCards(state).community.slice(0, STREET_REVEAL_COUNT[state.street]);
}

/** Total chips in play this hand — every seat's running contribution. */
export function pokerPotTotal(state: PokerState): number {
  return state.totalContributed.reduce((sum, v) => sum + v, 0);
}

/** What `seat` may legally do right now, or null when it isn't their turn —
 * the board uses this to gate/enable its action buttons rather than
 * replicating `applyMove`'s validation itself. */
export function legalActionsFor(
  state: PokerState,
  seat: PlayerIndex,
): PokerLegalActions | null {
  if (state.toAct !== seat) return null;
  const amountToCall = state.currentBet - state.betThisStreet[seat];
  const stack = state.stacks[seat];
  return {
    canFold: true,
    canCheck: amountToCall === 0,
    canCall: amountToCall > 0 && stack > 0,
    callAmount: Math.min(amountToCall, stack),
    canBet: state.currentBet === 0 && stack > 0,
    minBet: Math.min(state.bigBlind, stack),
    canRaise: state.currentBet > 0 && stack > amountToCall,
    minRaiseTo: state.currentBet + state.minRaise,
    canAllIn: stack > 0,
  };
}

/** Every active (non-eliminated) seat's hole cards plus the full 5-card
 * board, derived fresh from `(seed, handNumber)` — nothing here is ever
 * stored in `PokerState`. Dealing is block-style (2 consecutive cards per
 * seat) rather than real one-at-a-time: since the source is already one
 * seed-shuffled 52-card sequence rather than a physical deck, the two are
 * equally random — only physical dealing needs the one-at-a-time ritual. */
function dealtCards(state: PokerState): {
  holeBySeat: ReadonlyMap<PlayerIndex, readonly [Card, Card]>;
  community: readonly Card[];
} {
  const deck = shuffledDeck(state.seed, state.handNumber);
  const dealOrder = dealOrderSeats(state);
  let cursor = 0;
  const holeBySeat = new Map<PlayerIndex, readonly [Card, Card]>();
  for (const seat of dealOrder) {
    holeBySeat.set(seat, [deck[cursor], deck[cursor + 1]]);
    cursor += 2;
  }
  cursor += 1; // burn
  const flop = [deck[cursor], deck[cursor + 1], deck[cursor + 2]];
  cursor += 3;
  cursor += 1; // burn
  const turnCard = deck[cursor];
  cursor += 1;
  cursor += 1; // burn
  const riverCard = deck[cursor];
  return { holeBySeat, community: [...flop, turnCard, riverCard] };
}

/** Active seats in real deal order: starting from the seat left of the
 * dealer (same seat the small blind sits in), wrapping around. */
function dealOrderSeats(state: PokerState): readonly PlayerIndex[] {
  const active = seatsWhere(state.playerCount, (seat) => !state.eliminated[seat]);
  const start = nextSeat(
    state.dealerSeat,
    state.playerCount,
    (seat) => !state.eliminated[seat],
  );
  const startIndex = active.indexOf(start);
  return [...active.slice(startIndex), ...active.slice(0, startIndex)];
}

/** The first seat, walking clockwise from (but not including) `from`, that
 * satisfies `predicate` — used for both blind/dealer rotation (predicate:
 * not eliminated) and turn order within a street (predicate: still able to
 * act). Falls back to `from` itself only if literally nothing else
 * qualifies, which every call site already guarantees can't happen. */
function nextSeat(
  from: PlayerIndex,
  playerCount: number,
  predicate: (seat: PlayerIndex) => boolean,
): PlayerIndex {
  for (let step = 1; step <= playerCount; step += 1) {
    const seat = (from + step) % playerCount;
    if (predicate(seat)) return seat;
  }
  return from;
}

function seatsWhere(
  playerCount: number,
  predicate: (seat: PlayerIndex) => boolean,
): PlayerIndex[] {
  const seats: PlayerIndex[] = [];
  for (let seat = 0; seat < playerCount; seat += 1) {
    if (predicate(seat)) seats.push(seat);
  }
  return seats;
}

/** Odd chips from an uneven pot split go one at a time to the seats closest
 * left of the dealer button first — the standard table convention. */
function orderSeatsFromDealer(
  state: PokerState,
  seats: readonly PlayerIndex[],
): readonly PlayerIndex[] {
  const n = state.playerCount;
  return [...seats].sort(
    (a, b) =>
      ((a - state.dealerSeat - 1 + n) % n) - ((b - state.dealerSeat - 1 + n) % n),
  );
}

function markActed(state: PokerState, player: PlayerIndex): readonly boolean[] {
  return state.actedThisStreet.map((v, seat) => (seat === player ? true : v));
}

/** Same clamp-and-fall-back-to-default treatment every settings value gets
 * regardless of where it came from — see Spektrum Çarkı's identical
 * `clampCountdown` for why. */
function clampSetting(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isFoldMove(move: PokerMove): move is { t: "fold" } {
  return isRecord(move) && move.t === "fold";
}

function isCheckMove(move: PokerMove): move is { t: "check" } {
  return isRecord(move) && move.t === "check";
}

function isCallMove(move: PokerMove): move is { t: "call" } {
  return isRecord(move) && move.t === "call";
}

function isBetMove(move: PokerMove): move is { t: "bet"; amount: number } {
  return isRecord(move) && move.t === "bet" && typeof move.amount === "number";
}

function isRaiseMove(
  move: PokerMove,
): move is { t: "raise"; amount: number } {
  return (
    isRecord(move) && move.t === "raise" && typeof move.amount === "number"
  );
}

function isAllInMove(move: PokerMove): move is { t: "allIn" } {
  return isRecord(move) && move.t === "allIn";
}

// ── Types ────────────────────────────────────────────────────────────────────

export type Street = "preflop" | "flop" | "turn" | "river";

export interface PokerState {
  seed: number;
  playerCount: number;
  /** 0-based, increments every hand — also the second input (with `seed`)
   * to that hand's card derivation. */
  handNumber: number;
  dealerSeat: PlayerIndex;
  smallBlind: number;
  bigBlind: number;
  /** Chips remaining, indexed by seat — 0 once a seat has busted. */
  stacks: readonly number[];
  /** True once a seat has busted and permanently sits out (spectator) — set
   * once, never cleared. */
  eliminated: readonly boolean[];
  /** True for the rest of THIS hand once a seat has folded — also true for
   * every eliminated seat from the moment a hand deals, so "still in the
   * hand" is always exactly `!folded[seat]`. Reset every new hand. */
  folded: readonly boolean[];
  /** True once a seat has put its entire remaining stack in this hand — it
   * stays in the hand (can still win) but never acts again. */
  allIn: readonly boolean[];
  /** Chips put in during the CURRENT street only — reset to 0 at every new
   * street. */
  betThisStreet: readonly number[];
  /** Chips put in across the WHOLE hand so far — never reset until the next
   * hand deals; what side pots are computed from. */
  totalContributed: readonly number[];
  /** Whether a seat has acted at least once since `currentBet` last changed
   * — a street's betting is complete once every seat that still can act has
   * both acted and matched `currentBet`. */
  actedThisStreet: readonly boolean[];
  street: Street;
  /** The highest `betThisStreet` any seat has reached this street — what a
   * `call` matches and a `raise` must exceed. */
  currentBet: number;
  /** The minimum *increment* a raise must add over `currentBet` — the size
   * of the street's last full bet or raise; resets to `bigBlind` on every
   * new street. */
  minRaise: number;
  /** Whose decision it is, or null once the match is over (one seat left). */
  toAct: PlayerIndex | null;
  /** The most recently settled hand's payout — kept (not transient) so the
   * board can show a "last hand" banner through the start of the next hand,
   * since resolving a hand deals the next one in that same transition. */
  lastResult: PokerHandResult | null;
}

export interface PotWin {
  seats: readonly PlayerIndex[];
  amount: number;
  /** Turkish hand-category label for the winning hand, or null for an
   * uncontested (fold) win — nothing was ever shown down. */
  handLabel: string | null;
}

export interface PokerHandResult {
  handNumber: number;
  /** One entry per pot tier — just one for an uncontested or no-side-pot
   * hand; several when an all-in split the pot into layers. */
  potsWon: readonly PotWin[];
  /** Every contender's hole cards, revealed at a real showdown only — empty
   * for an uncontested (fold) win. */
  revealedHands: readonly { seat: PlayerIndex; cards: readonly Card[] }[];
  /** Seats that busted (hit 0 chips) as a result of this hand's payout. */
  bustedSeats: readonly PlayerIndex[];
}

export interface PokerLegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canBet: boolean;
  minBet: number;
  canRaise: boolean;
  minRaiseTo: number;
  canAllIn: boolean;
}

/** `bet`/`raise` amounts are the seat's new TOTAL `betThisStreet` level
 * ("raise to $200"), not an increment — matches how poker UIs label the
 * action. */
export type PokerMove =
  | { t: "fold" }
  | { t: "check" }
  | { t: "call" }
  | { t: "bet"; amount: number }
  | { t: "raise"; amount: number }
  | { t: "allIn" };
