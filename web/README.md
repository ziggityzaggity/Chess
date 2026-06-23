# Gambit — web frontend

A [Next.js](https://nextjs.org) (App Router + TypeScript + Tailwind) frontend for
the C++ chess core in this repo. The engine is compiled to WebAssembly and driven
entirely client-side — there is no backend.

- **Home** (`/`) — landing page.
- **Play** (`/play`) — click-to-move board with legal-move highlighting,
  promotion picker, undo/redo, board flip and a live move list.

## How it connects to the engine

The C++ core (`core/`) is exposed to JS through the Emscripten/embind facade in
[`bindings/web/chess_web.cpp`](../bindings/web/chess_web.cpp), which compiles to
`chessengine.js` + `chessengine.wasm`. Those two files are a **build artifact**:
`scripts/copy-engine.mjs` stages the latest build from `../build-web/bindings/web`
into `public/engine/` before every `dev`/`build` (via the `predev`/`prebuild`
npm hooks). [`src/lib/engine.ts`](src/lib/engine.ts) loads the factory in the
browser; [`src/lib/useChessGame.ts`](src/lib/useChessGame.ts) wraps it in a hook.

## Prerequisites

- **Node.js ≥ 20.9** (Next.js 16 requirement; developed on Node 24 LTS).
- The WASM engine built once from the repo root (needs the Emscripten SDK on PATH):

  ```sh
  emcmake cmake -S . -B build-web -G Ninja
  cmake --build build-web
  ```

  If you skip this, the dev server still starts but the Play page shows a
  "build the engine" message.

## Develop

```sh
cd web
npm install
npm run dev        # also stages the engine into public/engine
# open http://localhost:3000
```

## Production build

```sh
npm run build
npm start
```
