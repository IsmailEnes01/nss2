import { pickIndex } from "./seeded-rng";

/** 4-char code from the ambiguity-free alphabet (Math.random by default —
 * lobby codes are infrastructure, not game state, so no seed is required). */
export function generateLobbyCode(rng: () => number = Math.random): string {
  let code = "";
  for (let i = 0; i < LOBBY_CODE_LENGTH; i += 1) {
    code += LOBBY_CODE_ALPHABET[pickIndex(rng, LOBBY_CODE_ALPHABET.length)];
  }
  return code;
}

/** Exactly LOBBY_CODE_LENGTH chars, all from the alphabet (case-sensitive —
 * normalize with toUpperCase() before validating user input). */
export function isValidLobbyCode(value: string): boolean {
  return LOBBY_CODE_PATTERN.test(value);
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** No 0/O, 1/I/L — codes survive being read aloud or scribbled on paper. */
const LOBBY_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export const LOBBY_CODE_LENGTH = 4;

const LOBBY_CODE_PATTERN = new RegExp(
  `^[${LOBBY_CODE_ALPHABET}]{${LOBBY_CODE_LENGTH}}$`,
);
