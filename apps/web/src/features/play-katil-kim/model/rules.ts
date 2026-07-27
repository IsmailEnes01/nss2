// Katil Kim (Who is Murderer) — a hidden-role elimination game over a
// repeating three-phase cycle:
//
//   1. `publicVote` — simultaneous. Every living seat votes to jail someone
//      (or abstains). A Mayor's ballot counts twice. A strict plurality is
//      jailed and out; any tie at the top jails nobody. SKIPPED on day 1
//      (there is nothing to go on yet), so a match opens straight on `day`.
//   2. `day` — turn-based, walking the seed-fixed random `order`. On their
//      turn a seat takes their role action: murderers vote a kill target,
//      cops vote a cell target, detectives learn one seat's role (privately),
//      doctors shield one seat for the coming night, and citizens/mayors have
//      nothing to do but pass. Anyone may pass.
//   3. `night` — a fixed-length report of who was removed, and nothing else.
//      Deliberately does NOT reveal the removed seats' roles.
//
// Removals are resolved on the day→night transition: the murderers' plurality
// target is killed *unless a doctor shielded exactly that seat this same
// round*, the cops' plurality target is sent to a cell (also a removal), ties
// inside either vote broken deterministically from the seed. A shield only
// ever counters the murderers and only within its own round — `protects` is
// cleared whenever a new day opens, so nothing carries forward, and a seat the
// cops cell goes regardless of any doctor.
//
// SECRECY IS UI-ONLY, BY DESIGN. Lobi is lockstep — every client replays the
// same move stream, so every client's memory necessarily holds every role and
// every vote. The board hides what the local seat shouldn't see; a player
// willing to open devtools can defeat that. This was an explicit product
// call: honor-system secrecy in exchange for keeping the room relay dumb, the
// same trust model Amiral Battı's fleets and Spektrum Çarkı's targets already
// use. Making it real would mean teaching the LobbyRoom DO to interpret game
// state and issue per-seat views, which no other game needs.
//
// Everything is derived from the room seed — no `Math.random()`, no
// wall-clock reads in the reducer. The night report's dwell time is the one
// timed thing, and it follows the established pattern: any client's own clock
// proposes `advanceNight`, and the reducer accepts it idempotently (day-number
// check plus "a report is actually showing"), so it does not matter whose
// proposal lands first and stale ones are harmless no-ops.

import type { GameDef, GameStatus, PlayerIndex } from "@/entities/game";
import { mulberry32 } from "@/shared/lib/seeded-rng";
import {
  distributeRoles,
  isEvil,
  type Role,
  type RoleCounts,
  shuffleTurnOrder,
  voteWeight,
} from "../config/roles";

// ── Constants ────────────────────────────────────────────────────────────────

/** How long every client shows a night report before proposing to move on. */
export const NIGHT_SECONDS = 6;

/** Shot clocks. `turnSeconds` is per seat during the turn-based day;
 * `voteSeconds` covers the whole simultaneous jail vote. Both exist so one
 * AFK player can't freeze the match — see the timeout branches in
 * `applyMove`. */
export const DEFAULT_TURN_SECONDS = 30;
export const MIN_TURN_SECONDS = 10;
export const MAX_TURN_SECONDS = 120;

export const DEFAULT_VOTE_SECONDS = 90;
export const MIN_VOTE_SECONDS = 15;
export const MAX_VOTE_SECONDS = 180;

export const DEFAULT_MURDERERS = 1;
export const DEFAULT_DETECTIVES = 1;
export const DEFAULT_COPS = 1;
export const DEFAULT_MAYORS = 1;
export const DEFAULT_DOCTORS = 1;

const MAX_MURDERERS = 6;
const MAX_SPECIALS = 4;

// ── Game definition ──────────────────────────────────────────────────────────

