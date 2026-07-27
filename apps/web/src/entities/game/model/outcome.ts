// One place that turns a finished `GameStatus` into a Turkish headline, so
// every board and the shell's status bar phrase a result the same way.
//
// This exists because `winners` is a list: a team win (Katil Kim) and a
// shared top score (Kapmaca, Spektrum Çarkı) both have several holders, and
// three boards had independently written the single-winner phrasing that
// silently named one arbitrary seat when there were more.

import type { GameStatus, PlayerIndex } from "./game-def";

/** Turkish result line for a finished match, from `me`'s perspective.
 * `nameOf` resolves a seat to whatever the caller wants to show — a real
 * nickname where the board has `names`, or the game's own `playerLabel`
 * otherwise. Returns "" while the match is still ongoing, so callers can
 * render it unconditionally. */
export function outcomeText(
  status: GameStatus,
  me: PlayerIndex,
  nameOf: (seat: PlayerIndex) => string,
): string {
  if (status.kind === "ongoing") return "";
  if (status.kind === "draw") return "Berabere!";

  const { winners } = status;
  const iWon = winners.includes(me);
  if (winners.length === 1) {
    return iWon ? "Kazandın! 🎉" : `${nameOf(winners[0])} kazandı`;
  }
  // Several holders: name them all, and still lead with the good news if I'm
  // among them — "Kazandın" first, the roll call in parentheses.
  const named = winners.map(nameOf).join(", ");
  return iWon ? `Kazandın! 🎉 (${named})` : `${named} kazandı`;
}
