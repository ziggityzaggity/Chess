"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { KnightMark } from "@/components/Logo";
import {
  BOT_FAMILIES,
  DEPTHS,
  MODEL_SIZES,
  MODEL_SIZE_DETAIL,
  botName,
  botQuery,
  isPlayable,
  type BotDepth,
  type BotFamily,
  type BotSpec,
  type ModelSize,
} from "@/lib/bots";
import { cnnModel, loadModelManifest, type ModelManifest } from "@/lib/models";

const COLOURS = [
  { id: "white", name: "White", detail: "You move first", symbol: "○" },
  { id: "random", name: "Random", detail: "Leave it to chance", symbol: "◐" },
  { id: "black", name: "Black", detail: "The bot moves first", symbol: "●" },
] as const;
type Colour = (typeof COLOURS)[number]["id"];

export default function BotSetupPage() {
  const router = useRouter();
  const [colour, setColour] = useState<Colour>("white");
  const [family, setFamily] = useState<BotFamily>("greedy");
  const [depth, setDepth] = useState<BotDepth>(1);
  const [size, setSize] = useState<ModelSize>("small");
  const [manifest, setManifest] = useState<ModelManifest | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadModelManifest().then((m) => {
      if (cancelled) return;
      setManifest(m);
      const first = MODEL_SIZES.find((s) => cnnModel(m, s));
      if (first) setSize(first);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const deployed = (s: ModelSize) => !!manifest && !!cnnModel(manifest, s);
  const anyModel = MODEL_SIZES.some(deployed);
  const available = (f: BotFamily) => isPlayable(f) && (f !== "cnn" || anyModel);
  const unavailableNote = (f: BotFamily) =>
    f === "dqn"
      ? "Coming soon"
      : f === "cnn" && !anyModel
        ? manifest
          ? "Not deployed yet"
          : "Checking for models…"
        : null;

  const spec: BotSpec | null =
    family === "jester"
      ? { family }
      : family === "greedy"
        ? { family, depth }
        : family === "cnn" && deployed(size)
          ? { family, size, depth }
          : null;
  const hasDepth = BOT_FAMILIES[family].hasDepth;

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
          if (!spec) return;
          router.push(`/game?mode=bot&${botQuery(spec)}&colour=${playerColour}`);
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
            {Object.values(BOT_FAMILIES).map((bot) => {
              const note = unavailableNote(bot.id);
              const enabled = available(bot.id);
              const checked = family === bot.id;
              return (
                <label
                  key={bot.id}
                  className={`relative block ${enabled ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <input
                    type="radio"
                    name="bot"
                    value={bot.id}
                    checked={checked}
                    disabled={!enabled}
                    onChange={() => setFamily(bot.id)}
                    aria-label={bot.name}
                    aria-describedby={`bot-${bot.id}-description`}
                    className="peer sr-only"
                  />
                  <span className="flex gap-4 rounded-2xl border border-line bg-surface p-5 transition hover:border-gold peer-checked:border-gold peer-checked:ring-1 peer-checked:ring-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold peer-disabled:hover:border-line sm:p-6">
                    <span
                      aria-hidden="true"
                      className="hidden h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gold/10 sm:grid"
                    >
                      <KnightMark className="h-7 w-7 text-gold" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                        <span className="text-lg font-bold text-ink">
                          {bot.name}
                        </span>
                        {note ? (
                          <span className="shrink-0 rounded-full bg-paper-200 px-2.5 py-0.5 text-xs font-semibold text-muted">
                            {note}
                          </span>
                        ) : (
                          <span
                            aria-hidden="true"
                            className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border text-xs ${checked ? "border-gold bg-gold text-on-accent" : "border-line"}`}
                          >
                            {checked ? "✓" : ""}
                          </span>
                        )}
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
              );
            })}
          </div>
        </fieldset>
        {family === "cnn" && (
          <fieldset className="mt-8">
            <legend className="text-sm font-bold text-ink">Model size</legend>
            <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
              {MODEL_SIZES.map((s) => (
                <label
                  key={s}
                  className={`relative min-w-0 ${deployed(s) ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                >
                  <input
                    type="radio"
                    name="size"
                    value={s}
                    checked={size === s}
                    disabled={!deployed(s)}
                    onChange={() => setSize(s)}
                    aria-label={`${s} model`}
                    className="peer sr-only"
                  />
                  <span className="flex h-full flex-col items-center rounded-2xl border border-line bg-surface px-2 py-4 text-center transition hover:border-gold peer-checked:border-gold peer-checked:ring-1 peer-checked:ring-gold peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-gold peer-disabled:hover:border-line sm:px-4">
                    <span className="text-sm font-bold capitalize text-ink">{s}</span>
                    <span className="mt-1 text-xs leading-relaxed text-muted">
                      {deployed(s) ? MODEL_SIZE_DETAIL[s] : "Not deployed"}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="mt-8" disabled={!hasDepth}>
          <legend className="text-sm font-bold text-ink">Lookahead depth</legend>
          <div className={`mt-3 rounded-2xl border border-line bg-surface p-5 sm:p-6 ${hasDepth ? "" : "opacity-60"}`}>
            <div className="flex items-baseline justify-between gap-3">
              <label htmlFor="depth" className="text-sm text-muted">
                {hasDepth
                  ? depth === 1
                    ? "Judges the position after each of its moves"
                    : depth === 2
                      ? "Also considers your best reply"
                      : "Considers your reply and its own answer"
                  : `${BOT_FAMILIES[family].name} doesn't look ahead`}
              </label>
              <span className="shrink-0 text-lg font-bold text-ink" aria-hidden="true">
                {hasDepth ? `${depth} ${depth === 1 ? "move" : "moves"}` : "—"}
              </span>
            </div>
            <input
              id="depth"
              type="range"
              min={DEPTHS[0]}
              max={DEPTHS[DEPTHS.length - 1]}
              step={1}
              value={depth}
              onChange={(event) => setDepth(Number(event.target.value) as BotDepth)}
              aria-valuetext={`${depth} ${depth === 1 ? "move" : "moves"} ahead`}
              className="mt-4 w-full accent-gold disabled:cursor-not-allowed"
            />
            <div aria-hidden="true" className="mt-1 flex justify-between text-xs text-muted">
              {DEPTHS.map((d) => (
                <span key={d}>{d}</span>
              ))}
            </div>
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
            disabled={!spec}
            className="rounded-full bg-ink px-7 py-3 text-sm font-bold text-paper transition hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {spec ? `Play against ${botName(spec)}` : "Choose an available bot"}
          </button>
        </div>
      </form>
    </main>
  );
}
