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
`chessengine.js` + `chessengine.wasm`. [`src/lib/engine.ts`](src/lib/engine.ts)
loads the factory in the browser; [`src/lib/useChessGame.ts`](src/lib/useChessGame.ts)
wraps it in a hook.

Those two files are **committed** under `public/engine/`, so a hosting build
(Vercel) needs no C++/Emscripten toolchain and stays fast. Keeping them in sync
with the C++ source is automated:

- **CI** — [`.github/workflows/engine.yml`](../.github/workflows/engine.yml)
  rebuilds the engine whenever `core/**` or `bindings/web/**` changes on `main`.
  It runs the native correctness gate (`perft` + `game_demo`) and a WASM smoke
  test, then commits the rebuilt `public/engine/*` back — which triggers Vercel's
  auto-deploy. A broken engine never gets committed over the last-good one.
- **Local** — if you have the Emscripten SDK and build the engine yourself (see
  below), `scripts/copy-engine.mjs` stages your fresh build from
  `../build-web/bindings/web` into `public/engine/` on every `dev`/`build` (via
  the `predev`/`prebuild` hooks). With no local build it keeps the committed one.

## Prerequisites

- **Node.js ≥ 20.9** (Next.js 16 requirement; developed on Node 24 LTS).
- No toolchain needed to run the app — the engine ships committed. To rebuild it
  locally you need the Emscripten SDK on PATH, then from the repo root:

  ```sh
  emcmake cmake -S . -B build-web -DCMAKE_BUILD_TYPE=Release
  cmake --build build-web
  ```

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

## Tests

`tests/auth-flows.test.ts` ([Vitest](https://vitest.dev)) confirms the login and
registration flows against the real Supabase project:

- **Google** — the provider is enabled and `signInWithOAuth` builds an
  authorization URL that redirects to Google's consent screen with a configured
  client id and returns through `/auth/callback`.
- **Email one-time code** — a new email registers into a signed-in session with
  an auto-provisioned `profiles` row, a returning user logs in with a fresh
  code, onboarding writes the profile under RLS (and a cross-user write is
  blocked), and an unknown email is rejected on login rather than silently
  creating an account.

```sh
npm test          # Google + config checks (public keys from .env.test)
```

The email-OTP tests create and delete a throwaway user, so they need the
service-role key and are **skipped** without it. To run the full suite, provide
it in the environment (never commit it — Supabase dashboard → Project Settings →
API → `service_role`):

```sh
# PowerShell
$env:SUPABASE_SERVICE_ROLE_KEY = "<service_role key>"; npm test
# bash
SUPABASE_SERVICE_ROLE_KEY="<service_role key>" npm test
```

CI runs the same suite on every `web/**` change
([`.github/workflows/web-tests.yml`](../.github/workflows/web-tests.yml)); add a
`SUPABASE_SERVICE_ROLE_KEY` repository secret to include the email-OTP tests
there too.
