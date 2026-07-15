import { describe, expect, it } from "vitest";
import {
  generateLobbyCode,
  isValidLobbyCode,
  LOBBY_CODE_LENGTH,
} from "./lobby-code";
import { mulberry32 } from "./seeded-rng";

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
});

describe("isValidLobbyCode", () => {
  it("accepts a well-formed code", () => {
    expect(isValidLobbyCode("AB2Z")).toBe(true);
  });

  it("rejects wrong lengths", () => {
    expect(isValidLobbyCode("")).toBe(false);
    expect(isValidLobbyCode("ABC")).toBe(false);
    expect(isValidLobbyCode("ABCDE")).toBe(false);
  });

  it("rejects ambiguous or foreign characters", () => {
    expect(isValidLobbyCode("AB0D")).toBe(false); // zero
    expect(isValidLobbyCode("ABOD")).toBe(false); // letter O
    expect(isValidLobbyCode("AB1D")).toBe(false); // one
    expect(isValidLobbyCode("ABID")).toBe(false); // letter I
    expect(isValidLobbyCode("ABLD")).toBe(false); // letter L
    expect(isValidLobbyCode("AB-D")).toBe(false);
  });

  it("rejects lowercase input (callers normalize first)", () => {
    expect(isValidLobbyCode("abcd")).toBe(false);
  });
});
