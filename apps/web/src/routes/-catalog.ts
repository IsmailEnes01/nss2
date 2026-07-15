// The game registry — the ONLY place the play-* features are enumerated
// (AGENTS.md "Adding a new game", step 5). The home grid and the game page
// both resolve games from here; game features never import each other, the
// page composes them. Dash-prefixed → route-private, ignored by the router.

import { BattleshipBoard, battleshipGame } from "@/features/play-battleship";
import {
  ConnectFourBoard,
  connectFourGame,
} from "@/features/play-connect-four";
import { DotsBoxesBoard, dotsBoxesGame } from "@/features/play-dots-boxes";
import { HangmanBoard, hangmanGame } from "@/features/play-hangman";
import {
  NumberGuessBoard,
  numberGuessGame,
} from "@/features/play-number-guess";
import { RpsBoard, rpsGame } from "@/features/play-rps";
import { XoxBoard, xoxGame } from "@/features/play-xox";
import type { ShellGame } from "@/widgets/game-shell";

/** Catalog order = the home grid order. */
export const gamesList: readonly ShellGame[] = [
  { def: xoxGame, Board: XoxBoard },
  { def: connectFourGame, Board: ConnectFourBoard },
  { def: rpsGame, Board: RpsBoard },
  { def: battleshipGame, Board: BattleshipBoard },
  { def: dotsBoxesGame, Board: DotsBoxesBoard },
  { def: hangmanGame, Board: HangmanBoard },
  { def: numberGuessGame, Board: NumberGuessBoard },
];

export const gamesById: ReadonlyMap<string, ShellGame> = new Map(
  gamesList.map((game) => [game.def.meta.id, game]),
);
