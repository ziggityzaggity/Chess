// search.ts — how the Greedy and Convolutional bots choose a move.
//
// Negamax with alpha-beta pruning over compact positions from the WASM engine
// (see engine.ts). Values are always from the point of view of the side to
// move, so a parent's value is the best of its children's values negated.
//
//   * Positions the rules decide need no evaluation: checkmate is worth
//     -(MATE - ply) to the mated side (a nearer mate counts more), and
//     stalemate, insufficient material, the 50-move rule and threefold
//     repetition are draws worth 0.
//   * Every other position at the search horizon is valued by a
//     LeafEvaluator: material for Greedy, the value network for Convolutional.
//     Sibling positions are evaluated in batches (likely refutations first),
//     and the remaining siblings are skipped once a cutoff is proven.
//   * The search deepens one ply at a time (iterative deepening), trying the
//     previous iteration's best moves first so alpha-beta prunes more. A time
//     budget can stop it early; the deepest completed iteration then decides.
//
// A mate in one is always played. Equal moves are chosen between at random.

import type { ChessGame, EngineModule } from "./engine";

export const MATE = 1000;
const ONGOING = 0;
const CHECKMATE = 1;
const LEAF_BATCH = 12; // siblings per evaluator call below the root

/** Values positions at the search horizon. */
export interface LeafEvaluator {
  /**
   * The value of each position for its side to move (bigger is better), in
   * units well below MATE. `boards` holds ongoing positions only; `material`
   * is the engine's material score of each.
   */
  values(boards: Uint8Array, material: Float32Array): Promise<ArrayLike<number>>;
}

/** Greedy: material (pawn 1 … queen 9), less 0.4 when in check. */
export const materialEvaluator: LeafEvaluator = {
  values: async (_boards, material) => material,
};

export interface SearchOptions {
  depth: number; // plies, 1-3 in the app
  evaluator: LeafEvaluator;
  /** Stop deepening after this many milliseconds (depth 1 always completes). */
  timeBudgetMs?: number;
  signal?: AbortSignal;
  random?: () => number;
}

export interface SearchResult {
  move: string; // UCI
  score: number; // for the mover; ±(MATE - n) is a forced mate
  depth: number; // the deepest completed iteration
  evaluated: number; // positions sent to the evaluator
}

class OutOfTime extends Error {}

interface Context {
  engine: EngineModule;
  evaluator: LeafEvaluator;
  B: number; // bytes per compact board
  deadline: number;
  signal?: AbortSignal;
  evaluated: number;
}

function checkTime(ctx: Context) {
  ctx.signal?.throwIfAborted();
  if (performance.now() > ctx.deadline) throw new OutOfTime();
}

function terminalValue(status: number, ply: number): number {
  return status === CHECKMATE ? -(MATE - ply) : 0;
}

/** Values for their side to move of the children [start, end), at `ply`. */
async function childValues(
  ctx: Context,
  boards: Uint8Array,
  status: Uint8Array,
  material: Float32Array,
  start: number,
  end: number,
  ply: number,
): Promise<Float64Array> {
  const { B } = ctx;
  const values = new Float64Array(end - start);
  const live: number[] = [];
  for (let i = start; i < end; i++) {
    if (status[i] === ONGOING) live.push(i);
    else values[i - start] = terminalValue(status[i], ply);
  }
  if (live.length) {
    const rows = new Uint8Array(live.length * B);
    const mat = new Float32Array(live.length);
    live.forEach((r, k) => {
      rows.set(boards.subarray(r * B, (r + 1) * B), k * B);
      mat[k] = material[r];
    });
    const v = await ctx.evaluator.values(rows, mat);
    ctx.evaluated += live.length;
    live.forEach((r, k) => (values[r - start] = v[k]));
  }
  return values;
}

/** Move-ordering key: mates first, then the moves that win the most material. */
function orderKey(status: number, material: number): number {
  if (status === CHECKMATE) return Infinity;
  return status === ONGOING ? -material : 0;
}

