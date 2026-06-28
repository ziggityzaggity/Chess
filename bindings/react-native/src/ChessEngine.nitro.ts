import type { HybridObject } from "react-native-nitro-modules";

// Everything doMove(...) hands back to the UI in a single JSI round-trip.
// Mirrors the object returned by the web binding (bindings/web/chess_web.cpp).
export interface MoveResult {
  ok: boolean;
  from: number;
  to: number;
  san: string;
  capture: boolean;
  castle: boolean;
  promotion: boolean;
  enpassant: boolean;
  check: boolean;
  checkmate: boolean;
  gameOver: boolean;
  result: number; // 0 ongoing, 1 white, 2 black, 3 draw
  drawReason: number;
  board: string;
}

// A GUI-oriented facade over chess::Game, implemented in C++ on both platforms
// (Nitro generates the JSI glue from this spec). Squares are 0..63, row-major,
// row 0 = top (black's back rank) — identical to the core and the web binding.
export interface ChessEngine
  extends HybridObject<{ ios: "c++"; android: "c++" }> {
  // setup
  reset(): void;
  setFen(fen: string): boolean;
  fen(): string;

  // rendering
  boardString(): string; // 64 chars, '.'=empty, white PNBRQK / black pnbrqk
  turn(): number; // 0 = white, 1 = black
  inCheck(): boolean;
  ply(): number;
  kingSquare(color: number): number;

  // move input
  movesFrom(square: number): number[]; // legal target squares (highlighting)
  isPromotion(from: number, to: number): boolean;
  doMove(from: number, to: number, promo: string): MoveResult;

  // history
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  lastMoveUci(): string;

  // status
  isGameOver(): boolean;
  isCheckmate(): boolean;
  result(): number;
  drawReason(): number;
  pgn(): string;
  legalUci(): string[];
}
