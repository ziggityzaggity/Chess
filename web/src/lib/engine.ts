// engine.ts — loads the C++ chess core (compiled to WebAssembly) in the browser.
//
// The build emits an Emscripten "MODULARIZE" factory named `createChessEngine`
// (see bindings/web/CMakeLists.txt). We inject it as a classic <script>, then
// call the factory with a `locateFile` so the sibling .wasm resolves under
// /engine. The whole thing is loaded once and memoised.

// Shape returned by ChessGame.doMove(...) across the embind boundary.
export interface DoMoveResult {
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

// The GUI-facing facade exposed by bindings/web/chess_web.cpp.
export interface ChessGame {
  reset(): void;
  setFen(fen: string): boolean;
  fen(): string;
  boardString(): string; // 64 chars, row-major, '.'=empty, PNBRQK / pnbrqk
  turn(): number; // 0 = white, 1 = black
  inCheck(): boolean;
  ply(): number;
  kingSquare(color: number): number;
  movesFrom(square: number): number[];
  isPromotion(from: number, to: number): boolean;
  doMove(from: number, to: number, promo: string): DoMoveResult;
  undo(): boolean;
  redo(): boolean;
  canUndo(): boolean;
  canRedo(): boolean;
  lastMoveUci(): string;
  isGameOver(): boolean;
  isCheckmate(): boolean;
  result(): number;
  drawReason(): number;
  pgn(): string;
  legalUci(): string[];
}

interface EngineModule {
  ChessGame: new () => ChessGame;
}

type EngineFactory = (opts?: {
  locateFile?: (path: string) => string;
}) => Promise<EngineModule>;

declare global {
  interface Window {
    createChessEngine?: EngineFactory;
  }
}

const ENGINE_BASE = "/engine";

let modulePromise: Promise<EngineModule> | null = null;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(
      "script[data-chess-engine]"
    );
    if (existing) {
      if (window.createChessEngine) resolve();
      else {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () =>
          reject(new Error("Failed to load chess engine script"))
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.dataset.chessEngine = "true";
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error("Failed to load chess engine script"));
    document.head.appendChild(script);
  });
}

/** Load (once) and return the WASM engine module. Browser only. */
export function loadEngine(): Promise<EngineModule> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("The chess engine only loads in the browser"));
  }
  if (!modulePromise) {
    modulePromise = (async () => {
      await loadScript(`${ENGINE_BASE}/chessengine.js`);
      const factory = window.createChessEngine;
      if (!factory) {
        throw new Error("createChessEngine factory was not defined");
      }
      return factory({
        locateFile: (path: string) => `${ENGINE_BASE}/${path}`,
      });
    })().catch((err) => {
      modulePromise = null; // allow a retry on a later mount
      throw err;
    });
  }
  return modulePromise;
}
