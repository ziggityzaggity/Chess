// Thin adapter over the native Nitro module (react-native-chess-engine), which
// is a JSI binding to the header-only C++ core in ../../core.
//
// IMPORTANT: this only works in a *native* build (dev client / release), not in
// Expo Go — Expo Go cannot load custom native code. createChessEngine() throws
// if the native module isn't present; useChessGame() surfaces that as an error
// state with build instructions.
import { createChessEngine, type ChessEngine } from "react-native-chess-engine";

export type { ChessEngine, MoveResult } from "react-native-chess-engine";

export function makeEngine(): ChessEngine {
  return createChessEngine();
}
