"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { KnightMark } from "@/components/Logo";
import { TimeControlPicker } from "@/components/TimeControlPicker";
import { timeControlLabel, type TimeControl } from "@/lib/timeControl";

type Step = "choose" | "host" | "join" | "waiting" | "join-preview";
type Invite = { code: string; password: string; time: TimeControl };

const PRIMARY =
  "rounded-full bg-ink px-6 py-3 text-sm font-bold text-paper transition hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold";
const SECONDARY =
  "rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition hover:bg-paper-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold";
const INPUT =
  "mt-2 w-full rounded-2xl border border-line bg-paper-50 px-4 py-3.5 text-ink outline-none transition placeholder:text-muted-light focus:border-gold focus:ring-4 focus:ring-gold/10";

// Preview only: this code does not reserve a room or connect to another player.
function createPreviewCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
}

export default function FriendGamePage() {
  const [step, setStep] = useState<Step>("choose");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [time, setTime] = useState<TimeControl>(3);
  const [showPassword, setShowPassword] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  function reset() {
    setCode("");
    setPassword("");
    setTime(3);
    setShowPassword(false);
    setInvite(null);
    setStep("choose");
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (step === "host") {
      setInvite({ code: createPreviewCode(), password, time });
      setStep("waiting");
    } else if (step === "join") {
      setCode(code.trim().toUpperCase());
      setStep("join-preview");
    }
  }

  const titles: Record<Step, string> = {
    choose: "Play with a friend",
    host: "Start a game",
    join: "Join a game",
    waiting: "Your game invitation",
    "join-preview": "Join game preview",
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link
        href="/play"
        className="text-sm font-semibold text-muted transition hover:text-ink"
      >
        <span aria-hidden="true">← </span>Back to play
      </Link>
      <div className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-600">
        <KnightMark className="h-5 w-5" /> Private game
        <span className="ml-auto rounded-full border border-line bg-surface px-3 py-1 text-muted">
          Preview
        </span>
      </div>
      <h1
        ref={heading}
        tabIndex={-1}
        className="mt-4 text-4xl font-black tracking-tight text-ink outline-none sm:text-5xl"
      >
        {titles[step]}
      </h1>

      {step === "choose" && (
        <>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Set up a private game, or enter the details your friend shared.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {(
              [
                {
                  id: "host",
                  title: "Start a game",
                  description:
                    "Choose a time limit and add an optional password.",
                  symbol: "+",
                },
                {
                  id: "join",
                  title: "Join a game",
                  description: "Enter your friend’s game code and password.",
                  symbol: "→",
                },
              ] as const
            ).map((choice) => (
              <button
                key={choice.id}
                type="button"
                onClick={() => setStep(choice.id)}
                className="group flex flex-col items-start rounded-3xl border border-line bg-surface p-6 text-left shadow-card transition hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
              >
                <span
                  aria-hidden="true"
                  className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/10 text-2xl text-gold-600"
                >
                  {choice.symbol}
                </span>
                <span className="mt-5 block text-xl font-bold text-ink">
                  {choice.title}
                </span>
                <span className="mt-2 block text-sm leading-relaxed text-muted">
                  {choice.description}
                </span>
                <span
                  aria-hidden="true"
                  className="mt-auto block pt-6 text-sm font-bold text-gold-600"
                >
                  Continue{" "}
                  <span className="inline-block transition-transform group-hover:translate-x-1">
                    →
                  </span>
                </span>
              </button>
            ))}
          </div>
          <p className="mt-6 text-sm leading-relaxed text-muted">
            Online multiplayer is coming soon. Explore the invitation flow with
            a preview game.
          </p>
        </>
      )}

      {(step === "host" || step === "join") && (
        <>
          <p className="mt-4 text-base leading-relaxed text-muted">
            {step === "host"
              ? "Choose a time limit and add an optional password for your friend."
              : "Enter the invitation details from your friend."}
          </p>
          <form
            onSubmit={submit}
            className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8"
          >
            {step === "host" && (
              <div className="mb-8">
                <TimeControlPicker value={time} onChange={setTime} />
                <p className="mt-3 text-xs text-muted">
                  Choose ∞ to play without a clock.
                </p>
              </div>
            )}
            {step === "join" && (
              <div className="mb-6">
                <label
                  htmlFor="game-code"
                  className="text-sm font-semibold text-ink"
                >
                  Game code
                </label>
                <input
                  id="game-code"
                  name="game-code"
                  required
                  minLength={6}
                  maxLength={6}
                  pattern="[A-Za-z0-9]{6}"
                  value={code}
                  onChange={(event) =>
                    setCode(event.target.value.toUpperCase())
                  }
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABC123"
                  aria-describedby="code-hint"
                  className={`${INPUT} font-mono uppercase tracking-[0.2em]`}
                />
                <p id="code-hint" className="mt-2 text-xs text-muted">
                  The 6-character code from your invitation.
                </p>
              </div>
            )}
            <label
              htmlFor="game-password"
              className="text-sm font-semibold text-ink"
            >
              Game password{" "}
              {step === "host" && (
                <span className="font-normal text-muted">(optional)</span>
              )}
            </label>
            <div className="relative">
              <input
                id="game-password"
                name="game-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                aria-describedby="password-hint"
                className={`${INPUT} pr-20`}
              />
              <button
                type="button"
                aria-label={
                  showPassword ? "Hide game password" : "Show game password"
                }
                aria-pressed={showPassword}
                onClick={() => setShowPassword((visible) => !visible)}
                className="absolute bottom-1.5 right-2 rounded-lg px-3 py-2.5 text-xs font-bold text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <p
              id="password-hint"
              className="mt-2 text-xs leading-relaxed text-muted"
            >
              {step === "host"
                ? "Up to 64 characters. You’ll see the password on your invitation screen."
                : "Leave blank if your friend didn’t set a password."}
            </p>
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={reset} className={SECONDARY}>
                Back
              </button>
              <button type="submit" className={PRIMARY}>
                {step === "host" ? "Create game" : "Join game"}
              </button>
            </div>
          </form>
          <p className="mt-5 text-sm text-muted">
            Preview only — online multiplayer is coming soon.
          </p>
        </>
      )}

      {step === "waiting" && invite && (
        <>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Your invitation details are ready.
          </p>
          <section
            aria-label="Game invitation"
            className="mt-8 rounded-3xl border border-line bg-surface p-6 text-center shadow-card sm:p-10"
          >
            <dl>
              <dt className="text-xs font-bold uppercase tracking-wider text-muted">
                Game code
              </dt>
              <dd className="mt-3 select-all break-all font-mono text-4xl font-bold tracking-[0.12em] text-ink sm:text-6xl">
                {invite.code}
              </dd>
              <dt className="mt-8 text-xs font-bold uppercase tracking-wider text-muted">
                Game password
              </dt>
              <dd className="mt-3 min-h-9 select-all whitespace-pre-wrap break-all font-mono text-3xl font-bold text-ink sm:min-h-10 sm:text-4xl">
                {invite.password}
              </dd>
              <dt className="mt-8 text-xs font-bold uppercase tracking-wider text-muted">
                Time per player
              </dt>
              <dd
                className="mt-3 text-2xl font-bold text-ink"
                aria-label={
                  invite.time === "unlimited" ? "Unlimited time" : undefined
                }
              >
                {timeControlLabel(invite.time)}
              </dd>
            </dl>
            <p
              role="status"
              className="mt-10 flex items-center justify-center gap-3 border-t border-line pt-6 text-sm font-semibold text-muted sm:text-base"
            >
              <span
                aria-hidden="true"
                className="h-2 w-2 shrink-0 rounded-full bg-gold motion-safe:animate-pulse"
              />
              Waiting for user to join...
            </p>
          </section>
          <p className="mt-5 text-center text-sm leading-relaxed text-muted">
            This is a preview invitation. Other players can join once online
            multiplayer is available.
          </p>
          <div className="mt-6 text-center">
            <button type="button" onClick={reset} className={SECONDARY}>
              Cancel invitation
            </button>
          </div>
        </>
      )}

      {step === "join-preview" && (
        <section className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
          <p className="text-xs font-bold uppercase tracking-wider text-muted">
            Game code
          </p>
          <p className="mt-3 break-all font-mono text-3xl font-bold tracking-[0.12em] text-ink sm:text-4xl">
            {code}
          </p>
          <p
            role="status"
            className="mt-6 text-base leading-relaxed text-muted"
          >
            Online multiplayer is coming soon. This preview can’t check the game
            code or password, or connect you to another player yet.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={() => setStep("join")}
              className={PRIMARY}
            >
              Edit game details
            </button>
            <button type="button" onClick={reset} className={SECONDARY}>
              Back to invitations
            </button>
          </div>
        </section>
      )}
    </main>
  );
}
