"use client";

// Shared sign-in / registration form: one-time code by email + Google OAuth.
// Two steps — enter email (sends the code), then enter the 6-digit code.

import { useState } from "react";
import { useAuth } from "@/lib/auth";

export function AuthForm({
  mode,
  onDone,
}: {
  /** "login" only signs in existing accounts; "register" may create one. */
  mode: "login" | "register";
  /** Called once the code is verified and the session exists. */
  onDone: () => void;
}) {
  const { configured, sendCode, verifyCode, signInWithGoogle } = useAuth();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function handleSendCode(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !email.trim()) return;
    setBusy(true);
    setError(null);
    const res = await sendCode(email, { create: mode === "register" });
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    setNotice(
      `We emailed a 6-digit code to ${email.trim()} — enter it below. ` +
        `The sign-in link in the email works too.`
    );
    setStep("code");
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !code.trim()) return;
    setBusy(true);
    setError(null);
    const res = await verifyCode(email, code);
    setBusy(false);
    if (res.error) {
      setError(res.error);
      return;
    }
    onDone();
  }

  async function handleGoogle() {
    if (busy) return;
    setError(null);
    const res = await signInWithGoogle();
    // On success the browser navigates away; only errors come back.
    if (res.error) setError(res.error);
  }

  const inputClass =
    "w-full rounded-2xl border border-line bg-white px-4 py-3.5 text-ink shadow-sm outline-none transition placeholder:text-muted-light focus:border-gold/60 focus:ring-4 focus:ring-gold/10";

  return (
    <div className="mt-9 max-w-md space-y-5">
      {!configured && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Sign-in isn&apos;t configured yet — the Supabase environment variables
          are missing.
        </p>
      )}

      {step === "email" ? (
        <form onSubmit={handleSendCode} className="space-y-5">
          <Field label="Email" htmlFor="email">
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
            />
          </Field>

          {error && <ErrorText>{error}</ErrorText>}

          <button
            type="submit"
            disabled={busy || !configured}
            className="w-full rounded-2xl bg-ink px-6 py-3.5 text-base font-semibold text-paper shadow-card transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Sending code…" : "Email me a one-time code"}
          </button>
        </form>
      ) : (
        <form onSubmit={handleVerify} className="space-y-5">
          {notice && (
            <p className="rounded-2xl border border-line bg-paper-50 px-4 py-3 text-sm text-muted">
              {notice}
            </p>
          )}

          <Field label="One-time code" htmlFor="code">
            <input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              autoFocus
              maxLength={10}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              className={`${inputClass} text-center text-xl font-bold tracking-[0.4em]`}
            />
          </Field>

          {error && <ErrorText>{error}</ErrorText>}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-2xl bg-ink px-6 py-3.5 text-base font-semibold text-paper shadow-card transition hover:bg-ink-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? "Checking…" : "Verify code"}
          </button>

          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setStep("email");
              setCode("");
              setError(null);
              setNotice(null);
            }}
            className="w-full text-center text-sm font-semibold text-muted transition hover:text-ink"
          >
            Use a different email or resend the code
          </button>
        </form>
      )}

      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-wider text-muted-light">
        <span className="h-px flex-1 bg-line" />
        or
        <span className="h-px flex-1 bg-line" />
      </div>

      <button
        type="button"
        onClick={handleGoogle}
        disabled={!configured}
        className="flex w-full items-center justify-center gap-3 rounded-2xl border border-line bg-white px-6 py-3.5 text-base font-semibold text-ink transition hover:bg-paper-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <GoogleIcon className="h-5 w-5" />
        Continue with Google
      </button>
    </div>
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

function ErrorText({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
      {children}
    </p>
  );
}

export function GoogleIcon({ className = "" }: { className?: string }) {
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
