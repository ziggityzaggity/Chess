// engine-smoke.mjs — loads the freshly built WASM engine and asserts a few
// user-visible invariants before CI commits it. Runs under Node in the engine
// build workflow. Exits non-zero (failing the build) if anything is wrong, so a
// broken engine can never be committed over the last-good one.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const enginePath = resolve(here, "../../web/public/engine/chessengine.js");
const createChessEngine = require(enginePath);

const sq = (name) => (8 - Number(name[1])) * 8 + (name.charCodeAt(0) - 97);

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? "ok  " : "FAIL"} ${label}`);
  if (!cond) failures++;
}

const Module = await createChessEngine();

// 1. Castling moves the king (and the rook), both sides.
{
  const g = new Module.ChessGame();
  g.setFen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1");
  const r = g.doMove(sq("e1"), sq("g1"), "");
  const b = g.boardString();
  check("white O-O is legal and named O-O", r.ok && r.san === "O-O");
  check("white O-O puts the king on g1", b[sq("g1")] === "K");
  check("white O-O puts the rook on f1", b[sq("f1")] === "R");
  check("white O-O vacates e1", b[sq("e1")] === ".");
}
{
  const g = new Module.ChessGame();
  g.setFen("r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1");
  const r = g.doMove(sq("e8"), sq("c8"), "");
  const b = g.boardString();
  check("black O-O-O puts the king on c8", r.ok && b[sq("c8")] === "k");
  check("black O-O-O puts the rook on d8", b[sq("d8")] === "r");
}

// 2. Insufficient-material rule: KBN vs K is a WIN, not a draw.
{
  const g = new Module.ChessGame();
  g.setFen("8/8/8/4k3/8/8/8/2NBK3 w - - 0 1");
  check("KBN vs K is not a draw by material", !g.isGameOver());
  const g2 = new Module.ChessGame();
  g2.setFen("8/8/8/4k3/8/8/8/3NK3 w - - 0 1");
  check("KN vs K is a draw by material", g2.drawReason() === 4);
}

if (failures) {
  console.error(`\n${failures} smoke check(s) failed — refusing to ship engine.`);
  process.exit(1);
}
console.log("\nAll engine smoke checks passed.");
