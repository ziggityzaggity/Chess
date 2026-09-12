// Exercise the browser bot implementations against the shipped WASM engine.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const createChessEngine = require("../public/engine/chessengine.js");
const source = readFileSync(
  new URL("../src/lib/bot.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
  },
});
const { chooseBotMove } = await import(
  `data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`
);
const engine = await createChessEngine();
const square = (name) => (8 - Number(name[1])) * 8 + name.charCodeAt(0) - 97;
const play = (game, uci) =>
  game.doMove(square(uci.slice(0, 2)), square(uci.slice(2, 4)), uci[4] ?? "");
const game = new engine.ChessGame();
const scratch = new engine.ChessGame();

for (const bot of ["random", "greedy", "minimax"]) {
  game.reset();
  for (let ply = 0; ply < 8; ply++) {
    const fen = game.fen();
    const history = game.pgn();
    const move = chooseBotMove(scratch, fen, game.turn(), bot);
    assert.ok(
      game.legalUci().includes(move),
      `${bot}: illegal move at ply ${ply}`,
    );
    assert.equal(game.fen(), fen, `${bot}: changed the live position`);
    assert.equal(game.pgn(), history, `${bot}: changed live history`);
    assert.equal(scratch.fen(), fen, `${bot}: did not unwind simulated moves`);
    assert.ok(play(game, move).ok);
  }
  console.log(
    `${bot}: legal moves for both colours; simulation leaves live state intact`,
  );
}

for (const bot of ["greedy", "minimax"]) {
  for (const fen of [
    "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1",
    "8/8/8/8/8/6k1/5q2/7K b - - 0 1",
  ]) {
    assert.ok(game.setFen(fen));
    const move = chooseBotMove(scratch, fen, game.turn(), bot);
    assert.ok(play(game, move).checkmate, `${bot}: missed mate in one`);
  }
  console.log(`${bot}: takes mate in one as White and Black`);
}

const trap = "3q3k/8/8/3p4/8/8/8/3Q3K w - - 0 1";
assert.equal(chooseBotMove(scratch, trap, 0, "greedy"), "d1d5");
assert.notEqual(chooseBotMove(scratch, trap, 0, "minimax"), "d1d5");
console.log(
  "minimax: avoids a defended pawn that costs its queen; greedy takes the bait",
);

for (const bot of ["random", "greedy", "minimax"]) {
  const promotion = "7k/P7/8/8/8/8/8/7K w - - 0 1";
  game.setFen(promotion);
  assert.ok(
    game.legalUci().includes(chooseBotMove(scratch, promotion, 0, bot)),
  );
  assert.equal(
    chooseBotMove(scratch, "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", 1, bot),
    null,
  );
  assert.equal(
    chooseBotMove(scratch, "7k/8/6K1/8/8/8/8/8 w - - 0 1", 0, bot),
    null,
  );
}
console.log("All bots handle promotions and terminal positions.");
