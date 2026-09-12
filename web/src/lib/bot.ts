// Lightweight browser opponents: random, one-ply greedy, and two-ply minimax.
//
// All simulation runs on a *scratch* ChessGame set to the current FEN, so the
// real game's move history and undo/redo stack are never touched.

import type { ChessGame } from "./engine";
import type { BotId } from "./bots";

const VALUE: Record<string, number> = {
  p: 1,
  n: 3,
  b: 3,
  r: 5,
  q: 9,
  k: 0,
};

// Material balance from `botColor`'s point of view (0 = white, 1 = black).
function materialScore(board: string, botColor: number): number {
  let white = 0;
  let black = 0;
  for (const ch of board) {
    if (ch === ".") continue;
    const v = VALUE[ch.toLowerCase()] ?? 0;
    if (ch === ch.toUpperCase()) white += v;
    else black += v;
  }
  return botColor === 0 ? white - black : black - white;
}

/**
 * Pick a move for `botColor` from `fen`, using `scratch` for simulation.
 * Returns a UCI string ("e2e4", "e7e8q") or null if there are no legal moves.
 */
export function chooseBotMove(
  scratch: ChessGame,
  fen: string,
  botColor: number,
  botId: BotId = "greedy",
): string | null {
  if (!scratch.setFen(fen)) return null;
  const moves = scratch.legalUci();
  if (moves.length === 0) return null;
  if (scratch.isGameOver()) return null;
  if (botId === "random")
    return moves[Math.floor(Math.random() * moves.length)];

  let best: string | null = null;
  let bestScore = -Infinity;

  for (const uci of moves) {
    const res = playUci(scratch, uci);
    if (res.checkmate) {
      scratch.undo();
      return uci; // nothing beats mate
    }
    let score = positionScore(scratch, botColor);
    if (botId === "minimax" && !scratch.isGameOver()) {
      // The opponent chooses the reply that is worst for this bot.
      let replyScore = Infinity;
      for (const reply of scratch.legalUci()) {
        playUci(scratch, reply);
        replyScore = Math.min(replyScore, positionScore(scratch, botColor));
        scratch.undo();
      }
      if (replyScore !== Infinity) score = replyScore;
    }
    score += Math.random() * 0.1; // tie-break
    scratch.undo();

    if (score > bestScore) {
      bestScore = score;
      best = uci;
    }
  }
  return best;
}

function playUci(game: ChessGame, uci: string) {
  const square = (name: string) =>
    (8 - Number(name[1])) * 8 + name.charCodeAt(0) - 97;
  return game.doMove(
    square(uci.slice(0, 2)),
    square(uci.slice(2, 4)),
    uci[4] ?? "",
  );
}

function positionScore(game: ChessGame, botColor: number): number {
  if (game.isGameOver()) {
    if (game.result() === 3) return 0;
    return game.result() === botColor + 1 ? 10000 : -10000;
  }
  const check = game.inCheck() ? (game.turn() === botColor ? -0.4 : 0.4) : 0;
  return materialScore(game.boardString(), botColor) + check;
}