export const katilKimGame: GameDef<KatilKimState, KatilKimMove> = {
  meta: {
    id: "katil-kim",
    name: "Katil Kim",
    icon: "🔪",
    tagline: "Gizli roller, her gün bir oylama — katilleri bul ya da hepsini avla.",
    // Four is the floor where a single murderer still faces a real vote; the
    // roster screen caps the other end at the room's 16.
    minPlayers: 4,
    maxPlayers: 16,
    settings: [
      {
        key: "murderers",
        label: "Katil sayısı",
        min: 1,
        max: MAX_MURDERERS,
        default: DEFAULT_MURDERERS,
      },
      {
        key: "detectives",
        label: "Dedektif sayısı",
        min: 0,
        max: MAX_SPECIALS,
        default: DEFAULT_DETECTIVES,
      },
      {
        key: "cops",
        label: "Polis sayısı",
        min: 0,
        max: MAX_SPECIALS,
        default: DEFAULT_COPS,
      },
      {
        key: "mayors",
        label: "Başkan sayısı",
        min: 0,
        max: MAX_SPECIALS,
        default: DEFAULT_MAYORS,
      },
      {
        key: "doctors",
        label: "Doktor sayısı",
        min: 0,
        max: MAX_SPECIALS,
        default: DEFAULT_DOCTORS,
      },
      {
        key: "turnSeconds",
        label: "Sıra süresi (sn)",
        min: MIN_TURN_SECONDS,
        max: MAX_TURN_SECONDS,
        default: DEFAULT_TURN_SECONDS,
      },
      {
        key: "voteSeconds",
        label: "Oylama süresi (sn)",
        min: MIN_VOTE_SECONDS,
        max: MAX_VOTE_SECONDS,
        default: DEFAULT_VOTE_SECONDS,
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

/** Roles and speaking order are both fixed here, from the room seed, so every
 * client agrees without a single byte crossing the wire about either. Day 1
 * opens on the `day` phase: there is no evidence to hold a jail vote over
 * yet. `seed` is kept in state because tie-breaks need it later, and the
 * reducer must stay a pure function of state. */
function init(
  seed: number,
  playerCount: number,
  settings: Readonly<Record<string, number>> = {},
): KatilKimState {
  const requested: RoleCounts = {
    murderers: settings.murderers ?? DEFAULT_MURDERERS,
    detectives: settings.detectives ?? DEFAULT_DETECTIVES,
    cops: settings.cops ?? DEFAULT_COPS,
    mayors: settings.mayors ?? DEFAULT_MAYORS,
    doctors: settings.doctors ?? DEFAULT_DOCTORS,
  };
  const order = shuffleTurnOrder(seed, playerCount);
  return {
    seed,
    playerCount,
    turnSeconds: clampSetting(
      settings.turnSeconds,
      MIN_TURN_SECONDS,
      MAX_TURN_SECONDS,
      DEFAULT_TURN_SECONDS,
    ),
    voteSeconds: clampSetting(
      settings.voteSeconds,
      MIN_VOTE_SECONDS,
      MAX_VOTE_SECONDS,
      DEFAULT_VOTE_SECONDS,
    ),
    roles: distributeRoles(seed, playerCount, requested),
    order,
    alive: Array(playerCount).fill(true),
    day: 1,
    phase: "day",
    cursor: 0,
    publicVotes: Array(playerCount).fill(null),
    acted: Array(playerCount).fill(false),
    killVotes: Array(playerCount).fill(null),
    cellVotes: Array(playerCount).fill(null),
    protects: Array(playerCount).fill(null),
    findings: [],
    night: null,
    history: [],
  };
}

function applyMove(
  state: KatilKimState,
  move: KatilKimMove,
  player: PlayerIndex,
): KatilKimState | null {
  // The night report is a pause, not a phase anyone acts in — only the
  // (idempotent) proposal to leave it is legal while one is showing.
  if (state.phase === "night") {
    if (!isAdvanceNightMove(move)) return null;
    if (state.night === null) return null;
    if (move.day !== state.night.day) return null;
    return openNextDay(state);
  }
  // Both timeouts below are proposed by any client's own clock once its local
  // deadline passes, and both are idempotent: scoped to a day (and, for the
  // turn timer, to the seat that is actually on the clock), so a stale
  // proposal from a phase that already moved on is a harmless no-op. Without
  // them a single AFK seat froze the match permanently — the day cannot end
  // until every living seat has acted.
  if (isVoteTimeoutMove(move)) {
    if (state.phase !== "publicVote") return null;
    if (move.day !== state.day) return null;
    // Anyone who never got a ballot in is recorded as abstaining, which is
    // the same thing a deliberate abstention produces.
    const publicVotes = state.publicVotes.map((vote, seat) =>
      state.alive[seat] && vote === null ? ABSTAIN : vote,
    );
    return resolvePublicVote({ ...state, publicVotes });
  }
  if (isTurnTimeoutMove(move)) {
    if (state.phase !== "day") return null;
    if (move.day !== state.day) return null;
    const stalled = turn(state);
    // Naming the seat makes this safe to fire from every client at once: once
    // the stalled seat has been skipped, the turn has moved on and every
    // later copy of the same proposal fails this check.
    if (stalled === null || stalled !== move.seat) return null;
    return finishTurn({ ...state, acted: replaceAt(state.acted, stalled, true) });
  }

  if (!isSeat(player, state.playerCount)) return null;
  if (!state.alive[player]) return null;

  if (state.phase === "publicVote") {
    if (!isPublicVoteMove(move)) return null;
    if (state.publicVotes[player] !== null) return null; // one ballot each
    if (move.target !== null && !isLivingTarget(state, move.target, player)) {
      return null;
    }
    // Abstaining is a real, recorded choice ("ABSTAIN"), not a missing
    // ballot — otherwise the phase could never tell "hasn't voted yet" from
    // "chose not to", and would wait forever on an abstainer.
    const publicVotes = replaceAt(
      state.publicVotes,
      player,
      move.target ?? ABSTAIN,
    );
    const voted = { ...state, publicVotes };
    return everyoneVoted(voted) ? resolvePublicVote(voted) : voted;
  }

  // `day`: strictly the seat whose turn it is, once.
  if (turn(state) !== player) return null;
  if (state.acted[player]) return null;

  const role = state.roles[player];
  let next: KatilKimState = state;

  if (isPassMove(move)) {
    next = state;
  } else if (isKillVoteMove(move)) {
    if (role !== "murderer") return null;
    if (!isLivingTarget(state, move.target, player)) return null;
    next = { ...state, killVotes: replaceAt(state.killVotes, player, move.target) };
  } else if (isCellVoteMove(move)) {
    if (role !== "cop") return null;
    if (!isLivingTarget(state, move.target, player)) return null;
    next = { ...state, cellVotes: replaceAt(state.cellVotes, player, move.target) };
  } else if (isProtectMove(move)) {
    if (role !== "doctor") return null;
    // `isLivingTarget` already rules out self — the doctor can't save
    // themselves, per the brief, and that's the same rule every other
    // targeted action follows.
    if (!isLivingTarget(state, move.target, player)) return null;
    next = { ...state, protects: replaceAt(state.protects, player, move.target) };
  } else if (isInvestigateMove(move)) {
    if (role !== "detective") return null;
    if (!isLivingTarget(state, move.target, player)) return null;
    next = {
      ...state,
      findings: [
        ...state.findings,
        {
          day: state.day,
          by: player,
          target: move.target,
          role: state.roles[move.target],
        },
      ],
    };
  } else {
    return null;
  }

  return finishTurn({ ...next, acted: replaceAt(next.acted, player, true) });
}

/** Closes out whoever just acted (or was skipped by the turn timer).
 * Advancing the cursor and resolving the night are the same decision: the
 * day is over exactly when no living seat is left to act. */
function finishTurn(state: KatilKimState): KatilKimState {
  return nextActor(state) === null
    ? resolveNight(state)
    : { ...state, cursor: state.cursor + 1 };
}

/** Good wins the moment no murderer is left; evil wins the moment no good
 * seat is. Both emptying at once (the last murderer celled on the same night
 * the last citizen was killed) is a genuine draw. */
function status(state: KatilKimState): GameStatus {
  const evilAlive = livingSeats(state).filter((seat) =>
    isEvil(state.roles[seat]),
  );
  const goodAlive = livingSeats(state).filter(
    (seat) => !isEvil(state.roles[seat]),
  );
  if (evilAlive.length === 0 && goodAlive.length === 0) return { kind: "draw" };
  // The whole winning side wins, dead members included — a villager murdered
  // on night one still beat the murderers. So `winners` is every seat on that
  // side rather than only the survivors.
  if (evilAlive.length === 0) return { kind: "won", winners: sideSeats(state, false) };
  if (goodAlive.length === 0) return { kind: "won", winners: sideSeats(state, true) };
  return { kind: "ongoing" };
}

/** Every seat on one alignment, alive or not. */
function sideSeats(state: KatilKimState, evil: boolean): PlayerIndex[] {
  return seats(state.playerCount).filter(
    (seat) => isEvil(state.roles[seat]) === evil,
  );
}

/** Only the `day` phase has a turn — the jail vote is simultaneous and the
 * night report is nobody's move. */
function turn(state: KatilKimState): PlayerIndex | null {
  if (state.phase !== "day") return null;
  return nextActor(state);
}

// ── Phase transitions ────────────────────────────────────────────────────────

/** Tallies the jail vote and opens the day. A strict plurality is removed;
 * a tie at the top removes nobody, per the brief. */
function resolvePublicVote(state: KatilKimState): KatilKimState {
  const tally = new Map<PlayerIndex, number>();
  for (const seat of livingSeats(state)) {
    const vote = state.publicVotes[seat];
    if (vote === null || vote === ABSTAIN) continue;
    tally.set(vote, (tally.get(vote) ?? 0) + voteWeight(state.roles[seat]));
  }
  const leaders = topTargets(tally);
  const jailed = leaders.length === 1 ? leaders[0] : null;

  return {
    ...state,
    phase: "day",
    alive: jailed === null ? state.alive : replaceAt(state.alive, jailed, false),
    jailedToday: jailed,
    cursor: 0,
    acted: Array(state.playerCount).fill(false),
    killVotes: Array(state.playerCount).fill(null),
    cellVotes: Array(state.playerCount).fill(null),
    protects: Array(state.playerCount).fill(null),
  };
}

/** Closes the day: murderers' plurality target dies, cops' plurality target
 * is celled (also a removal). Ties inside either vote are broken from the
 * seed rather than skipped — the brief asks for a random pick among tied. */
function resolveNight(state: KatilKimState): KatilKimState {
  const target = pluralityTarget(state, state.killVotes, "kill");
  const celled = pluralityTarget(state, state.cellVotes, "cell");

  // The doctors' saves only count against a kill landing in THIS round —
  // `protects` is wiped every time a new day opens, so a protection can never
  // carry forward to a later night. Protection is specifically against the
  // murderers: a seat the cops send to a cell still goes, doctor or not.
  const guarded = state.protects.some(
    (protectedSeat, seat) =>
      state.alive[seat] && protectedSeat !== null && protectedSeat === target,
  );
  const saved = guarded ? target : null;
  const killed = guarded ? null : target;

  let alive = state.alive;
  if (killed !== null) alive = replaceAt(alive, killed, false);
  if (celled !== null) alive = replaceAt(alive, celled, false);

  const report: NightReport = {
    day: state.day,
    killed,
    celled,
    saved,
    jailed: state.jailedToday ?? null,
  };
  return {
    ...state,
    phase: "night",
    alive,
    night: report,
    history: [...state.history, report],
  };
}

/** Leaves the night report for the next day's jail vote. Days after the
 * first always open on the vote — only day 1 skips it. */
function openNextDay(state: KatilKimState): KatilKimState {
  return {
    ...state,
    day: state.day + 1,
    phase: "publicVote",
    night: null,
    jailedToday: null,
    cursor: 0,
    publicVotes: Array(state.playerCount).fill(null),
    acted: Array(state.playerCount).fill(false),
    killVotes: Array(state.playerCount).fill(null),
    cellVotes: Array(state.playerCount).fill(null),
    protects: Array(state.playerCount).fill(null),
  };
}

// ── Tallies ──────────────────────────────────────────────────────────────────

/** Winner of one secret ballot (murderers' or cops'), counting only ballots
 * cast by seats still alive. A tie is resolved by a seeded pick among the
 * tied, salted with the day and which ballot it is so the two votes on the
 * same day can't collapse to the same "random" choice. */
function pluralityTarget(
  state: KatilKimState,
  votes: readonly (PlayerIndex | null)[],
  salt: "kill" | "cell",
): PlayerIndex | null {
  const tally = new Map<PlayerIndex, number>();
  for (const seat of livingSeats(state)) {
    const vote = votes[seat];
    if (vote === null) continue;
    tally.set(vote, (tally.get(vote) ?? 0) + 1);
  }
  const leaders = topTargets(tally);
  if (leaders.length === 0) return null;
  if (leaders.length === 1) return leaders[0];
  const rng = mulberry32(
    (state.seed ^ (state.day * 0x9e3779b9) ^ (salt === "kill" ? 0x11 : 0x22)) >>>
      0,
  );
  return leaders[Math.floor(rng() * leaders.length)];
}

/** Every target sharing the highest count — one entry means a clear winner,
 * several mean a tie, none means nobody voted. Sorted by seat so the tie list
 * is order-independent across clients. */
function topTargets(tally: Map<PlayerIndex, number>): PlayerIndex[] {
  let best = 0;
  for (const count of tally.values()) best = Math.max(best, count);
  if (best === 0) return [];
  return [...tally.entries()]
    .filter(([, count]) => count === best)
    .map(([target]) => target)
    .sort((left, right) => left - right);
}

// ── Queries (exported for the board) ─────────────────────────────────────────

export function livingSeats(state: KatilKimState): PlayerIndex[] {
  return seats(state.playerCount).filter((seat) => state.alive[seat]);
}

/** The murderers a given seat is allowed to see: none unless that seat is
 * itself a murderer, in which case all of them (dead ones included — knowing
 * an ally is gone is part of the information). */
export function visibleAllies(
  state: KatilKimState,
  me: PlayerIndex,
): PlayerIndex[] {
  if (state.roles[me] !== "murderer") return [];
  return seats(state.playerCount).filter(
    (seat) => seat !== me && state.roles[seat] === "murderer",
  );
}

/** What a detective has learned, newest first — the board must only ever be
 * handed the local seat's own findings. */
export function findingsFor(
  state: KatilKimState,
  me: PlayerIndex,
): Finding[] {
  return state.findings.filter((finding) => finding.by === me).reverse();
}

/** Whether `me` still owes an action in the current phase. */
export function awaitingMe(state: KatilKimState, me: PlayerIndex): boolean {
  if (!state.alive[me]) return false;
  if (state.phase === "publicVote") return state.publicVotes[me] === null;
  if (state.phase === "day") return turn(state) === me;
  return false;
}

/** How many living seats have got their jail ballot in, for a progress line. */
export function publicVoteProgress(state: KatilKimState): {
  cast: number;
  total: number;
} {
  const living = livingSeats(state);
  return {
    cast: living.filter((seat) => state.publicVotes[seat] !== null).length,
    total: living.length,
  };
}

/** Which alignment took the match — the board's headline. Reads the first
 * winner's role, which is safe because `status` only ever fills `winners`
 * from a single side. */
export function winningSide(state: KatilKimState): "good" | "evil" | null {
  const result = status(state);
  if (result.kind !== "won") return null;
  return isEvil(state.roles[result.winners[0]]) ? "evil" : "good";
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Sentinel for "voted to jail nobody" — distinct from `null`, which means
 * "hasn't voted at all". Negative so it can never collide with a seat. */
export const ABSTAIN = -1;

/** The next living seat in speaking order that still owes an action, or null
 * when the day is done. Walks from `cursor` so dead and already-acted seats
 * are skipped without mutating anything. */
function nextActor(state: KatilKimState): PlayerIndex | null {
  for (let step = state.cursor; step < state.order.length; step += 1) {
    const seat = state.order[step];
    if (state.alive[seat] && !state.acted[seat]) return seat;
  }
  return null;
}

function everyoneVoted(state: KatilKimState): boolean {
  return livingSeats(state).every((seat) => state.publicVotes[seat] !== null);
}

/** A legal target: a living seat other than the actor. Self-targeting is out
 * across the board — there is no version of this game where voting to jail,
 * kill, cell or investigate yourself is a move worth having. */
function isLivingTarget(
  state: KatilKimState,
  target: number,
  actor: PlayerIndex,
): boolean {
  return (
    isSeat(target, state.playerCount) && state.alive[target] && target !== actor
  );
}

function isSeat(value: number, playerCount: number): boolean {
  return Number.isInteger(value) && value >= 0 && value < playerCount;
}

/** Re-clamps a host setting that crossed the wire. */
function clampSetting(
  value: number | undefined,
  min: number,
  max: number,
  fallback: number,
): number {
  if (value === undefined || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function seats(playerCount: number): PlayerIndex[] {
  return Array.from({ length: playerCount }, (_, index) => index);
}

function replaceAt<T>(items: readonly T[], index: number, value: T): T[] {
  const out = [...items];
  out[index] = value;
  return out;
}

// ── Move guards ──────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isPublicVoteMove(move: unknown): move is PublicVoteMove {
  if (!isRecord(move) || move.t !== "publicVote") return false;
  return move.target === null || typeof move.target === "number";
}

function isKillVoteMove(move: unknown): move is KillVoteMove {
  return isRecord(move) && move.t === "killVote" && typeof move.target === "number";
}

function isCellVoteMove(move: unknown): move is CellVoteMove {
  return isRecord(move) && move.t === "cellVote" && typeof move.target === "number";
}

function isProtectMove(move: unknown): move is ProtectMove {
  return (
    isRecord(move) && move.t === "protect" && typeof move.target === "number"
  );
}

function isInvestigateMove(move: unknown): move is InvestigateMove {
  return (
    isRecord(move) && move.t === "investigate" && typeof move.target === "number"
  );
}

function isPassMove(move: unknown): move is PassMove {
  return isRecord(move) && move.t === "pass";
}

function isAdvanceNightMove(move: unknown): move is AdvanceNightMove {
  return (
    isRecord(move) && move.t === "advanceNight" && typeof move.day === "number"
  );
}

function isTurnTimeoutMove(move: unknown): move is TurnTimeoutMove {
  return (
    isRecord(move) &&
    move.t === "turnTimeout" &&
    typeof move.day === "number" &&
    typeof move.seat === "number"
  );
}

function isVoteTimeoutMove(move: unknown): move is VoteTimeoutMove {
  return (
    isRecord(move) && move.t === "voteTimeout" && typeof move.day === "number"
  );
}

// ── Types ────────────────────────────────────────────────────────────────────

export type Phase = "publicVote" | "day" | "night";

/** One detective result. Stored for the whole match (the detective keeps a
 * notebook), but only ever shown to `by`. */
export interface Finding {
  day: number;
  by: PlayerIndex;
  target: PlayerIndex;
  role: Role;
}

/** What a night removed. Roles are deliberately absent — the brief is
 * explicit that the dead stay anonymous. */
export interface NightReport {
  day: number;
  /** Murderers' victim, or null if they cast no votes. */
  killed: PlayerIndex | null;
  /** Cops' cell target, or null if they cast no votes. */
  celled: PlayerIndex | null;
  /** Whom a doctor pulled out of the murderers' hands this round, if anyone.
   * Non-null means `killed` is null *because* of this save. */
  saved: PlayerIndex | null;
  /** Who that day's opening jail vote removed, if any — repeated here so one
   * report covers everything that happened over the whole day. */
  jailed: PlayerIndex | null;
}

export interface KatilKimState {
  /** Kept so tie-breaks stay a pure function of state. */
  seed: number;
  playerCount: number;
  /** Shot clock per seat during the turn-based day. */
  turnSeconds: number;
  /** Shot clock for the whole simultaneous jail vote. */
  voteSeconds: number;
  roles: readonly Role[];
  /** Seats in speaking order — a seed-fixed permutation, not sorted. */
  order: readonly PlayerIndex[];
  alive: readonly boolean[];
  /** 1-based; day 1 has no opening jail vote. */
  day: number;
  phase: Phase;
  /** How far into `order` the day phase has walked. */
  cursor: number;
  /** Per seat: `null` not voted, `ABSTAIN`, or a target seat. */
  publicVotes: readonly (PlayerIndex | null)[];
  acted: readonly boolean[];
  killVotes: readonly (PlayerIndex | null)[];
  cellVotes: readonly (PlayerIndex | null)[];
  /** Per seat: who that doctor shielded this round. Cleared every new day —
   * a save never carries into a later night. */
  protects: readonly (PlayerIndex | null)[];
  findings: readonly Finding[];
  /** Non-null only during `night` — the report currently on screen. */
  night: NightReport | null;
  history: readonly NightReport[];
  /** Who this day's opening jail vote removed, carried until the night report
   * folds it in. Absent on day 1, which holds no jail vote. */
  jailedToday?: PlayerIndex | null;
}

interface PublicVoteMove {
  t: "publicVote";
  /** null abstains. */
  target: PlayerIndex | null;
}
interface KillVoteMove {
  t: "killVote";
  target: PlayerIndex;
}
interface CellVoteMove {
  t: "cellVote";
  target: PlayerIndex;
}
interface InvestigateMove {
  t: "investigate";
  target: PlayerIndex;
}
interface ProtectMove {
  t: "protect";
  target: PlayerIndex;
}
interface PassMove {
  t: "pass";
}
interface AdvanceNightMove {
  t: "advanceNight";
  day: number;
}
/** Skips the seat currently on the clock. Names the seat so every client can
 * fire it at once without double-skipping. */
interface TurnTimeoutMove {
  t: "turnTimeout";
  day: number;
  seat: PlayerIndex;
}
/** Closes the jail vote, abstaining for anyone who never voted. */
interface VoteTimeoutMove {
  t: "voteTimeout";
  day: number;
}

export type KatilKimMove =
  | PublicVoteMove
  | KillVoteMove
  | CellVoteMove
  | InvestigateMove
  | ProtectMove
  | PassMove
  | AdvanceNightMove
  | TurnTimeoutMove
  | VoteTimeoutMove;
