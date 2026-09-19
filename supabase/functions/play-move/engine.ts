// engine.ts — loads the C++/WASM chess engine inside the Deno edge runtime and
// exposes a stateless validate() that reconstructs full game state (including
// repetition history) by replaying the move list from the start position.
//
// We deliberately do NOT reuse web/src/lib/engine.ts (it is DOM-coupled). The
// Emscripten glue and the .wasm are base64-embedded (engine-assets.ts) so the
// whole engine ships in the function bundle with no external asset files. We run
// the glue in a CJS shim and hand it the .wasm bytes via `wasmBinary`, so no
// filesystem/fetch path is exercised. The module is instantiated once at import
// time and reused across warm invocations.

import nodeFs from "node:fs";
import { GLUE_B64, WASM_B64 } from "./engine-assets.ts";

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// deno-lint-ignore no-explicit-any
type EngineFactory = (opts: Record<string, any>) => Promise<EngineModule>;

// The Emscripten glue is UMD/CJS built for ENVIRONMENT=web,node. We run it in a
// CJS shim that supplies module/exports/require and the __dirname/__filename its
// node branch references. This build does NOT wire Module.wasmBinary, so we
// instead override Module.instantiateWasm to hand it a WebAssembly instance
// compiled from the embedded bytes — the filesystem/fetch path is never touched.
function loadGlue(): EngineFactory {
  const src = new TextDecoder().decode(b64ToBytes(GLUE_B64));
  const mod: { exports: unknown } = { exports: {} };
  const req = (name: string) => (name === "node:fs" || name === "fs" ? nodeFs : {});
  const runner = new Function(
    "module",
    "exports",
    "require",
    "__dirname",
    "__filename",
    src + "\nreturn module.exports;",
  );
  return runner(mod, mod.exports, req, "/", "/index.js") as EngineFactory;
}

const createChessEngine = loadGlue();
const wasmBinary = b64ToBytes(WASM_B64);

interface DoMoveResult {
  ok: boolean;
  san: string;
  check: boolean;
  checkmate: boolean;
  gameOver: boolean;
  result: number; // 0 ongoing, 1 white, 2 black, 3 draw
  drawReason: number; // 0 none,1 stalemate,2 fifty,3 threefold,4 insufficient
}
interface ChessGame {
  setFen(fen: string): boolean;
  fen(): string;
  doMove(from: number, to: number, promo: string): DoMoveResult;
  legalUci(): string[];
  delete(): void;
}
interface EngineModule {
  ChessGame: new () => ChessGame;
}

const modulePromise: Promise<EngineModule> = createChessEngine({
  // Supply the compiled instance directly; never read the .wasm from disk/fetch.
  instantiateWasm: (
    imports: WebAssembly.Imports,
    successCallback: (instance: WebAssembly.Instance) => void,
  ) => {
    (WebAssembly.instantiate(wasmBinary, imports) as unknown as Promise<{ instance: WebAssembly.Instance }>)
      .then((result) => successCallback(result.instance))
      .catch((e) => {
        // A failed instantiate must not leave modulePromise hanging forever;
        // surface it so validateMove rejects quickly instead of every request
        // timing out.
        console.error("chess engine wasm instantiate failed:", e);
        throw e;
      });
    return {};
  },
});

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

// "e2" -> 52 (row-major, row 0 = black back rank).
function sq(name: string): number {
  return (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);
}

export interface ValidateInput {
  moves: { uci: string }[]; // moves so far, in order
  fen: string; // stored authoritative FEN (cross-check)
  uci: string; // proposed move
}
export type ValidateResult =
  | { ok: false; reason: "illegal_move" | "corrupt_state" | "bad_uci" }
  | {
      ok: true;
      san: string;
      fen: string;
      gameOver: boolean;
      result: string | null; // '1-0' | '0-1' | '1/2-1/2' | '*' | null
      endReason: string | null; // 'checkmate' | 'stalemate' | 'draw' | null
    };

const UCI_RE = /^[a-h][1-8][a-h][1-8][qrbn]?$/;

/** Validate a single move by replaying history from the start position. */
export async function validateMove(input: ValidateInput): Promise<ValidateResult> {
  if (!UCI_RE.test(input.uci)) return { ok: false, reason: "bad_uci" };

  const Module = await modulePromise;
  const game = new Module.ChessGame();
  try {
    // Rebuild the position (and repetition/50-move history) from move 1.
    for (const m of input.moves) {
      const r = game.doMove(sq(m.uci.slice(0, 2)), sq(m.uci.slice(2, 4)), m.uci[4] ?? "");
      if (!r.ok) return { ok: false, reason: "corrupt_state" };
    }
    // Cross-check the replay against the stored FEN — mismatch means the stored
    // state was tampered with or diverged.
    if (game.fen() !== input.fen) return { ok: false, reason: "corrupt_state" };

    // Exact-string legality check on the RAW client uci (legalUci includes the
    // promotion suffix, so a bare promotion like "e7e8" is correctly rejected).
    if (!game.legalUci().includes(input.uci)) return { ok: false, reason: "illegal_move" };

    const r = game.doMove(sq(input.uci.slice(0, 2)), sq(input.uci.slice(2, 4)), input.uci[4] ?? "");
    if (!r.ok) return { ok: false, reason: "illegal_move" };

    let result: string | null = null;
    let endReason: string | null = null;
    if (r.gameOver) {
      if (r.result === 1) { result = "1-0"; endReason = "checkmate"; }
      else if (r.result === 2) { result = "0-1"; endReason = "checkmate"; }
      else { result = "1/2-1/2"; endReason = r.drawReason === 1 ? "stalemate" : "draw"; }
    }
    return { ok: true, san: r.san, fen: game.fen(), gameOver: r.gameOver, result, endReason };
  } finally {
    game.delete(); // embind objects are heap-backed; release per request.
  }
}

export { START_FEN };
