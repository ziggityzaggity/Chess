// models.ts — which trained networks are deployed.
//
// public/models/manifest.json lists them; the notebooks (ai/chess_value_network.ipynb,
// ai/deep_q_network.ipynb) write it next to the exported .onnx files. A model is
// deployed by copying its file and the manifest into public/models/. The app
// offers exactly the models listed (with an encoding it understands), so a
// family with no listed model is unavailable ("Still training…").

import type { ModelSize, NetworkFamily } from "./bots";

/** The network inputs this app produces (core/encode.hpp, via encodeBoardsPlanes). */
export const ENCODING = "pychess-19plane-stm-v1";
/** The same 19 planes plus 4 heuristic planes (attacks, pieces in danger): the Deep Q models. */
export const HEURISTIC_ENCODING = "pychess-23plane-stm-v1";
const PLANES: Record<string, number> = { [ENCODING]: 19, [HEURISTIC_ENCODING]: 23 };
/** The manifest's name for each bot family with a network. */
const MANIFEST_FAMILY: Record<NetworkFamily, string> = { cnn: "convolutional", dqn: "deep-q" };
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

/** The deployed model of a bot family and size, if any (with an encoding this app produces). */
export function networkModel(
  manifest: ModelManifest,
  family: NetworkFamily,
  size: ModelSize,
): ModelEntry | undefined {
  return manifest.models.find(
    (m) => m.family === MANIFEST_FAMILY[family] && m.size === size && m.encoding in PLANES,
  );
}

/** The deployed convolutional model of a size, if any. */
export function cnnModel(manifest: ModelManifest, size: ModelSize): ModelEntry | undefined {
  return networkModel(manifest, "cnn", size);
}

/** Input planes a model expects: 19, or 23 for the heuristic encoding. */
export function modelPlanes(model: ModelEntry): number {
  return PLANES[model.encoding] ?? 19;
}

export function modelUrl(model: ModelEntry): string {
  return `${MODEL_BASE}/${model.file}`;
}