/** Negamax value of an ongoing position at `ply`, searched `depth` plies deeper. */
async function negamax(
  ctx: Context,
  board: Uint8Array,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): Promise<number> {
  checkTime(ctx);
  const expansion = ctx.engine.expandBoards(board);
  const n = expansion.status.length;
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (a, b) =>
      orderKey(expansion.status[b], expansion.material[b]) - orderKey(expansion.status[a], expansion.material[a]),
  );
  const { B } = ctx;
  // Reorder the children so that the most promising come first.
  const boards = new Uint8Array(n * B);
  const status = new Uint8Array(n);
  const material = new Float32Array(n);
  order.forEach((i, k) => {
    boards.set(expansion.boards.subarray(i * B, (i + 1) * B), k * B);
    status[k] = expansion.status[i];
    material[k] = expansion.material[i];
  });
  let best = -Infinity;
  if (depth === 1) {
    for (let start = 0; start < n && best < beta; start += LEAF_BATCH) {
      const end = Math.min(n, start + LEAF_BATCH);
      const values = await childValues(ctx, boards, status, material, start, end, ply + 1);
      for (const v of values) best = Math.max(best, -v);
    }
    return best;
  }
  for (let i = 0; i < n; i++) {
    const v =
      status[i] === ONGOING
        ? -(await negamax(ctx, boards.subarray(i * B, (i + 1) * B), depth - 1, -beta, -alpha, ply + 1))
        : -terminalValue(status[i], ply + 1);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

/** The move `game`'s side to move should play, or null if it has none. */
export async function searchMove(
  engine: EngineModule,
  game: ChessGame,
  options: SearchOptions,
): Promise<SearchResult | null> {
  const random = options.random ?? Math.random;
  const ctx: Context = {
    engine,
    evaluator: options.evaluator,
    B: engine.BOARD_BYTES,
    deadline: performance.now() + (options.timeBudgetMs ?? Infinity),
    signal: options.signal,
    evaluated: 0,
  };
  const root = game.rootChildren();
  const n = root.moves.length;
  if (n === 0) return null;
  for (let i = 0; i < n; i++) {
    if (root.status[i] === CHECKMATE)
      return { move: root.moves[i], score: MATE - 1, depth: 1, evaluated: 0 };
  }
  // Moves the rules decide (draws) keep a fixed value at every depth.
  const fixed = (i: number) => root.status[i] !== ONGOING || root.repetition[i] === 1;

  // Shuffle, then order by the heuristic: equal moves stay in random order,
  // and the first of several equally good moves is the one played.
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  order.sort((a, b) => orderKey(root.status[b], root.material[b]) - orderKey(root.status[a], root.material[a]));

  // Depth 1: every move, one batch.
  ctx.signal?.throwIfAborted();
  const values = await childValues(ctx, root.boards, root.status, root.material, 0, n, 1);
  let scores = Float64Array.from(values, (v, i) => (fixed(i) ? 0 : -v));
  let completed = 1;

  for (let depth = 2; depth <= options.depth; depth++) {
    order.sort((a, b) => scores[b] - scores[a]); // stable: ties keep their order
    const next = new Float64Array(n).fill(-Infinity);
    let alpha = -Infinity;
    try {
      for (const i of order) {
        const v = fixed(i)
          ? 0
          : -(await negamax(ctx, root.boards.subarray(i * ctx.B, (i + 1) * ctx.B), depth - 1, -Infinity, -alpha, 1));
        next[i] = v;
        if (v > alpha) alpha = v;
      }
    } catch (err) {
      if (err instanceof OutOfTime) break;
      throw err;
    }
    scores = next;
    completed = depth;
  }

  let best = order[0];
  for (const i of order) if (scores[i] > scores[best]) best = i;
  return { move: root.moves[best], score: scores[best], depth: completed, evaluated: ctx.evaluated };
}
