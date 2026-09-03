"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { KnightMark } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

export default function OnboardingPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [nickname, setNickname] = useState("");
  const [birthDate, setBirthDate] = useState("");

  const canFinish = nickname.trim().length > 0;

  function finish(e: React.FormEvent) {
    e.preventDefault();
    if (!canFinish) return;
    // No real account — this starts the mock session with the chosen nickname.
    login({ name: nickname.trim(), birthDate: birthDate || undefined });
    router.push("/play");
  }

  return (
    <main className="mx-auto flex min-h-[calc(100vh-4rem)] max-w-md flex-col justify-center px-4 py-12 sm:px-6">
      <div className="animate-fade-in rounded-3xl border border-line bg-white p-8 shadow-card sm:p-10">
        <div className="flex items-center gap-3">
          <KnightMark className="h-8 w-8 text-gold" />
          <span className="text-xs font-bold uppercase tracking-wider text-muted">
            Step 2 of 2
          </span>
        </div>

        <h1 className="mt-5 text-3xl font-black tracking-tight text-ink">
          Welcome to PyChess
        </h1>
        <p className="mt-2 text-base text-muted">
          Pick a nickname to finish setting up your profile.
        </p>

        <form onSubmit={finish} className="mt-8 space-y-5">
          <label htmlFor="nickname" className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
              Nickname
            </span>
            <input
              id="nickname"
              type="text"
              autoComplete="nickname"
              autoFocus
              maxLength={24}
              placeholder="e.g. KnightRider"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-ink shadow-sm outline-none transition placeholder:text-muted-light focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
            />
          </label>

          <label htmlFor="birthdate" className="block">
            <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
              Birth date{" "}
              <span className="font-medium normal-case text-muted-light">
                (optional)
              </span>
            </span>
            <input
              id="birthdate"
              type="date"
              value={birthDate}
              max={new Date().toISOString().slice(0, 10)}
              onChange={(e) => setBirthDate(e.target.value)}
              className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-ink shadow-sm outline-none transition focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
            />
            <span className="mt-2 block text-xs text-muted">
              We only use this to personalize your experience — you can leave it
              blank.
            </span>
          </label>

          <button
            type="submit"
            disabled={!canFinish}
            className="w-full rounded-2xl bg-ink px-6 py-3.5 text-base font-semibold text-paper shadow-card transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Finish
          </button>

          <p className="text-center text-xs text-muted">
            You can change these anytime in Settings.
          </p>
        </form>
      </div>
    </main>
  );
}
