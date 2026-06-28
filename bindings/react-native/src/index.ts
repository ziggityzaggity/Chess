import { NitroModules } from "react-native-nitro-modules";
import type { ChessEngine } from "./ChessEngine.nitro";

export type { ChessEngine, MoveResult } from "./ChessEngine.nitro";

// Each call returns a fresh, independent game (like `new ChessGame()` on web).
export function createChessEngine(): ChessEngine {
  return NitroModules.createHybridObject<ChessEngine>("ChessEngine");
}
