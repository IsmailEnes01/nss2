// Katil Kim's role catalog and the seeded setup that hands them out. Kept
// out of rules.ts so adding a role later (the brief says "more to be added")
// is a change to this file plus whatever action it unlocks — the phase
// machine itself doesn't enumerate roles.
//
// Alignment is binary: `murderer` is the only evil role, everything else is
// good. Win conditions in rules.ts lean on that rather than on a list, so a
// new good role needs no changes there either.

import { mulberry32 } from "@/shared/lib/seeded-rng";

// ── Roles ────────────────────────────────────────────────────────────────────

export type Role = "murderer" | "citizen" | "detective" | "cop" | "mayor";

export const ROLE_INFO: Readonly<Record<Role, RoleInfo>> = {
  murderer: {
    name: "Katil",
    icon: "🔪",
    evil: true,
    blurb:
      "Her gün bir kişiyi öldürmek için oy ver. Diğer katilleri görürsün.",
  },
  citizen: {
    name: "Vatandaş",
    icon: "🧑",
    evil: false,
    blurb: "Özel bir gücün yok — gündüz oylamasında doğru tahmin et.",
  },
  detective: {
    name: "Dedektif",
    icon: "🔍",
    evil: false,
    blurb: "Her gün bir kişinin rolünü öğren. Sonucu yalnızca sen görürsün.",
  },
  cop: {
    name: "Polis",
    icon: "👮",
    evil: false,
    blurb: "Her gün bir kişiyi hücreye göndermek için oy ver.",
  },
  mayor: {
    name: "Başkan",
    icon: "🎩",
    evil: false,
    blurb: "Gündüz oylamasında oyun iki oy sayılır.",
  },
};

/** Every role that isn't the murderer counts as good — see the file header. */
export function isEvil(role: Role): boolean {
  return ROLE_INFO[role].evil;
}

/** Weight a seat's ballot carries in the public jail vote. The Mayor's
 * doubled vote only ever matters here: roles are exclusive, so a Mayor is
 * never also casting a murderer or cop ballot. */
export function voteWeight(role: Role): number {
  return role === "mayor" ? 2 : 1;
}

// ── Setup ────────────────────────────────────────────────────────────────────

/** Host-tunable counts, clamped against the actual seat count in
 * `distributeRoles` — the settings screen can't know how many people ended up
 * "playing", so the numbers that arrive here may not fit. */
export interface RoleCounts {
  murderers: number;
  detectives: number;
  cops: number;
  mayors: number;
}

/** Fills seats with roles and shuffles them, deterministically from the room
 * seed. Requests are honored in priority order (murderers, then detective,
 * cop, mayor) and truncated once seats run out; whatever is left over becomes
 * citizens. Murderers are additionally capped at `playerCount - 1` so there
 * is always at least one good seat — a match that starts already won would
 * be nobody's idea of a game. */
export function distributeRoles(
  seed: number,
  playerCount: number,
  requested: RoleCounts,
): Role[] {
  const murderers = clampCount(requested.murderers, 1, playerCount - 1);
  let free = playerCount - murderers;

  const detectives = clampCount(requested.detectives, 0, free);
  free -= detectives;
  const cops = clampCount(requested.cops, 0, free);
  free -= cops;
  const mayors = clampCount(requested.mayors, 0, free);
  free -= mayors;

  const roles: Role[] = [
    ...Array<Role>(murderers).fill("murderer"),
    ...Array<Role>(detectives).fill("detective"),
    ...Array<Role>(cops).fill("cop"),
    ...Array<Role>(mayors).fill("mayor"),
    ...Array<Role>(free).fill("citizen"),
  ];
  return shuffle(roles, mulberry32(seed ^ 0x5f3a));
}

/** The random speaking order the day phase walks. A separate RNG stream from
 * `distributeRoles` (different salt) so turn order carries no information
 * about who got which role. */
export function shuffleTurnOrder(seed: number, playerCount: number): number[] {
  const seats = Array.from({ length: playerCount }, (_, index) => index);
  return shuffle(seats, mulberry32(seed ^ 0x2c1b));
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Fisher-Yates over a copy, drawing from the caller's seeded generator. */
function shuffle<T>(items: readonly T[], rng: () => number): T[] {
  const out = [...items];
  for (let index = out.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(rng() * (index + 1));
    const held = out[index];
    out[index] = out[swap];
    out[swap] = held;
  }
  return out;
}

function clampCount(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(Math.trunc(value), min), Math.max(min, max));
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface RoleInfo {
  /** Turkish display name. */
  name: string;
  icon: string;
  evil: boolean;
  /** One-line Turkish explanation of what this role does. */
  blurb: string;
}
