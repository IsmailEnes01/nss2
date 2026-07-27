// UI sound. The click is SYNTHESIZED with the Web Audio API rather than
// loaded from a file: it's a 55ms blip, so shipping an asset (and a `public/`
// directory, and a licence question) to carry it would be silly. It also
// means the sound is a handful of numbers below — retune it by editing them,
// not by re-recording anything.
//
// Two browser realities shape this file:
//
//   1. Autoplay policy. A page may not create/run an AudioContext until the
//      user has interacted with it. Every call site here is a click handler,
//      so we're always inside a gesture — but the context is still created
//      lazily on the first play (never at import time, which would be before
//      any gesture) and resumed if the browser parked it.
//   2. SSR. This module is imported by components that render on the server,
//      where `window` and `AudioContext` don't exist. Nothing touches either
//      until a play/read actually happens, and the store hands React a
//      stable server snapshot so hydration doesn't mismatch.
//
// Mute is persisted in localStorage, the same way the nickname is. Sound is
// ON by default: a game that ships silent is a game nobody discovers has
// sound at all.

const STORAGE_KEY = "lobi.sound";

/** Peak gain of a click. Deliberately quiet — this fires on every button in
 * the app, and anything punchier gets grating within one match. */
const CLICK_GAIN = 0.07;
const CLICK_MS = 55;
const CLICK_FROM_HZ = 900;
const CLICK_TO_HZ = 480;

// ── Mute preference (a tiny subscribable store) ──────────────────────────────

let enabled: boolean | null = null; // null = not yet read from storage
const listeners = new Set<() => void>();

/** Reads the stored preference once, then caches. Defaults to on — including
 * when localStorage is unavailable (private mode, storage disabled), where
 * silently muting would be a worse surprise than silently playing. */
function current(): boolean {
  if (enabled !== null) return enabled;
  if (typeof window === "undefined") return true;
  try {
    enabled = window.localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    enabled = true;
  }
  return enabled;
}

export function isSoundEnabled(): boolean {
  return current();
}

export function setSoundEnabled(next: boolean): void {
  enabled = next;
  try {
    window.localStorage.setItem(STORAGE_KEY, next ? "on" : "off");
  } catch {
    // Preference just won't survive a reload; not worth surfacing.
  }
  for (const listener of listeners) listener();
}

export function subscribeSound(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** For `useSyncExternalStore`: the server always renders the default, and
 * React re-reads the real value after hydration. */
export function soundServerSnapshot(): boolean {
  return true;
}

// ── Playback ─────────────────────────────────────────────────────────────────

let context: AudioContext | null = null;

/** The AudioContext, created on first use (inside a user gesture) and resumed
 * if the browser suspended it. Returns null where audio isn't available at
 * all, so callers can stay `void`. */
function audio(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (context === null) {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (Ctor === undefined) return null;
    try {
      context = new Ctor();
    } catch {
      return null;
    }
  }
  // Browsers park the context when a tab is backgrounded, and start it
  // suspended if it was somehow built outside a gesture.
  if (context.state === "suspended") void context.resume();
  return context;
}

/** A short downward blip — a soft "tock" rather than a sharp mouse click,
 * which is what stays tolerable across a few hundred presses. Fire-and-forget:
 * the nodes are disposable and stop themselves. */
export function playClick(): void {
  if (!current()) return;
  const ctx = audio();
  if (ctx === null) return;

  const now = ctx.currentTime;
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();

  osc.type = "triangle";
  osc.frequency.setValueAtTime(CLICK_FROM_HZ, now);
  osc.frequency.exponentialRampToValueAtTime(CLICK_TO_HZ, now + CLICK_MS / 1000);

  // A near-instant attack with an exponential decay. Ramping to a tiny value
  // rather than 0 because exponentialRampToValueAtTime rejects zero, and the
  // linear alternative clicks audibly at the tail.
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(CLICK_GAIN, now + 0.005);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + CLICK_MS / 1000);

  osc.connect(gain).connect(ctx.destination);
  osc.start(now);
  osc.stop(now + CLICK_MS / 1000 + 0.02);
}
