// The browser bots against the shipped WASM engine (public/engine), in Node.
//
// The Convolutional bot is tested with an untrained network
// (fixtures/tiny_value_net.onnx, see fixtures/make_tiny_value_net.py): its
// outputs and the WASM encoding must match what PyTorch and the Python
// package computed for the same positions.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { chooseBotMove } from "../src/lib/bot";
import { botQuery, parseBotSpec, type BotSpec } from "../src/lib/bots";
import type { ChessGame, EngineModule } from "../src/lib/engine";
import { networkLeafEvaluator, OnnxEvaluator } from "../src/lib/evaluators";
import { cnnModel, ENCODING } from "../src/lib/models";
import { MATE, materialEvaluator, searchMove, type LeafEvaluator } from "../src/lib/search";

const require = createRequire(import.meta.url);
const fixtures = resolve(__dirname, "fixtures");

let engine: EngineModule;
let game: ChessGame;

beforeAll(async () => {
  const create = require("../public/engine/chessengine.js") as () => Promise<EngineModule>;
  engine = await create();
  game = new engine.ChessGame();
});

const square = (name: string) => (8 - Number(name[1])) * 8 + name.charCodeAt(0) - 97;
const play = (g: ChessGame, uci: string) =>
  g.doMove(square(uci.slice(0, 2)), square(uci.slice(2, 4)), uci[4] ?? "");

