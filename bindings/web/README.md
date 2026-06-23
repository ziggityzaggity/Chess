# Web (WebAssembly) binding

`chess_web.cpp` exposes a thin, GUI-oriented facade (`ChessGame`) over
`chess::Game` via Emscripten/embind. `index.html` is a self-contained,
responsive demo board that drives it (click to move, legal-move highlighting,
promotion picker, undo/redo, flip, PGN move list).

## JS API (class `ChessGame`)

| Method | Returns | Purpose |
|---|---|---|
| `reset()` | – | New game from the start position |
| `setFen(fen)` / `fen()` | bool / string | Load / export a position |
| `boardString()` | 64-char string | Render snapshot (`.`=empty, `PNBRQK`/`pnbrqk`) |
| `turn()` | 0 \| 1 | Side to move (white/black) |
| `inCheck()` / `kingSquare(c)` | bool / 0–63 | Check indicator |
| `movesFrom(sq)` | int[] | Legal target squares (for highlighting) |
| `isPromotion(from,to)` | bool | Whether to show a promotion picker |
| `doMove(from,to,promo)` | object | Play; returns `{ok,san,capture,castle,promotion,enpassant,check,checkmate,gameOver,result,drawReason,board}` |
| `undo()` / `redo()` / `canUndo()` / `canRedo()` | bool | History navigation |
| `lastMoveUci()` | string | Last move, for highlighting |
| `isGameOver()` / `result()` / `drawReason()` | bool / int / int | Outcome |
| `pgn()` | string | Move list (SAN) |
| `legalUci()` | string[] | All legal moves (AI hook / debugging) |

Squares are `0..63`, row-major, row 0 = top (black's back rank).

## Build

Requires the Emscripten SDK on PATH (`emcc`/`em++`). From the repo root:

```sh
emcmake cmake -S . -B build-web -G Ninja
cmake --build build-web
```

This produces `build-web/bindings/web/chessengine.js`, `chessengine.wasm`, and a
copy of `index.html` beside them.

## Run

Serve over HTTP (browsers won't fetch `.wasm` from `file://`):

```sh
cd build-web/bindings/web
python -m http.server 8000
# open http://localhost:8000/
```
