// The bot opponents: families, their settings, and how a choice travels in the
// game URL (?bot=cnn&size=small&depth=2, plus &server=1 for the large model on
// the move server).

export const BOT_FAMILIES = {
  jester: {
    id: "jester",
    name: "Jester",
    architecture: "Random legal moves",
    description:
      "Picks a legal move at random. No evaluation or lookahead—an unpredictable opponent for practice.",
    hasDepth: false,
  },
  greedy: {
    id: "greedy",
    name: "Greedy",
    architecture: "Material search",
    description:
      "Counts material and checks, and always takes mate in one. With more lookahead it weighs your replies and avoids simple traps.",
    hasDepth: true,
  },
  cnn: {
    id: "cnn",
    name: "Convolutional",
    architecture: "Residual CNN value network",
    description:
      "A neural network trained on 10,000 master games judges each position it reaches. Choose its size and how far it looks ahead.",
    hasDepth: true,
  },
  dqn: {
    id: "dqn",
    name: "Deep Q",
    architecture: "Reinforcement learning from its own games",
    description:
      "Learns by playing games instead of studying master games. Choose its size and how far it looks ahead.",
    hasDepth: true,
  },
} as const;

export type BotFamily = keyof typeof BOT_FAMILIES;
/** The families that play with a trained network, in sizes. */
export type NetworkFamily = "cnn" | "dqn";

export function isNetworkFamily(family: BotFamily): family is NetworkFamily {
  return family === "cnn" || family === "dqn";
}
export type BotDepth = 1 | 2 | 3;
export type ModelSize = "small" | "medium" | "large";

export const DEPTHS: readonly BotDepth[] = [1, 2, 3];
export const MODEL_SIZES: readonly ModelSize[] = ["small", "medium", "large"];
export const MODEL_SIZE_DETAIL: Record<ModelSize, string> = {
  small: "3 layers",
  medium: "6 layers",
  large: "8 layers",
};

/** A fully specified opponent. */
export type BotSpec =
  | { family: "jester" }
  | { family: "greedy"; depth: BotDepth }
  | {
      family: "cnn";
      size: ModelSize;
      depth: BotDepth;
      /** Run on the move server (signed-in players, large model only) instead of in the browser. */
      server?: boolean;
    }
  | { family: "dqn"; size: ModelSize; depth: BotDepth };

/** Model sizes the move server can run. */
export const SERVER_SIZES: readonly ModelSize[] = ["large"];

/** Families a game can be started against (the network families once a model is deployed). */
export function isPlayable(family: BotFamily): boolean {
  return family in BOT_FAMILIES;
}

export const DEFAULT_BOT: BotSpec = { family: "greedy", depth: 1 };

/**
 * The lookahead a bot starts with. Network bots (Convolutional, Deep Q) search
 * two moves, except the large ones: each of their searches costs about 2.5
 * times as much, so they start at one. Greedy starts at one.
 */
export function defaultDepth(family: BotFamily, size?: ModelSize): BotDepth {
  if (!isNetworkFamily(family)) return 1;
  return size === "large" ? 1 : 2;
}

function parseDepth(value: string | null, fallback: BotDepth): BotDepth {
  const n = Number(value);
  return n === 1 || n === 2 || n === 3 ? n : fallback;
}

function parseSize(value: string | null): ModelSize {
  return value === "medium" || value === "large" ? value : "small";
}

/**
 * The bot described by game URL parameters. Earlier URLs still work:
 * bot=random is Jester, bot=greedy without a depth is Greedy at depth 1, and
 * bot=minimax is Greedy at depth 2.
 */
export function parseBotSpec(params: { get(name: string): string | null }): BotSpec {
  const bot = params.get("bot");
  const depth = params.get("depth");
  switch (bot) {
    case "jester":
    case "random":
      return { family: "jester" };
    case "minimax":
      return { family: "greedy", depth: parseDepth(depth, 2) };
    case "cnn": {
      const size = parseSize(params.get("size"));
      const spec: BotSpec = { family: "cnn", size, depth: parseDepth(depth, defaultDepth("cnn", size)) };
      if (params.get("server") === "1" && SERVER_SIZES.includes(size)) spec.server = true;
      return spec;
    }
    case "dqn": {
      const size = parseSize(params.get("size"));
      return { family: "dqn", size, depth: parseDepth(depth, defaultDepth("dqn", size)) };
    }
    default:
      return { family: "greedy", depth: parseDepth(depth, 1) };
  }
}

/** Query-string parameters for a bot (without the leading "?"). */
export function botQuery(spec: BotSpec): string {
  switch (spec.family) {
    case "jester":
      return "bot=jester";
    case "greedy":
      return `bot=greedy&depth=${spec.depth}`;
    case "cnn":
      return `bot=cnn&size=${spec.size}&depth=${spec.depth}${spec.server ? "&server=1" : ""}`;
    case "dqn":
      return `bot=dqn&size=${spec.size}&depth=${spec.depth}`;
  }
}

/** Display name, e.g. "Convolutional (small)". */
export function botName(spec: BotSpec): string {
  const name = BOT_FAMILIES[spec.family].name;
  return isNetworkFamily(spec.family) && "size" in spec ? `${name} (${spec.size})` : name;
}

/** Short description of how it plays, e.g. "Material search · depth 2". */
export function botTagline(spec: BotSpec): string {
  const architecture = BOT_FAMILIES[spec.family].architecture;
  if (spec.family === "jester") return architecture;
  return `${architecture} · depth ${spec.depth}${spec.family === "cnn" && spec.server ? " · on our servers" : ""}`;
}
