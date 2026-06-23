// Maps a board glyph (from boardString / a FEN-ish row) to its texture file in
// /public/pieces. White is uppercase, black lowercase; pawns are "*p".
export const PIECE_FILE: Record<string, string> = {
  K: "wK",
  Q: "wQ",
  R: "wR",
  B: "wB",
  N: "wN",
  P: "wp",
  k: "bK",
  q: "bQ",
  r: "bR",
  b: "bB",
  n: "bN",
  p: "bp",
};

export function pieceSrc(glyph: string): string | null {
  const file = PIECE_FILE[glyph];
  return file ? `/pieces/${file}.png` : null;
}

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
