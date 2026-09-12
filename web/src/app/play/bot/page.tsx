"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { KnightMark } from "@/components/Logo";
import { BOTS, type BotId } from "@/lib/bots";

const COLOURS = [
  { id: "white", name: "White", detail: "You move first", symbol: "○" },
  { id: "random", name: "Random", detail: "Leave it to chance", symbol: "◐" },
  { id: "black", name: "Black", detail: "The bot moves first", symbol: "●" },
] as const;
type Colour = (typeof COLOURS)[number]["id"];

export default function BotSetupPage() {
  const router = useRouter();
  const [colour, setColour] = useState<Colour>("white");
  const [botId, setBotId] = useState<BotId>("greedy");

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/play"
        className="text-sm font-semibold text-muted hover:text-ink"
      >
        ← Back to play
      </Link>
      <h1 className="mt-8 text-4xl font-black tracking-tight text-ink sm:text-5xl">
        Choose your opponent
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted">
        Try to beat one of our bots. Every game is untimed, so take your time.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const playerColour =
            colour === "random"
              ? crypto.getRandomValues(new Uint8Array(1))[0] % 2 === 0
                ? "white"
                : "black"
              : colour;
          router.push(`/game?mode=bot&bot=${botId}&colour=${playerColour}`);
        }}
      >
        <fieldset className="mt-8">
          <legend className="text-sm font-bold text-ink">Your colour</legend>
          <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
            {COLOURS.map((choice) => (
              <label
                key={choice.id}
                className="relative min-w-0 cursor-pointer"
              >
                <input
                  type="radio"
                  name="colour"
                  value={choice.id}
                  checked={colour === choice.id}
                  onChange={() => setColour(choice.id)}
                  aria-label={choice.name}
                  className="peer sr-only"
                />
                <span className="flex h-full flex-col items-center rounded-2xl border border-line bg-surface px-2 py-4 text-center transition hover:border-gold peer-checked:border-gold peer-checked:ring-1 peer-checked:ring-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold sm:px-4">
                  <span
                    aria-hidden="true"
                    className="text-3xl leading-none text-ink"
                  >
                    {choice.symbol}
                  </span>
                  <span className="mt-3 text-sm font-bold text-ink">
                    {choice.name}
                  </span>
                  <span className="mt-1 text-xs leading-relaxed text-muted">
                    {choice.detail}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="mt-8">
          <legend className="text-sm font-bold text-ink">Choose a bot</legend>
          <div className="mt-3 space-y-3">
            {Object.values(BOTS).map((bot) => (
              <label key={bot.id} className="relative block cursor-pointer">
                <input
                  type="radio"
                  name="bot"
                  value={bot.id}
                  checked={botId === bot.id}
                  onChange={() => setBotId(bot.id)}
                  aria-label={bot.name}
                  aria-describedby={`bot-${bot.id}-description`}
                  className="peer sr-only"
                />
                <span className="flex gap-4 rounded-2xl border border-line bg-surface p-5 transition hover:border-gold peer-checked:border-gold peer-checked:ring-1 peer-checked:ring-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold sm:p-6">
                  <span
                    aria-hidden="true"
                    className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/10 sm:grid"
                  >
                    <KnightMark className="h-7 w-7 text-gold" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-lg font-bold text-ink">
                        {bot.name}
                      </span>
                      <span
                        aria-hidden="true"
                        className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs ${botId === bot.id ? "border-gold bg-gold text-on-accent" : "border-line"}`}
                      >
                        {botId === bot.id ? "✓" : ""}
                      </span>
                    </span>
                    <span className="mt-1 block text-xs font-semibold text-gold-600">
                      {bot.architecture}
                    </span>
                    <span
                      id={`bot-${bot.id}-description`}
                      className="mt-2 block text-sm leading-relaxed text-muted"
                    >
                      {bot.description}
                    </span>
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-8 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            <span aria-hidden="true" className="mr-2 text-lg">
              ∞
            </span>
            No time limit
          </p>
          <button
            type="submit"
            className="rounded-full bg-ink px-7 py-3 text-sm font-bold text-paper transition hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          >
            Play against {BOTS[botId].name}
          </button>
        </div>
      </form>
    </main>
  );
}
