// Length-agnostic on purpose: these used to hardcode 4-character literals,
// which meant changing LOBBY_CODE_LENGTH broke a dozen assertions that were
// never really about the number 4. Every fixture below is now built from the
// constant, so the suite follows the code wherever it goes.

import { describe, expect, it } from "vitest";
import {
  generateLobbyCode,
  isValidLobbyCode,
  LOBBY_CODE_LENGTH,
} from "./lobby-code";
import { mulberry32 } from "./seeded-rng";

/** A valid code, with `bad` swapped into the last position when given. */
function code(bad?: string): string {
  const body = "AB2ZCDE".repeat(3).slice(0, LOBBY_CODE_LENGTH);
  return bad === undefined ? body : body.slice(0, -1) + bad;
}

describe("generateLobbyCode", () => {
  it("returns codes of the expected length", () => {
    expect(generateLobbyCode()).toHaveLength(LOBBY_CODE_LENGTH);
  });

  it("is deterministic for a seeded rng", () => {
    expect(generateLobbyCode(mulberry32(42))).toBe(
      generateLobbyCode(mulberry32(42)),
    );
  });

  it("only ever emits valid codes", () => {
    const rng = mulberry32(7);
    for (let i = 0; i < 500; i += 1) {
      expect(isValidLobbyCode(generateLobbyCode(rng))).toBe(true);
    }
  });

  it("never emits ambiguous characters (0/O, 1/I/L)", () => {
    const rng = mulberry32(99);
    const codes = Array.from({ length: 500 }, () => generateLobbyCode(rng));
    expect(codes.join("")).not.toMatch(/[0O1IL]/);
  });

  it("draws on enough of the alphabet to be worth guessing at", () => {
    // A sanity floor on the keyspace: the code is the only thing gating a
    // room, so a regression that shortened it or collapsed the alphabet
    // should fail here rather than in production.
    const rng = mulberry32(3);
    const seen = new Set(
      Array.from({ length: 400 }, () => generateLobbyCode(rng)).join(""),
    );
    expect(seen.size).toBeGreaterThanOrEqual(30);
    expect(LOBBY_CODE_LENGTH).toBeGreaterThanOrEqual(6);
  });
});

describe("isValidLobbyCode", () => {
  it("accepts a well-formed code", () => {
    expect(isValidLobbyCode(code())).toBe(true);
  });

  it("rejects wrong lengths", () => {
    expect(isValidLobbyCode("")).toBe(false);
    expect(isValidLobbyCode(code().slice(0, -1))).toBe(false); // one short
    expect(isValidLobbyCode(`${code()}A`)).toBe(false); // one long
  });

  it("rejects ambiguous or foreign characters", () => {
    expect(isValidLobbyCode(code("0"))).toBe(false); // zero
    expect(isValidLobbyCode(code("O"))).toBe(false); // letter O
    expect(isValidLobbyCode(code("1"))).toBe(false); // one
    expect(isValidLobbyCode(code("I"))).toBe(false); // letter I
    expect(isValidLobbyCode(code("L"))).toBe(false); // letter L
    expect(isValidLobbyCode(code("-"))).toBe(false);
  });

  it("rejects lowercase input (callers normalize first)", () => {
    expect(isValidLobbyCode(code().toLowerCase())).toBe(false);
  });
});
