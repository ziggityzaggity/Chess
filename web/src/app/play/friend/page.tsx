"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { KnightMark } from "@/components/Logo";
import { TimeControlPicker } from "@/components/TimeControlPicker";
import { timeControlLabel, type TimeControl } from "@/lib/timeControl";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase/client";
import { createOnlineGame, joinOnlineGame } from "@/lib/onlineGame";

type Step = "choose" | "host" | "join" | "waiting";

const PRIMARY =
  "rounded-full bg-ink px-6 py-3 text-sm font-bold text-paper transition hover:bg-ink-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-40";
const SECONDARY =
  "rounded-full border border-line px-6 py-3 text-sm font-semibold text-ink transition hover:bg-paper-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold";
const INPUT =
  "mt-2 w-full rounded-2xl border border-line bg-paper-50 px-4 py-3.5 text-ink outline-none transition placeholder:text-muted-light focus:border-gold focus:ring-4 focus:ring-gold/10";

export default function FriendGamePage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [step, setStep] = useState<Step>("choose");
  const [color, setColor] = useState<"white" | "black">("white");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [time, setTime] = useState<TimeControl>(3);
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [invite, setInvite] = useState<{ id: string; code: string; password: string; time: TimeControl } | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus();
  }, [step]);

  // While hosting, poll until a guest joins, then enter the board.
  useEffect(() => {
    if (step !== "waiting" || !invite) return;
    const supabase = getSupabase();
    if (!supabase) return;
    let stop = false;
    const poll = async () => {
      const { data } = await supabase
        .from("active_games")
        .select("status")
        .eq("id", invite.id)
        .maybeSingle();
      if (stop) return;
      if (!data) {
        setError("This game is no longer available.");
        setStep("choose");
      } else if (data.status === "active") {
        router.push(`/game/online?id=${invite.id}`);
      }
    };
    const t = setInterval(poll, 2500);
    void poll();
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [step, invite, router]);

  function reset() {
    setCode("");
    setPassword("");
    setTime(3);
    setColor("white");
    setShowPassword(false);
    setInvite(null);
    setError(null);
    setStep("choose");
  }

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (busy) return;
      setBusy(true);
      setError(null);
      try {
        if (step === "host") {
          const tc = time === "unlimited" ? "unlimited" : String(time);
          const { id, code: newCode } = await createOnlineGame({ password, color, timeControl: tc });
          setInvite({ id, code: newCode, password, time });
          setStep("waiting");
        } else if (step === "join") {
          const id = await joinOnlineGame(code, password);
          router.push(`/game/online?id=${id}`);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Something went wrong.");
      } finally {
        setBusy(false);
      }
    },
    [busy, step, time, password, color, code, router]
  );

  async function cancelInvite() {
    const supabase = getSupabase();
    if (invite && supabase) {
      // Best-effort cancel of the waiting game.
      try {
        await supabase.rpc("resign_active_game", { p_game_id: invite.id });
      } catch {
        /* ignore */
      }
    }
    reset();
  }

  const titles: Record<Step, string> = {
    choose: "Play with a friend",
    host: "Start a game",
    join: "Join a game",
    waiting: "Your game invitation",
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/play" className="text-sm font-semibold text-muted transition hover:text-ink">
        <span aria-hidden="true">← </span>Back to play
      </Link>
      <div className="mt-8 flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-gold-600">
        <KnightMark className="h-5 w-5" /> Private game
      </div>
      <h1
        ref={heading}
        tabIndex={-1}
        className="mt-4 text-4xl font-black tracking-tight text-ink outline-none sm:text-5xl"
      >
        {titles[step]}
      </h1>

      {ready && !user && (
        <p className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You need to{" "}
          <Link href="/login" className="font-bold underline">
            sign in
          </Link>{" "}
          to play online with a friend.
        </p>
      )}

      {error && (
        <p className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </p>
      )}

      {step === "choose" && (
        <>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Set up a private game, or enter the details your friend shared.
          </p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {(
              [
                { id: "host", title: "Start a game", description: "Choose a time limit and add an optional password.", symbol: "+" },
                { id: "join", title: "Join a game", description: "Enter your friend's game code and password.", symbol: "→" },
              ] as const
            ).map((choice) => (
              <button
                key={choice.id}
                type="button"
                disabled={ready && !user}
                onClick={() => setStep(choice.id)}
                className="group flex flex-col items-start rounded-3xl border border-line bg-surface p-6 text-left shadow-card transition hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold disabled:cursor-not-allowed disabled:opacity-50"
              >
                <span aria-hidden="true" className="grid h-12 w-12 place-items-center rounded-2xl bg-gold/10 text-2xl text-gold-600">
                  {choice.symbol}
                </span>
                <span className="mt-5 block text-xl font-bold text-ink">{choice.title}</span>
                <span className="mt-2 block text-sm leading-relaxed text-muted">{choice.description}</span>
                <span aria-hidden="true" className="mt-auto block pt-6 text-sm font-bold text-gold-600">
                  Continue{" "}
                  <span className="inline-block transition-transform group-hover:translate-x-1">→</span>
                </span>
              </button>
            ))}
          </div>
        </>
      )}

      {(step === "host" || step === "join") && (
        <>
          <p className="mt-4 text-base leading-relaxed text-muted">
            {step === "host"
              ? "Choose your side, a time limit, and an optional password."
              : "Enter the invitation details from your friend."}
          </p>
          <form onSubmit={submit} className="mt-8 rounded-3xl border border-line bg-surface p-6 shadow-card sm:p-8">
            {step === "host" && (
              <>
                <fieldset className="mb-8">
                  <legend className="text-sm font-semibold text-ink">Your side</legend>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(["white", "black"] as const).map((c) => (
                      <button
                        key={c}
                        type="button"
                        aria-pressed={color === c}
                        onClick={() => setColor(c)}
                        className={`rounded-2xl border px-4 py-3 text-sm font-semibold capitalize transition ${
                          color === c ? "border-gold bg-gold/10 text-ink" : "border-line text-muted hover:border-ink/20"
                        }`}
                      >
                        {c}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <div className="mb-8">
                  <TimeControlPicker value={time} onChange={setTime} />
                  <p className="mt-3 text-xs text-muted">Choose ∞ to play without a clock.</p>
                </div>
              </>
            )}
            {step === "join" && (
              <div className="mb-6">
                <label htmlFor="game-code" className="text-sm font-semibold text-ink">
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
                  onChange={(e) => setCode(e.target.value.toUpperCase())}
                  autoComplete="off"
                  autoCapitalize="characters"
                  spellCheck={false}
                  placeholder="ABC123"
                  className={`${INPUT} font-mono uppercase tracking-[0.2em]`}
                />
              </div>
            )}
            <label htmlFor="game-password" className="text-sm font-semibold text-ink">
              Game password {step === "host" && <span className="font-normal text-muted">(optional)</span>}
            </label>
            <div className="relative">
              <input
                id="game-password"
                name="game-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                className={`${INPUT} pr-20`}
              />
              <button
                type="button"
                aria-label={showPassword ? "Hide game password" : "Show game password"}
                aria-pressed={showPassword}
                onClick={() => setShowPassword((v) => !v)}
                className="absolute bottom-1.5 right-2 rounded-lg px-3 py-2.5 text-xs font-bold text-muted hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold"
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
            <div className="mt-8 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button type="button" onClick={reset} className={SECONDARY}>
                Back
              </button>
              <button type="submit" disabled={busy || (ready && !user)} className={PRIMARY}>
                {busy ? (step === "host" ? "Creating…" : "Joining…") : step === "host" ? "Create game" : "Join game"}
              </button>
            </div>
          </form>
        </>
      )}

      {step === "waiting" && invite && (
        <>
          <p className="mt-4 text-base leading-relaxed text-muted">
            Share these details with your friend. The game starts automatically when they join.
          </p>
          <section aria-label="Game invitation" className="mt-8 rounded-3xl border border-line bg-surface p-6 text-center shadow-card sm:p-10">
            <dl>
              <dt className="text-xs font-bold uppercase tracking-wider text-muted">Game code</dt>
              <dd className="mt-3 select-all break-all font-mono text-4xl font-bold tracking-[0.12em] text-ink sm:text-6xl">
                {invite.code}
              </dd>
              {invite.password && (
                <>
                  <dt className="mt-8 text-xs font-bold uppercase tracking-wider text-muted">Game password</dt>
                  <dd className="mt-3 select-all whitespace-pre-wrap break-all font-mono text-3xl font-bold text-ink sm:text-4xl">
                    {invite.password}
                  </dd>
                </>
              )}
              <dt className="mt-8 text-xs font-bold uppercase tracking-wider text-muted">Time per player</dt>
              <dd className="mt-3 text-2xl font-bold text-ink">{timeControlLabel(invite.time)}</dd>
            </dl>
            <p role="status" className="mt-10 flex items-center justify-center gap-3 border-t border-line pt-6 text-sm font-semibold text-muted sm:text-base">
              <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full bg-gold motion-safe:animate-pulse" />
              Waiting for your friend to join…
            </p>
          </section>
          <div className="mt-6 text-center">
            <button type="button" onClick={cancelInvite} className={SECONDARY}>
              Cancel invitation
            </button>
          </div>
        </>
      )}
    </main>
  );
}
