"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { KnightMark } from "@/components/Logo";
import { AuthForm } from "@/components/AuthForm";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  return (
    <Suspense>
      <LoginContent />
    </Suspense>
  );
}

function LoginContent() {
  const { user } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const oauthFailed = searchParams.get("error") === "oauth";

  // Already signed in? Send them into the app (or to finish onboarding).
  useEffect(() => {
    if (user) router.replace(user.needsOnboarding ? "/onboarding" : "/play");
  }, [user, router]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="grid items-stretch gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left — the form */}
        <div className="animate-fade-in flex flex-col justify-center">
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
            Welcome back
          </h1>
          <p className="mt-3 text-base text-muted">
            Sign in with a one-time email link or code, or your Google account.
          </p>

          {oauthFailed && (
            <p className="mt-6 max-w-md rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
              Google sign-in didn&apos;t complete — please try again.
            </p>
          )}

          <AuthForm
            mode="login"
            onDone={() => router.push("/play")}
          />

          <p className="mt-5 max-w-md pt-1 text-center text-sm text-muted">
            New here?{" "}
            <Link
              href="/register"
              className="font-semibold text-ink transition hover:text-gold-600"
            >
              Create an account
            </Link>
          </p>
        </div>

        {/* Right — brand panel */}
        <div className="relative hidden overflow-hidden rounded-3xl bg-night p-10 lg:flex lg:flex-col">
          <div className="flex flex-1 items-center justify-center">
            <KnightMark className="h-40 w-40 text-gold" />
          </div>
          <div className="text-center">
            <p className="text-2xl font-bold text-paper">
              Your games, wherever you play.
            </p>
            <p className="mt-2 text-sm text-white/55">
              Private by default. Synced when you choose.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
