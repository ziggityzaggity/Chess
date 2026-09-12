"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { TimeControlPicker } from "@/components/TimeControlPicker";
import type { TimeControl } from "@/lib/timeControl";

export default function LocalGamePage() {
  const router = useRouter();
  const [time, setTime] = useState<TimeControl>(3);

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/play"
        className="text-sm font-semibold text-muted hover:text-ink"
      >
        ← Back to play
      </Link>
      <h1 className="mt-8 text-4xl font-black tracking-tight text-ink sm:text-5xl">
        Local game
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted">
        Pass and play on this device. Choose a time limit, then take turns for
        both sides.
      </p>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          router.push(`/game?mode=local&min=${time}`);
        }}
        className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8"
      >
        <TimeControlPicker value={time} onChange={setTime} />
        <p className="mt-4 text-sm text-muted">
          Choose ∞ to play without a clock.
        </p>
        <div className="mt-8 flex justify-end">
          <button
            type="submit"
            className="w-full rounded-full bg-ink px-7 py-3 text-sm font-bold text-paper transition hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold sm:w-auto"
          >
            Start local game
          </button>
        </div>
      </form>
    </main>
  );
}
