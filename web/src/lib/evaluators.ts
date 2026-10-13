// evaluators.ts — value networks that judge positions for the Convolutional bot.
//
// A PositionEvaluator turns compact positions into win/draw/loss probabilities
// for the side to move. Today that is OnnxEvaluator: the exported network
// (ai/value_training.py) running in the browser with onnxruntime-web. A model
// served elsewhere (for example on Modal) can implement the same interface by
// sending the compact boards (BOARD_BYTES each) to its endpoint, and the search
// is unchanged.

import type { EngineModule } from "./engine";
import type { LeafEvaluator } from "./search";

export interface PositionEvaluator {
  /** Probabilities [win, draw, loss] for the side to move, 3 per board. */
  evaluate(boards: Uint8Array): Promise<Float32Array>;
}

/** Search values from a network: P(win) - P(loss), i.e. 2 x expected score - 1. */
export function networkLeafEvaluator(evaluator: PositionEvaluator): LeafEvaluator {
  return {
    async values(boards) {
      const p = await evaluator.evaluate(boards);
      const v = new Float32Array(p.length / 3);
      for (let i = 0; i < v.length; i++) v[i] = p[3 * i] - p[3 * i + 2];
      return v;
    },
  };
}

type Ort = typeof import("onnxruntime-web/wasm");

/** Where the onnxruntime-web WebAssembly files are served (scripts/copy-ort.mjs). */
export const ORT_BASE = "/ort/";
const CHUNK = 1024; // boards per inference call

let ortPromise: Promise<Ort> | null = null;

function loadOrt(wasmPaths: string): Promise<Ort> {
  ortPromise ??= import("onnxruntime-web/wasm").then((ort) => {
    ort.env.wasm.wasmPaths = wasmPaths;
    // Threads need a cross-origin-isolated page; otherwise run single-threaded.
    const isolated = typeof crossOriginIsolated !== "undefined" && crossOriginIsolated;
    const cores = typeof navigator !== "undefined" ? navigator.hardwareConcurrency || 1 : 1;
    ort.env.wasm.numThreads = isolated ? Math.min(4, cores) : 1;
    // In the browser, run inference in a worker so the page stays responsive.
    ort.env.wasm.proxy = typeof window !== "undefined" && typeof Worker !== "undefined";
    return ort;
  });
  return ortPromise;
}

export class OnnxEvaluator implements PositionEvaluator {
  private constructor(
    private readonly engine: EngineModule,
    private readonly ort: Ort,
    private readonly session: import("onnxruntime-web/wasm").InferenceSession,
  ) {}

  /** Load a value network from a URL (or the model file's bytes). */
  static async load(
    engine: EngineModule,
    model: string | Uint8Array,
    options: { wasmPaths?: string } = {},
  ): Promise<OnnxEvaluator> {
    const ort = await loadOrt(options.wasmPaths ?? ORT_BASE);
    const session = // (two calls: create() is overloaded on the argument type)
      typeof model === "string"
        ? await ort.InferenceSession.create(model, { executionProviders: ["wasm"] })
        : await ort.InferenceSession.create(model, { executionProviders: ["wasm"] });
    return new OnnxEvaluator(engine, ort, session);
  }

  async evaluate(boards: Uint8Array): Promise<Float32Array> {
    const B = this.engine.BOARD_BYTES;
    const n = boards.length / B;
    const out = new Float32Array(3 * n);
    const [input] = this.session.inputNames;
    const [output] = this.session.outputNames;
    for (let start = 0; start < n; start += CHUNK) {
      const count = Math.min(CHUNK, n - start);
      const planes = this.engine.encodeBoards(boards.subarray(start * B, (start + count) * B));
      const tensor = new this.ort.Tensor("float32", planes, [count, this.engine.NUM_PLANES, 8, 8]);
      const result = await this.session.run({ [input]: tensor });
      const logits = result[output].data as Float32Array;
      for (let i = 0; i < count; i++) {
        // softmax over [win, draw, loss]
        const a = logits[3 * i], b = logits[3 * i + 1], c = logits[3 * i + 2];
        const m = Math.max(a, b, c);
        const ea = Math.exp(a - m), eb = Math.exp(b - m), ec = Math.exp(c - m);
        const s = ea + eb + ec;
        out.set([ea / s, eb / s, ec / s], 3 * (start + i));
      }
      tensor.dispose();
    }
    return out;
  }
}

const loaded = new Map<string, Promise<OnnxEvaluator>>();

/** The evaluator for a model URL, loaded once per page. */
export function onnxEvaluator(engine: EngineModule, url: string): Promise<OnnxEvaluator> {
  let evaluator = loaded.get(url);
  if (!evaluator) {
    evaluator = OnnxEvaluator.load(engine, url);
    evaluator.catch(() => loaded.delete(url)); // allow a retry
    loaded.set(url, evaluator);
  }
  return evaluator;
}
