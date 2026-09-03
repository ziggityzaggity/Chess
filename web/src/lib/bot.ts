// A lightweight opponent for "Play the bot". The web engine binding exposes
// legal-move generation and game state but no search, so this is a deliberately
// simple 1-ply player: it takes a mate in one, otherwise it maximises material
// (with a small nudge toward checks) and breaks ties at random.
//
// All simulation runs on a *scratch* ChessGame set to the current FEN, so the
// real game's move history and undo/redo stack are never touched.

import type { ChessGame } from "./engine";
import { squareFromName } from "./useChessGame";

const VALUE: Record<string, number> = {
  p: 1, n: 3, b: 3, r: 5, q: 9, k: 0,
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
  botColor: number
): string | null {
  if (!scratch.setFen(fen)) return null;
  const moves = scratch.legalUci();
  if (moves.length === 0) return null;

  let best: string | null = null;
  let bestScore = -Infinity;

  for (const uci of moves) {
    const from = squareFromName(uci.slice(0, 2));
    const to = squareFromName(uci.slice(2, 4));
    const promo = uci.length >= 5 ? uci[4] : "";

    const res = scratch.doMove(from, to, promo);
    if (res.checkmate) {
      scratch.undo();
      return uci; // nothing beats mate
    }
    let score = materialScore(scratch.boardString(), botColor);
    if (res.check) score += 0.4;
    score += Math.random() * 0.1; // tie-break
    scratch.undo();

    if (score > bestScore) {
      bestScore = score;
      best = uci;
    }
  }
  return best;
}
