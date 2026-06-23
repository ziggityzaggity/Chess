// copy-engine.mjs — stages the compiled WASM engine into public/engine.
//
// The chess engine is a C++ core compiled to WebAssembly by the repo-root
// CMake/Emscripten build (see ../bindings/web). Its output lives in
// ../build-web/bindings/web and is treated as a build artifact (git-ignored),
// so we copy the latest build into Next's /public on each dev/build run.
//
// If the engine hasn't been built yet, we warn (with the build command) but
// exit 0 so the dev server still starts — the Play page shows a friendly error.

import { existsSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..", "..");
const srcDir = resolve(repoRoot, "build-web", "bindings", "web");
const destDir = resolve(here, "..", "public", "engine");

const files = ["chessengine.js", "chessengine.wasm"];

const missing = files.filter((f) => !existsSync(resolve(srcDir, f)));
if (missing.length) {
  console.warn(
    "\n[copy-engine] WASM engine not found in build-web/bindings/web.\n" +
      "             Build it from the repo root with Emscripten on PATH:\n\n" +
      "               emcmake cmake -S . -B build-web -G Ninja\n" +
      "               cmake --build build-web\n\n" +
      "             The Play page will show a load error until this is done.\n"
  );
  process.exit(0);
}

mkdirSync(destDir, { recursive: true });
for (const f of files) {
  copyFileSync(resolve(srcDir, f), resolve(destDir, f));
}
console.log("[copy-engine] staged chessengine.js + chessengine.wasm -> public/engine");
