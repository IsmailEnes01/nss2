// A standard 52-card deck plus deterministic, per-hand dealing. No card is
// ever duplicated because every deal draws from a single shuffle of the
// fixed 52-card set (`buildDeck()` never repeats a rank+suit pair) — the
// same guarantee a physical deck gives you for free.
//
// Nothing here is stored in game state: a hand's entire shuffle is a pure
// function of `(seed, handNumber)`, so any client can re-derive "seat 3's
// hole cards" or "the flop" at any point just by calling `shuffledDeck`
// again and indexing into it — the reducer only needs to remember two small
// integers, never the deck itself. This mirrors every other game's rule of
// deriving hidden information from the room seed rather than carrying it in
// the wire-visible move stream.

import { mulberry32, pickIndex } from "@/shared/lib/seeded-rng";

// ── Types ────────────────────────────────────────────────────────────────────

/** 2-14, Ace high (also usable low, only for the wheel straight — see
 * `hand-rank.ts`). */
export type Rank = number;

/** 0-3, suit identity only — no ordering between suits in poker. */
export type Suit = number;

export interface Card {
  rank: Rank;
  suit: Suit;
}

// ── Deck ─────────────────────────────────────────────────────────────────────

export const MIN_RANK = 2;
export const MAX_RANK = 14; // Ace
export const SUIT_COUNT = 4;
export const DECK_SIZE = (MAX_RANK - MIN_RANK + 1) * SUIT_COUNT; // 52

const RANK_LABELS: Readonly<Record<Rank, string>> = {
  2: "2",
  3: "3",
  4: "4",
  5: "5",
  6: "6",
  7: "7",
  8: "8",
  9: "9",
  10: "10",
  11: "J",
  12: "Q",
  13: "K",
  14: "A",
};

/** Turkish suit symbols, red/black split for the board's CSS classes. */
export const SUIT_SYMBOLS: readonly string[] = ["♣", "♦", "♥", "♠"];
export const RED_SUITS: readonly Suit[] = [1, 2]; // ♦ ♥

export function rankLabel(rank: Rank): string {
  return RANK_LABELS[rank];
}

export function suitSymbol(suit: Suit): string {
  return SUIT_SYMBOLS[suit];
}

export function isRedSuit(suit: Suit): boolean {
  return RED_SUITS.includes(suit);
}

/** Every card exactly once, in a fixed (unshuffled) order — the starting
 * point `shuffledDeck` permutes. */
export function buildDeck(): Card[] {
  const deck: Card[] = [];
  for (let suit = 0; suit < SUIT_COUNT; suit += 1) {
    for (let rank = MIN_RANK; rank <= MAX_RANK; rank += 1) {
      deck.push({ rank, suit });
    }
  }
  return deck;
}

/** The one hand's entire shuffle, deterministic from the room seed and the
 * hand number — every client rebuilds the identical 52-card order without
 * exchanging a single card over the wire. Combines the two with a
 * multiplicative hash (Knuth's constant) so consecutive hand numbers don't
 * produce visibly-related shuffles. */
export function shuffledDeck(seed: number, handNumber: number): Card[] {
  const handSeed = (seed + handNumber * 2654435761) >>> 0;
  const rng = mulberry32(handSeed);
  const deck = buildDeck();
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = pickIndex(rng, i + 1);
    const swap = deck[i];
    deck[i] = deck[j];
    deck[j] = swap;
  }
  return deck;
}

export function cardsEqual(a: Card, b: Card): boolean {
  return a.rank === b.rank && a.suit === b.suit;
}
