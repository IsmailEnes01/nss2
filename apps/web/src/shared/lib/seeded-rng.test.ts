import { describe, expect, it } from "vitest";
import { mulberry32, pickIndex } from "./seeded-rng";

describe("mulberry32", () => {
  it("produces the same stream for the same seed", () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const streamA = Array.from({ length: 20 }, () => a());
    const streamB = Array.from({ length: 20 }, () => b());
    expect(streamA).toEqual(streamB);
  });

  it("produces different streams for different seeds", () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    const streamA = Array.from({ length: 5 }, () => a());
    const streamB = Array.from({ length: 5 }, () => b());
    expect(streamA).not.toEqual(streamB);
  });

  it("stays within [0, 1)", () => {
    const rng = mulberry32(1337);
    for (let i = 0; i < 1000; i += 1) {
      const value = rng();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });

  it("normalizes seeds to uint32", () => {
    // -1 >>> 0 === 0xffffffff, so both seeds must yield the same stream.
    const negative = mulberry32(-1);
    const wrapped = mulberry32(0xffffffff);
    expect(negative()).toBe(wrapped());
    expect(negative()).toBe(wrapped());
  });
});

describe("pickIndex", () => {
  it("is deterministic for a seeded rng", () => {
    const picksA = collectPicks(mulberry32(7), 5, 50);
    const picksB = collectPicks(mulberry32(7), 5, 50);
    expect(picksA).toEqual(picksB);
  });

  it("covers exactly the range [0, length)", () => {
    const seen = new Set(collectPicks(mulberry32(99), 4, 500));
    expect([...seen].sort()).toEqual([0, 1, 2, 3]);
  });

  it("throws on a non-positive or fractional length", () => {
    const rng = mulberry32(1);
    expect(() => pickIndex(rng, 0)).toThrow(RangeError);
    expect(() => pickIndex(rng, -3)).toThrow(RangeError);
    expect(() => pickIndex(rng, 2.5)).toThrow(RangeError);
  });
});

// ── Helpers ──────────────────────────────────────────────────────────────────

function collectPicks(
  rng: () => number,
  length: number,
  count: number,
): number[] {
  return Array.from({ length: count }, () => pickIndex(rng, length));
}
