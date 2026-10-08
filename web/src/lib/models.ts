// models.ts — which trained networks are deployed.
//
// public/models/manifest.json lists them; the notebook ai/chess_value_network.ipynb
// writes it next to the exported .onnx files. A model is deployed by copying its
// file and the manifest into public/models/. The app offers exactly the models
// listed (with an encoding it understands), so an empty list means the
// Convolutional bot is unavailable.

import type { ModelSize } from "./bots";

/** The network input this app produces (core/encode.hpp, via encodeBoards). */
export const ENCODING = "pychess-19plane-stm-v1";
export const MODEL_BASE = "/models";

export interface ModelEntry {
  id: string; // "cnn-small"
  family: string; // "convolutional"
  size: ModelSize;
  file: string; // relative to MODEL_BASE
  encoding: string;
  blocks?: number;
  channels?: number;
  parameters?: number;
  [key: string]: unknown; // metrics and provenance from the notebook
}

export interface ModelManifest {
  version: number;
  encoding?: string;
  models: ModelEntry[];
}

const EMPTY: ModelManifest = { version: 1, encoding: ENCODING, models: [] };
let manifestPromise: Promise<ModelManifest> | null = null;

/** The deployed-model manifest (empty if it is missing or unreadable). */
export function loadModelManifest(): Promise<ModelManifest> {
  manifestPromise ??= fetch(`${MODEL_BASE}/manifest.json`, { cache: "no-cache" })
    .then((r) => (r.ok ? (r.json() as Promise<ModelManifest>) : EMPTY))
    .then((m) => (Array.isArray(m?.models) ? m : EMPTY))
    .catch(() => {
      manifestPromise = null;
      return EMPTY;
    });
  return manifestPromise;
}

/** The deployed convolutional model of a size, if any. */
export function cnnModel(manifest: ModelManifest, size: ModelSize): ModelEntry | undefined {
  return manifest.models.find(
    (m) => m.family === "convolutional" && m.size === size && m.encoding === ENCODING,
  );
}

export function modelUrl(model: ModelEntry): string {
  return `${MODEL_BASE}/${model.file}`;
}
