// copy-ort.mjs — stages the onnxruntime-web WebAssembly runtime into public/ort.
//
// The Convolutional bot runs its value network in the browser with
// onnxruntime-web (src/lib/evaluators.ts), which loads these files from /ort/.
// They come from node_modules, so they are copied (and git-ignored) rather
// than committed. Runs before every dev/build, like copy-engine.mjs.

import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(here, "..", "node_modules", "onnxruntime-web", "dist");
const destDir = resolve(here, "..", "public", "ort");
const files = ["ort-wasm-simd-threaded.mjs", "ort-wasm-simd-threaded.wasm"];

const missing = files.filter((f) => !existsSync(resolve(srcDir, f)));
if (missing.length) {
  console.warn(`[copy-ort] onnxruntime-web is not installed (missing ${missing.join(", ")}); run npm install`);
  process.exit(0);
}
mkdirSync(destDir, { recursive: true });
for (const f of files) copyFileSync(resolve(srcDir, f), resolve(destDir, f));
console.log("[copy-ort] staged the onnxruntime-web runtime -> public/ort");
