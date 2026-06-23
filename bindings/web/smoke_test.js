// smoke_test.js — headless validation of the WASM ChessGame interface.
//
// Run after building the web target:
//   node build-web/bindings/web/chessengine.js   # (not directly; see below)
//
//   cd build-web/bindings/web
//   node ../../../bindings/web/smoke_test.js
//
// It loads the emitted chessengine.js factory from the current directory and
// exercises the same behaviours as core/game_demo.cpp, across the JS boundary.

const path = require('path');
const createChessEngine = require(path.resolve(process.cwd(), 'chessengine.js'));

let failures = 0;
function check(cond, label) {
  if (cond) console.log('  ok   ' + label);
  else { console.log('  FAIL ' + label); failures++; }
}

createChessEngine().then((Module) => {
  const g = new Module.ChessGame();

  console.log('[startpos]');
  const start = g.boardString();
  check(start.length === 64, 'board is 64 chars');
  check((start.match(/[^.]/g) || []).length === 32, '32 pieces at start');
  check(g.turn() === 0, 'white to move');

  console.log('[movesFrom highlighting]');
  // e2 = row 6, col 4 -> 6*8+4 = 52
  const e2 = 52;
  const targets = Array.from(g.movesFrom(e2));   // movesFrom returns a JS array
  check(targets.length === 2, 'pawn e2 has 2 targets (e3,e4)');

  console.log("[scholar's mate via doMove]");
  for (const m of ['e2e4','e7e5','f1c4','b8c6','d1h5','g8f6']) {
    const r = g.doMove(sq(m.slice(0,2)), sq(m.slice(2,4)), '');
    check(r.ok, 'play ' + m);
  }
  const mate = g.doMove(sq('h5'), sq('f7'), '');
  check(mate.ok, 'play Qxf7');
  check(mate.san === 'Qxf7#', 'SAN is Qxf7# (got ' + mate.san + ')');
  check(mate.capture === true, 'flagged as capture');
  check(mate.checkmate === true, 'flagged as checkmate');
  check(mate.gameOver === true, 'game over');
  check(mate.result === 1, 'white wins');
  console.log('  PGN: ' + g.pgn());

  console.log('[undo/redo]');
  check(g.undo() === true, 'undo mate');
  check(g.isGameOver() === false, 'no longer over');
  check(g.canRedo() === true, 'can redo');
  check(g.redo() === true, 'redo');
  check(g.isCheckmate() === true, 'checkmate again');

  console.log('[promotion]');
  g.setFen('8/P7/8/8/8/8/8/k6K w - - 0 1');
  check(g.isPromotion(sq('a7'), sq('a8')) === true, 'a7a8 is a promotion');
  const promo = g.doMove(sq('a7'), sq('a8'), 'q');
  check(promo.ok && promo.san === 'a8=Q+', 'promotes to queen with check');

  console.log('\n' + (failures ? 'FAILURES: ' + failures : 'ALL PASS'));
  process.exit(failures ? 1 : 0);

  function sq(name) { return (8 - (name.charCodeAt(1) - 48)) * 8 + (name.charCodeAt(0) - 97); }
});
