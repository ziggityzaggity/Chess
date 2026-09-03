# PyChess — web frontend

A [Next.js](https://nextjs.org) (App Router + TypeScript + Tailwind) frontend for
the C++ chess core in this repo. The engine is compiled to WebAssembly and driven
entirely client-side; accounts and data live in [Supabase](https://supabase.com)
(auth + Postgres), which the browser talks to directly under row-level security.

The UI follows the `chess_web_app_ui_concepts` design: a light, warm "app shell"
for everything around the game, and an immersive dark board for play itself.

- **Home** (`/`) — landing page ("Play with purpose").
- **Login** (`/login`) / **Register** (`/register`) — real Supabase auth with two
  options: a **one-time code by email** (OTP) and **Continue with Google** (OAuth,
  completed by `/auth/callback`). Registration leads to **Onboarding**
  (`/onboarding`), which saves a nickname (required) and birth date (optional) to
  the user's `profiles` row — then the navbar swaps to a profile avatar with a menu.
- **New game** (`/play`) — choose a mode (bot / pass-and-play) and time control,
  then launch a game.
- **Game** (`/game`) — the live board: click-to-move with legal-move highlighting,
  promotion picker, check/checkmate/draw detection, an interactive PGN move list
  (click any move to jump, first/prev/next/last navigation), clocks, resign / draw,
  board flip, and an optional greedy **bot** opponent (`?mode=bot`). All of this is
  the C++ engine wired in via [`useChessGame`](src/lib/useChessGame.ts).
- **Assistant** (`/assistant`) — chat UI design (a preview; not wired to a model).
- **Settings** (`/settings`) — board theme (Walnut / Stone / Forest, applied live
  via CSS variables) and board toggles, persisted to localStorage.

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