function seeded(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/** Plain negamax without pruning: the reference for the search's scores. */
function bruteForce(board: Uint8Array, depth: number, ply: number): number {
  const { boards, status, material } = engine.expandBoards(board);
  const B = engine.BOARD_BYTES;
  let best = -Infinity;
  for (let i = 0; i < status.length; i++) {
    let v: number;
    if (status[i] === 1) v = -(MATE - (ply + 1));
    else if (status[i] !== 0) v = 0;
    else if (depth === 1) v = material[i];
    else v = bruteForce(boards.subarray(i * B, (i + 1) * B), depth - 1, ply + 1);
    best = Math.max(best, -v);
  }
  return best;
}

const GREEDY: BotSpec[] = [1, 2, 3].map((depth) => ({ family: "greedy", depth }) as BotSpec);

describe("every bot", () => {
  it.each<BotSpec>([{ family: "jester" }, ...GREEDY])(
    "%o plays legal moves for both colours and leaves the live game untouched",
    async (bot) => {
      game.reset();
      for (let ply = 0; ply < 6; ply++) {
        const fen = game.fen();
        const history = game.pgn();
        const move = await chooseBotMove(engine, game, bot, { random: seeded(ply) });
        expect(game.legalUci()).toContain(move);
        expect(game.fen()).toBe(fen);
        expect(game.pgn()).toBe(history);
        expect(play(game, move!).ok).toBe(true);
      }
    },
  );

  it.each<BotSpec>([{ family: "jester" }, ...GREEDY])("%o handles promotions and finished games", async (bot) => {
    game.setFen("7k/P7/8/8/8/8/8/7K w - - 0 1");
    expect(game.legalUci()).toContain(await chooseBotMove(engine, game, bot));
    game.setFen("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"); // checkmated
    expect(await chooseBotMove(engine, game, bot)).toBeNull();
    game.setFen("7k/8/6K1/8/8/8/8/8 w - - 0 1"); // insufficient material
    expect(await chooseBotMove(engine, game, bot)).toBeNull();
  });
});

describe("Greedy", () => {
  it.each(GREEDY)("%o takes mate in one as White and Black", async (bot) => {
    for (const fen of ["7k/5Q2/6K1/8/8/8/8/8 w - - 0 1", "8/8/8/8/8/6k1/5q2/7K b - - 0 1"]) {
      game.setFen(fen);
      expect(play(game, (await chooseBotMove(engine, game, bot))!).checkmate).toBe(true);
    }
  });

  it("takes a defended pawn with its queen at depth 1, and not with lookahead", async () => {
    game.setFen("3q3k/8/8/3p4/8/8/8/3Q3K w - - 0 1");
    expect(await chooseBotMove(engine, game, { family: "greedy", depth: 1 })).toBe("d1d5");
    expect(await chooseBotMove(engine, game, { family: "greedy", depth: 2 })).not.toBe("d1d5");
  });

  it("finds a mate in two at depth 3", async () => {
    game.setFen("3R4/5K1k/8/8/8/8/8/8 w - - 0 1");
    const result = await searchMove(engine, game, { depth: 3, evaluator: materialEvaluator });
    expect(result!.score).toBe(MATE - 3);
    expect(result!.depth).toBe(3);
  });

  it.each([2, 3])("alpha-beta at depth %i scores like a full negamax", async (depth) => {
    const fens = [
      "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
      "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
      "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    ];
    for (const fen of fens) {
      game.setFen(fen);
      const result = await searchMove(engine, game, { depth, evaluator: materialEvaluator });
      expect(result!.score).toBeCloseTo(bruteForce(game.compactBoard(), depth, 0), 5);
    }
  });

  it("sees a threefold repetition coming at the root", async () => {
    game.setFen("7k/8/8/8/8/8/8/R6K w - - 0 1");
    for (const uci of ["a1a2", "h8g8", "a2a1", "g8h8", "a1a2", "h8g8", "a2a1"]) expect(play(game, uci).ok).toBe(true);
    const root = game.rootChildren();
    expect(root.moves.filter((_, i) => root.repetition[i])).toEqual(["g8h8"]); // the third time
  });

  it("stops deepening when out of time", async () => {
    game.reset();
    const slow: LeafEvaluator = {
      async values(_boards, material) {
        const until = performance.now() + 2;
        while (performance.now() < until);
        return material;
      },
    };
    const result = await searchMove(engine, game, { depth: 3, evaluator: slow, timeBudgetMs: 30 });
    expect(result!.depth).toBeLessThan(3);
    expect(game.legalUci()).toContain(result!.move);
  });

  it("can be cancelled", async () => {
    game.reset();
    const controller = new AbortController();
    controller.abort();
    await expect(
      chooseBotMove(engine, game, { family: "greedy", depth: 3 }, { signal: controller.signal }),
    ).rejects.toThrow();
  });
});

describe("Convolutional (value network in onnxruntime-web)", () => {
  const expected = JSON.parse(readFileSync(resolve(fixtures, "tiny_value_net.expected.json"), "utf8")) as {
    fens: string[];
    probs: number[][];
    planes_nonzero: [number, number][][];
  };
  let evaluator: OnnxEvaluator;

  beforeAll(async () => {
    evaluator = await OnnxEvaluator.load(engine, readFileSync(resolve(fixtures, "tiny_value_net.onnx")), {
      wasmPaths: resolve(__dirname, "../node_modules/onnxruntime-web/dist") + "/",
    });
  });

  function boardsOf(fens: string[]) {
    const B = engine.BOARD_BYTES;
    const boards = new Uint8Array(fens.length * B);
    fens.forEach((fen, k) => {
      expect(game.setFen(fen)).toBe(true);
      boards.set(game.compactBoard(), k * B);
    });
    return boards;
  }

  it("encodes positions exactly like the Python package", () => {
    const planes = engine.encodeBoards(boardsOf(expected.fens));
    const per = engine.NUM_PLANES * 64;
    expected.fens.forEach((_, k) => {
      const row = planes.subarray(k * per, (k + 1) * per);
      const nonzero = Array.from(row.entries()).filter(([, v]) => v !== 0);
      expect(nonzero.map(([i]) => i)).toEqual(expected.planes_nonzero[k].map(([i]) => i));
      nonzero.forEach(([, v], j) => expect(v).toBeCloseTo(expected.planes_nonzero[k][j][1], 6));
    });
  });

  it("gives the same probabilities as PyTorch", async () => {
    const probs = await evaluator.evaluate(boardsOf(expected.fens));
    expected.probs.flat().forEach((p, i) => expect(probs[i]).toBeCloseTo(p, 4));
  });

  it.each([1, 2])("plays legal moves at depth %i", async (depth) => {
    game.setFen("rn1q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1BP2/PPPQ2PP/2KR1B1R b - - 4 10");
    const result = await searchMove(engine, game, { depth, evaluator: networkLeafEvaluator(evaluator) });
    expect(game.legalUci()).toContain(result!.move);
    expect(result!.evaluated).toBeGreaterThan(0);
  });

  it("always takes mate in one", async () => {
    game.setFen("r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4");
    const result = await searchMove(engine, game, { depth: 1, evaluator: networkLeafEvaluator(evaluator) });
    expect(result!.move).toBe("h5f7");
  });
});

describe("bot settings", () => {
  const params = (query: string) => new URLSearchParams(query);

  it("parses current and earlier game URLs", () => {
    expect(parseBotSpec(params("bot=jester"))).toEqual({ family: "jester" });
    expect(parseBotSpec(params("bot=random"))).toEqual({ family: "jester" });
    expect(parseBotSpec(params("bot=greedy"))).toEqual({ family: "greedy", depth: 1 });
    expect(parseBotSpec(params("bot=minimax"))).toEqual({ family: "greedy", depth: 2 });
    expect(parseBotSpec(params("bot=greedy&depth=3"))).toEqual({ family: "greedy", depth: 3 });
    expect(parseBotSpec(params("bot=cnn&size=large&depth=2"))).toEqual({ family: "cnn", size: "large", depth: 2 });
    expect(parseBotSpec(params("bot=cnn&size=huge&depth=9"))).toEqual({ family: "cnn", size: "small", depth: 1 });
    expect(parseBotSpec(params(""))).toEqual({ family: "greedy", depth: 1 });
  });

  it("round-trips through the URL", () => {
    const specs: BotSpec[] = [{ family: "jester" }, ...GREEDY, { family: "cnn", size: "medium", depth: 3 }];
    for (const spec of specs) expect(parseBotSpec(params(botQuery(spec)))).toEqual(spec);
  });

  it("offers only deployed models with the app's encoding", () => {
    const manifest = {
      version: 1,
      models: [
        { id: "cnn-small", family: "convolutional", size: "small" as const, file: "s.onnx", encoding: ENCODING },
        { id: "cnn-large", family: "convolutional", size: "large" as const, file: "l.onnx", encoding: "other-v9" },
      ],
    };
    expect(cnnModel(manifest, "small")?.file).toBe("s.onnx");
    expect(cnnModel(manifest, "medium")).toBeUndefined();
    expect(cnnModel(manifest, "large")).toBeUndefined();
  });

  it("ships with no models deployed", () => {
    const shipped = JSON.parse(readFileSync(resolve(__dirname, "../public/models/manifest.json"), "utf8"));
    expect(shipped).toEqual({ version: 1, encoding: ENCODING, models: [] });
  });
});
