# React Native binding (C++ via JSI / Nitro Modules)

Exposes the header-only C++ chess core (`core/chess.hpp` + `core/game.hpp`) to
React Native through **JSI** using [Nitro Modules](https://nitro.margelo.com).
This is the *same* `chess::Game` that compiles to WebAssembly for the web
frontend — on mobile we skip WASM entirely (Hermes can't run it) and compile the
C++ straight into the app, so the engine runs at native speed.

```
src/ChessEngine.nitro.ts   TypeScript spec  → nitrogen generates the JSI glue
src/index.ts               createChessEngine() accessor
cpp/HybridChessEngine.hpp  C++ implementation, delegates to chess::Game
nitro.json                 module config (cxx namespace, autolinking)
react-native-chess-engine.podspec   iOS build  (TEMPLATE)
android/build.gradle, CMakeLists.txt Android build (TEMPLATE)
```

The JS API mirrors the web binding (`bindings/web/chess_web.cpp`): `reset`,
`boardString`, `turn`, `movesFrom`, `isPromotion`, `doMove`, `undo`/`redo`,
`pgn`, etc. Squares are `0..63`, row-major, row 0 = top.

---

## ⚠️ You cannot build this on Windows-only

A native C++ module needs a real native toolchain:

| Target | Requires |
|---|---|
| **iOS** | **macOS + Xcode** (no exceptions) — *or* **EAS Build** (cloud macOS, see below) |
| **Android** | JDK 17, Android Studio, the **NDK**, and `ANDROID_HOME` set |

This repo was scaffolded on Windows, where the TypeScript was type-checked but
the native side was **not** compiled. The fastest way to get builds from a
Windows machine is **EAS Build**, which compiles both platforms in Expo's cloud.

---

## Build & run

### 0. Codegen (always run after changing the `.nitro.ts` spec)
The codegen tool version must match the `react-native-nitro-modules` runtime
version installed in `mobile/`. From this folder:

```sh
npm i -D nitro-codegen@<matching-version>
npm run codegen          # writes nitrogen/generated/
```

This generates `HybridChessEngineSpec` (the base class `cpp/HybridChessEngine.hpp`
implements) and the `MoveResult` struct, plus the iOS `+autolinking.rb` and
Android `+autolinking.cmake` the podspec / CMakeLists reference.

### 1. Generate native projects (Expo prebuild)
Custom native code means a **development build**, not Expo Go. From `mobile/`:

```sh
npx expo prebuild            # creates mobile/ios and mobile/android
```

### 2a. Local build (needs the native toolchain)
```sh
cd mobile
npx expo run:ios             # macOS only
npx expo run:android         # needs JDK + NDK + ANDROID_HOME
```

### 2b. Cloud build with EAS (works from Windows)
```sh
npm i -g eas-cli
eas login
cd mobile
eas build --profile development --platform ios       # builds on cloud macOS
eas build --profile development --platform android
```
Install the resulting dev-client build on a device/simulator, then
`npx expo start --dev-client`.

---

## Wiring the engine into the native build

The engine is header-only, so there is nothing to compile from `core/` — the
native build just needs it on the **include path**. That's already done:

- **iOS** — `react-native-chess-engine.podspec` adds `../../core` to
  `HEADER_SEARCH_PATHS`.
- **Android** — `android/CMakeLists.txt` adds `../../../core` to
  `target_include_directories`.

Both the podspec and the gradle/CMake files are **templates** following Nitro's
standard module layout; confirm them against the Nitro version you install (the
generated `nitrogen/` files are the source of truth for the rest).

---

## Verified vs. not

- ✅ **TypeScript** (spec + `createChessEngine`) type-checks against the real
  `react-native-nitro-modules` types, and the `mobile/` app type-checks.
- ❌ **Native compile + on-device run** were not done here (Windows). Do step 2
  on a Mac / with the Android NDK, or via EAS.
