"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KnightMark } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const { user } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");

  // Already signed in? Skip registration.
  useEffect(() => {
    if (user) router.replace("/play");
  }, [user, router]);

  // NOTE: no real account is created. "Create account" just moves on to the
  // onboarding step, which collects a nickname and starts the mock session.
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    router.push("/onboarding");
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="grid items-stretch gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left — the form */}
        <div className="animate-fade-in flex flex-col justify-center">
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
            Create your account
          </h1>
          <p className="mt-3 text-base text-muted">
            It&apos;s free — set up in under a minute.
          </p>

          <form onSubmit={handleSubmit} className="mt-9 max-w-md space-y-5">
            <Field label="Email" htmlFor="email">
              <input
                id="email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-ink shadow-sm outline-none transition placeholder:text-muted-light focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
              />
            </Field>

            <Field label="Password" htmlFor="password">
              <input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder="Create a password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-ink shadow-sm outline-none transition placeholder:text-muted-light focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
              />
            </Field>

            <Field label="Confirm password" htmlFor="confirm">
              <input
                id="confirm"
                type="password"
                autoComplete="new-password"
                placeholder="Re-enter your password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-ink shadow-sm outline-none transition placeholder:text-muted-light focus:border-gold/60 focus:ring-4 focus:ring-gold/10"
              />
            </Field>

            <button
              type="submit"
              className="w-full rounded-2xl bg-ink px-6 py-3.5 text-base font-semibold text-paper shadow-card transition hover:bg-ink-800"
            >
              Create account
            </button>

            <button
              type="button"
              onClick={() => router.push("/onboarding")}
              className="flex w-full items-center justify-center gap-3 rounded-2xl border border-line bg-white px-6 py-3.5 text-base font-semibold text-ink transition hover:bg-paper-50"
            >
              <GoogleIcon className="h-5 w-5" />
              Continue with Google
            </button>

            <p className="pt-1 text-center text-sm text-muted">
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-semibold text-ink transition hover:text-gold-600"
              >
                Log in
              </Link>
            </p>
          </form>
        </div>

        {/* Right — brand panel */}
        <div className="relative hidden overflow-hidden rounded-3xl bg-night p-10 lg:flex lg:flex-col">
          <div className="flex flex-1 items-center justify-center">
            <KnightMark className="h-40 w-40 text-gold" />
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-paper">
              Start your chess journey.
            </p>
            <p className="mt-2 text-sm text-white/55">
              Free to play. Progress at your own pace.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <label htmlFor={htmlFor} className="block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-wider text-muted">
        {label}
      </span>
      {children}
    </label>
  );
}

function GoogleIcon({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.1 0 24 0 14.6 0 6.5 5.4 2.5 13.2l7.9 6.1C12.2 13.2 17.6 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9.1h12.4c-.5 2.9-2.2 5.3-4.6 7l7.2 5.6c4.2-3.9 6.6-9.6 6.6-16.1z"
      />
      <path
        fill="#FBBC05"
        d="M10.4 28.7c-.5-1.4-.7-2.9-.7-4.7s.3-3.3.7-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.5 10.8l7.9-6.1z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.1 0 11.3-2 15-5.5l-7.2-5.6c-2 1.4-4.6 2.2-7.8 2.2-6.4 0-11.8-3.7-13.6-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
