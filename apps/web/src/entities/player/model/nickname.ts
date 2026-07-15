// Nickname persistence — localStorage only, no accounts. SSR-safe: on the
// server (no `window`) both functions are inert.

export function getNickname(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const value = window.localStorage.getItem(NICKNAME_KEY);
    return value !== null && value.trim() !== "" ? value : null;
  } catch {
    // Storage can be unavailable (private mode, blocked site data).
    return null;
  }
}

export function setNickname(name: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(NICKNAME_KEY, name.trim());
  } catch {
    // Best effort: the session still works, the name just won't persist.
  }
}

const NICKNAME_KEY = "lobi.nickname";
