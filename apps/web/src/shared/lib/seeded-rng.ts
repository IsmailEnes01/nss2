/**
 * Deterministic 32-bit RNG (mulberry32). Both players derive ALL game
 * randomness (ship placement, hangman word, first turn…) from the room seed
 * through this generator — never `Math.random()` in game code — so lockstep
 * states cannot diverge.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Uniform integer in `[0, length)` — seeded picks out of arrays. */
export function pickIndex(rng: () => number, length: number): number {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError(`pickIndex needs a positive length, got ${length}`);
  }
  return Math.floor(rng() * length);
}
