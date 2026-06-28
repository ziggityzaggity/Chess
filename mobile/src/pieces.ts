import type { ImageSourcePropType } from "react-native";

// Glyph (from boardString) -> bundled texture. White uppercase, black lowercase;
// pawns are "*p". require() paths must be static literals for the Metro bundler.
export const PIECE_SRC: Record<string, ImageSourcePropType> = {
  K: require("../assets/pieces/wK.png"),
  Q: require("../assets/pieces/wQ.png"),
  R: require("../assets/pieces/wR.png"),
  B: require("../assets/pieces/wB.png"),
  N: require("../assets/pieces/wN.png"),
  P: require("../assets/pieces/wp.png"),
  k: require("../assets/pieces/bK.png"),
  q: require("../assets/pieces/bQ.png"),
  r: require("../assets/pieces/bR.png"),
  b: require("../assets/pieces/bB.png"),
  n: require("../assets/pieces/bN.png"),
  p: require("../assets/pieces/bp.png"),
};

export function pieceSrc(glyph: string): ImageSourcePropType | null {
  return PIECE_SRC[glyph] ?? null;
}

export const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
