export const BOTS = {
  random: {
    id: "random",
    name: "Wanderer",
    architecture: "Random legal moves",
    description:
      "Picks a legal move at random. No position evaluation or lookahead—an unpredictable opponent for practice.",
  },
  greedy: {
    id: "greedy",
    name: "Collector",
    architecture: "One-ply material evaluation",
    description:
      "Examines each possible move, values material and checks, and takes mate in one. Equal choices are broken at random.",
  },
  minimax: {
    id: "minimax",
    name: "Lookahead",
    architecture: "Two-ply minimax search",
    description:
      "Considers its move and your best reply, then compares material and checks. Looks one reply ahead to avoid simple traps.",
  },
} as const;

export type BotId = keyof typeof BOTS;
export function parseBotId(value: string | null): BotId {
  return value === "random" || value === "minimax" ? value : "greedy";
}
