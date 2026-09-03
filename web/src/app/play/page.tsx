"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KnightMark } from "@/components/Logo";

type Mode = "quick" | "friend" | "bot";
type Minutes = 3 | 10 | 30;

const MODES: {
  id: Mode;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
}[] = [
  {
    id: "quick",
    title: "Quick match",
    subtitle: "Find a player near your rating",
    icon: <KnightMark className="h-6 w-6" />,
  },
  {
    id: "friend",
    title: "Play a friend",
    subtitle: "Invite with a private link",
    icon: <PersonIcon className="h-6 w-6" />,
  },
  {
    id: "bot",
    title: "Play the bot",
    subtitle: "Choose strength and style",
    icon: <RookIcon className="h-6 w-6" />,
  },
];

const TIMES: { minutes: Minutes; label: string }[] = [
  { minutes: 3, label: "Blitz" },
  { minutes: 10, label: "Rapid" },
  { minutes: 30, label: "Classical" },
];

export default function NewGamePage() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("quick");
  const [minutes, setMinutes] = useState<Minutes>(3);

  function start() {
    // No matchmaking backend: "bot" plays the local engine opponent, everything
    // else is a pass-and-play game on this device.
    const engineMode = mode === "bot" ? "bot" : "local";
    const params = new URLSearchParams({
      mode: engineMode,
      min: String(minutes),
    });
    router.push(`/game?${params.toString()}`);
  }

  const subline =
    mode === "bot"
      ? "You play White; the bot replies as Black."
      : "Pass-and-play on this device — take turns for both sides.";

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
        Start a new game
      </h1>
      <p className="mt-3 text-base text-muted">
        Choose how you want to play. You can change advanced options later.
      </p>

      {/* Mode cards */}
      <div className="mt-9 grid gap-4 sm:grid-cols-3">
        {MODES.map((m) => {
          const active = mode === m.id;
          return (
            <button
              key={m.id}
              type="button"
              onClick={() => setMode(m.id)}
              className={`relative rounded-2xl border bg-white p-5 text-left transition ${
                active
                  ? "border-gold shadow-card ring-1 ring-gold/40"
                  : "border-line hover:border-ink/15 hover:shadow-card"
              }`}
            >
              {active && (
                <span className="absolute right-4 top-4 grid h-6 w-6 place-items-center rounded-full bg-gold text-white">
                  <CheckIcon className="h-3.5 w-3.5" />
                </span>
              )}
              <span
                className={`inline-flex ${active ? "text-gold" : "text-muted"}`}
              >
                {m.icon}
              </span>
              <h3 className="mt-4 text-base font-bold text-ink">{m.title}</h3>
              <p className="mt-1 text-sm text-muted">{m.subtitle}</p>
            </button>
          );
        })}
      </div>

      {/* Time control */}
      <h2 className="mt-10 text-xs font-bold uppercase tracking-wider text-muted">
        Time control
      </h2>
      <div className="mt-3 grid max-w-xl gap-3 sm:grid-cols-3">
        {TIMES.map((t) => {
          const active = minutes === t.minutes;
          return (
            <button
              key={t.minutes}
              type="button"
              onClick={() => setMinutes(t.minutes)}
              className={`rounded-2xl border px-5 py-4 text-left transition ${
                active
                  ? "border-ink bg-ink text-paper"
                  : "border-line bg-white text-ink hover:border-ink/15"
              }`}
            >
              <div className="text-lg font-bold">{t.minutes} min</div>
              <div
                className={`text-sm ${active ? "text-paper/60" : "text-muted"}`}
              >
                {t.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Start */}
      <div className="mt-12 flex flex-col items-stretch gap-3 sm:items-end">
        <button
          type="button"
          onClick={start}
          className="rounded-full bg-ink px-9 py-4 text-base font-bold text-paper shadow-card transition hover:bg-ink-800"
        >
          {mode === "bot" ? "Play the bot" : "Find a game"}
        </button>
        <p className="text-sm text-muted sm:text-right">{subline}</p>
      </div>
    </main>
  );
}

function PersonIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c1.5-4 4-6 7-6s5.5 2 7 6" />
    </svg>
  );
}

function RookIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M6 4h2v2h2V4h4v2h2V4h2v5l-2 2v5l1 4H7l1-4v-5L6 9z" />
      <rect x="5" y="20" width="14" height="2" rx="1" />
    </svg>
  );
}

function CheckIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12l5 5L20 6" />
    </svg>
  );
}
