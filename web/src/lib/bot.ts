// bot.ts — one entry point for every bot: chooseBotMove(engine, game, bot).
//
// Jester plays a random legal move. Greedy and Convolutional search with
// search.ts, valuing positions by material or by the value network. The live
// game is only read (rootChildren); the search works on compact positions.

import type { ChessGame, EngineModule } from "./engine";
import { botName, type BotSpec } from "./bots";
import { networkLeafEvaluator, onnxEvaluator } from "./evaluators";
import { cnnModel, loadModelManifest, modelUrl } from "./models";
import { materialEvaluator, searchMove, type LeafEvaluator } from "./search";

export interface BotMoveOptions {
  signal?: AbortSignal;
  /** Stop deepening after this long; the deepest completed search decides. */
  timeBudgetMs?: number;
  random?: () => number;
}

/** How long a network bot may think before settling for a shallower search. */
export const NETWORK_TIME_BUDGET_MS = 15_000;

/**
 * Pick a move for the side to move in `game`.
 * Returns a UCI string ("e2e4", "e7e8q"), or null if the game is over.
 */
export async function chooseBotMove(
  engine: EngineModule,
  game: ChessGame,
  bot: BotSpec,
  options: BotMoveOptions = {},
): Promise<string | null> {
  if (game.isGameOver()) return null;
  const random = options.random ?? Math.random;
  if (bot.family === "jester") {
    const moves = game.legalUci();
    return moves.length ? moves[Math.floor(random() * moves.length)] : null;
  }

  let evaluator: LeafEvaluator = materialEvaluator;
  let timeBudgetMs = options.timeBudgetMs;
  if (bot.family === "cnn") {
    const model = cnnModel(await loadModelManifest(), bot.size);
    if (!model) throw new Error(`${botName(bot)} is not available yet: no trained model is deployed.`);
    evaluator = networkLeafEvaluator(await onnxEvaluator(engine, modelUrl(model)));
    timeBudgetMs ??= NETWORK_TIME_BUDGET_MS;
  }
  const result = await searchMove(engine, game, {
    depth: bot.depth,
    evaluator,
    timeBudgetMs,
    signal: options.signal,
    random,
  });
  return result?.move ?? null;
}
