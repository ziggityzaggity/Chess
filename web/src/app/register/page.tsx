"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { KnightMark } from "@/components/Logo";
import { AuthForm } from "@/components/AuthForm";
import { useAuth } from "@/lib/auth";

export default function RegisterPage() {
  const { user } = useAuth();
  const router = useRouter();

  // Already signed in? Skip registration (finish onboarding if needed).
  useEffect(() => {
    if (user) router.replace(user.needsOnboarding ? "/onboarding" : "/play");
  }, [user, router]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-16">
      <div className="grid items-stretch gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left — the form */}
        <div className="animate-fade-in flex flex-col justify-center">
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
            Create your account
          </h1>
          <p className="mt-3 text-base text-muted">
            No password needed — we&apos;ll email you a one-time sign-in link
            or code.
          </p>

          <AuthForm
            mode="register"
            onDone={() => router.push("/onboarding")}
          />

          <p className="mt-5 max-w-md pt-1 text-center text-sm text-muted">
            Already have an account?{" "}
            <Link
              href="/login"
              className="font-semibold text-ink transition hover:text-gold-600"
            >
              Log in
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
