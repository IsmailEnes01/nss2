// Standard Texas Hold'em hand ranking: best 5-of-7 (2 hole + 5 community).
// Every hand reduces to a comparable tuple `[category, ...tiebreakers]`
// (category dominant, higher is always better) so two hands compare with a
// single generic lexicographic walk — no special-casing "a flush beats a
// straight" anywhere, the category number already encodes that.

import type { Card, Rank } from "../config/deck";

// ── Categories (higher = better) ────────────────────────────────────────────

export const HIGH_CARD = 0;
export const ONE_PAIR = 1;
export const TWO_PAIR = 2;
export const THREE_OF_A_KIND = 3;
export const STRAIGHT = 4;
export const FLUSH = 5;
export const FULL_HOUSE = 6;
export const FOUR_OF_A_KIND = 7;
export const STRAIGHT_FLUSH = 8;

const CATEGORY_LABELS: readonly string[] = [
  "Yüksek Kart",
  "Çift",
  "İki Çift",
  "Üçlü",
  "Kent",
  "Renk",
  "Full",
  "Kare",
  "Renkli Kent",
];

export interface EvaluatedHand {
  /** `[category, ...tiebreakers]` — compare with `compareHandRanks`, never
   * by reading fields directly (tiebreaker shape differs per category). */
  rank: readonly number[];
  /** The specific 5 cards (of the 7 available) that produced `rank`. */
  cards: readonly Card[];
}

// ── Public API ───────────────────────────────────────────────────────────────

/** The best 5-card hand out of any 5-7 cards (Hold'em always has exactly 7
 * at showdown, but the evaluator doesn't assume that). */
export function bestHand(cards: readonly Card[]): EvaluatedHand {
  if (cards.length < 5) {
    throw new RangeError("bestHand needs at least 5 cards");
  }
  let best: EvaluatedHand | null = null;
  for (const combo of fiveCardCombinations(cards)) {
    const rank = evaluateFive(combo);
    if (best === null || compareHandRanks(rank, best.rank) > 0) {
      best = { rank, cards: combo };
    }
  }
  // Unreachable given the length guard above, but keeps the return type
  // non-nullable without a non-null assertion.
  if (best === null) throw new Error("unreachable: no combination evaluated");
  return best;
}

/** Positive if `a` beats `b`, negative if `b` beats `a`, 0 for a tie (split
 * pot). Safe across different categories (differing tiebreaker-array
 * lengths never matter — the category element always differs first). */
export function compareHandRanks(
  a: readonly number[],
  b: readonly number[],
): number {
  const length = Math.max(a.length, b.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/** Turkish name for a hand's category — "Renkli Kent" gets "(Royal)"
 * appended when its high card is the Ace (the top possible hand). */
export function handLabel(rank: readonly number[]): string {
  const category = rank[0];
  const label = CATEGORY_LABELS[category];
  return category === STRAIGHT_FLUSH && rank[1] === 14
    ? `${label} (Royal)`
    : label;
}

// ── Evaluation ───────────────────────────────────────────────────────────────

/** Exactly 5 cards → `[category, ...tiebreakers]`. Tiebreaker shape is
 * fixed per category so same-category hands always compare element-by-
 * element correctly: quads → [rank, kicker]; full house → [trips, pair];
 * flush/high card → all 5 ranks descending; straight/straight flush → just
 * the high card (a straight's kickers never matter); trips → [rank, 2
 * kickers]; two pair → [highPair, lowPair, kicker]; one pair → [rank, 3
 * kickers]. */
function evaluateFive(cards: readonly Card[]): number[] {
  const ranksDesc = cards.map((c) => c.rank).sort((a, b) => b - a);
  const isFlush = cards.every((c) => c.suit === cards[0].suit);
  const straightHigh = straightHighCard(ranksDesc);

  // Groups of equal rank, sorted by (count desc, rank desc) — for a tie in
  // count, the higher rank sorts first, which is exactly the order two
  // pair / trips / quads tiebreakers need.
  const counts = new Map<Rank, number>();
  for (const rank of ranksDesc) counts.set(rank, (counts.get(rank) ?? 0) + 1);
  const groups = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || b[0] - a[0],
  );

  if (isFlush && straightHigh !== null) return [STRAIGHT_FLUSH, straightHigh];
  if (groups[0][1] === 4) return [FOUR_OF_A_KIND, groups[0][0], groups[1][0]];
  if (groups[0][1] === 3 && groups[1][1] === 2) {
    return [FULL_HOUSE, groups[0][0], groups[1][0]];
  }
  if (isFlush) return [FLUSH, ...ranksDesc];
  if (straightHigh !== null) return [STRAIGHT, straightHigh];
  if (groups[0][1] === 3) {
    return [THREE_OF_A_KIND, groups[0][0], groups[1][0], groups[2][0]];
  }
  if (groups[0][1] === 2 && groups[1][1] === 2) {
    // groups is (count desc, rank desc) — groups[0] is already the higher
    // pair, groups[1] the lower.
    return [TWO_PAIR, groups[0][0], groups[1][0], groups[2][0]];
  }
  if (groups[0][1] === 2) {
    return [ONE_PAIR, groups[0][0], groups[1][0], groups[2][0], groups[3][0]];
  }
  return [HIGH_CARD, ...ranksDesc];
}

/** The high card of the best 5-consecutive-rank run among (already
 * rank-descending) cards, or null if there isn't one. Handles the wheel
 * (A-2-3-4-5, high card "5") as its own case since Ace-low breaks the
 * otherwise-uniform descending sequence. */
function straightHighCard(ranksDesc: readonly Rank[]): number | null {
  const uniqueDesc = [...new Set(ranksDesc)];
  for (let i = 0; i <= uniqueDesc.length - 5; i += 1) {
    let consecutive = true;
    for (let k = 0; k < 4; k += 1) {
      if (uniqueDesc[i + k] - uniqueDesc[i + k + 1] !== 1) {
        consecutive = false;
        break;
      }
    }
    if (consecutive) return uniqueDesc[i];
  }
  const isWheel = [14, 5, 4, 3, 2].every((rank) => uniqueDesc.includes(rank));
  return isWheel ? 5 : null;
}

/** All C(n,5) five-card subsets — 21 for Hold'em's 7, cheap enough to brute
 * force rather than hand-optimize. */
function fiveCardCombinations(cards: readonly Card[]): Card[][] {
  const combos: Card[][] = [];
  const n = cards.length;
  for (let a = 0; a < n; a += 1) {
    for (let b = a + 1; b < n; b += 1) {
      for (let c = b + 1; c < n; c += 1) {
        for (let d = c + 1; d < n; d += 1) {
          for (let e = d + 1; e < n; e += 1) {
            combos.push([cards[a], cards[b], cards[c], cards[d], cards[e]]);
          }
        }
      }
    }
  }
  return combos;
}
