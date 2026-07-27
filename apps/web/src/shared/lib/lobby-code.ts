import { pickIndex } from "./seeded-rng";

/** A code from the ambiguity-free alphabet (Math.random by default — lobby
 * codes are infrastructure, not game state, so no seed is required). */
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

/** A room is reachable by anyone who guesses its code, and nothing else gates
 * entry, so the code IS the access control. At 31 symbols, 4 characters was
 * only ~923k possibilities — small enough that a script could sweep a
 * meaningful share of the live rooms. Seven characters is ~27.5 billion,
 * which puts blind guessing out of reach.
 *
 * Note this is the only thing protecting a room: there's no rate limiting on
 * the Durable Object, so length is doing all the work. If rooms ever hold
 * anything sensitive, that gap matters more than these two extra characters. */
export const LOBBY_CODE_LENGTH = 7;

const LOBBY_CODE_PATTERN = new RegExp(
  `^[${LOBBY_CODE_ALPHABET}]{${LOBBY_CODE_LENGTH}}$`,
);
