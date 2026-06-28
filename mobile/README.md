# Gambit — mobile (Expo / React Native)

iOS + Android client for the C++ chess engine. The board UI is native React
Native; the engine is the repo's header-only C++ core, bound via **JSI / Nitro
Modules** (`react-native-chess-engine`, see `../bindings/react-native`). No WASM,
no server — the C++ runs in-process at native speed.

- `src/PlayScreen.tsx` — board screen (status, controls, move list, promotion).
- `src/components/Board.tsx` — the 8×8 board (`Pressable` squares, highlights, dots).
- `src/useChessGame.ts` — game state hook (same logic as the web app).
- `src/engine.ts` — wraps the native `createChessEngine()`.

## Status

- ✅ TypeScript type-checks (`npx tsc --noEmit`).
- ⚠️ Needs a **native development build** — it will **not** run in Expo Go
  (custom C++). On Windows, use **EAS Build** (cloud) to produce iOS/Android
  builds.

## Run

See the full runbook (codegen → prebuild → run / EAS) in
[`../bindings/react-native/README.md`](../bindings/react-native/README.md).

Quick version once a dev build is installed on a device/simulator:

```sh
npm install
npx expo start --dev-client
```

> Plain `npx expo start` (Expo Go) loads the UI but the engine shows a
> "native engine not loaded" message, because Expo Go can't load native C++.

## Optional: Tailwind-style classes

This app uses plain `StyleSheet` to keep the config verifiable on any machine.
To share the web app's Tailwind classes instead, add
[NativeWind](https://www.nativewind.dev) (`nativewind` + a `tailwind.config.js`
+ Babel/Metro config) — left out here to avoid build config that couldn't be
tested on Windows.
