"use client";

// Real authentication backed by Supabase. Two sign-in paths:
//   1. One-time code by email (signInWithOtp + verifyOtp)
//   2. "Continue with Google" (OAuth PKCE, completed by /auth/callback)
//
// The provider tracks the Supabase session plus the user's `profiles` row
// (nickname, birth date, avatar) and exposes a UI-friendly `User` shape.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase/client";
import type { ProfileRow } from "@/lib/database.types";

export interface User {
  id: string;
  name: string;
  email: string;
  initials: string;
  birthDate?: string; // ISO date (YYYY-MM-DD)
  avatar: Record<string, unknown>;
  /** True until the user has picked a nickname in onboarding. */
  needsOnboarding: boolean;
}

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function nameFromEmail(email: string): string {
  return email
    .split("@")[0]
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function toUser(
  id: string,
  email: string,
  profile: Pick<ProfileRow, "nickname" | "birth_date" | "avatar"> | null
): User {
  const name = profile?.nickname || nameFromEmail(email);
  return {
    id,
    name,
    email,
    initials: initialsFor(name),
    birthDate: profile?.birth_date ?? undefined,
    avatar: profile?.avatar ?? {},
    needsOnboarding: !profile?.nickname,
  };
}

export interface AuthResult {
  error?: string;
}

interface AuthContextValue {
  user: User | null;
  /** True once the initial session check has finished (avoids navbar flash). */
  ready: boolean;
  /** True when the Supabase env vars are present. */
  configured: boolean;
  /** Email a one-time sign-in code. `create` allows new accounts (register). */
  sendCode: (email: string, opts?: { create?: boolean }) => Promise<AuthResult>;
  /** Verify the emailed code and start the session. */
  verifyCode: (email: string, code: string) => Promise<AuthResult>;
  /** Redirects to Google; the session lands via /auth/callback. */
  signInWithGoogle: () => Promise<AuthResult>;
  /** Save nickname/birth date to the profile (onboarding + settings). */
  updateProfile: (input: {
    nickname?: string;
    birthDate?: string | null;
  }) => Promise<AuthResult>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const NOT_CONFIGURED =
  "Authentication isn't configured yet (missing Supabase environment variables).";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  // Load the profiles row for a signed-in user and derive the UI user.
  const refreshUser = useCallback(async (): Promise<User | null> => {
    const supabase = getSupabase();
    if (!supabase) return null;
    const {
      data: { user: authUser },
    } = await supabase.auth.getUser();
    if (!authUser) {
      setUser(null);
      return null;
    }
    const { data: profile } = await supabase
      .from("profiles")
      .select("nickname, birth_date, avatar")
      .eq("id", authUser.id)
      .maybeSingle();
    const next = toUser(authUser.id, authUser.email ?? "", profile ?? null);
    setUser(next);
    return next;
  }, []);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setReady(true);
      return;
    }

    let cancelled = false;
    refreshUser().finally(() => {
      if (!cancelled) setReady(true);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setUser(null);
      } else if (event === "SIGNED_IN" || event === "USER_UPDATED") {
        // Defer Supabase calls out of the auth callback (deadlock guard).
        setTimeout(() => void refreshUser(), 0);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [refreshUser]);

  const sendCode = useCallback(
    async (email: string, opts?: { create?: boolean }): Promise<AuthResult> => {
      const supabase = getSupabase();
      if (!supabase) return { error: NOT_CONFIGURED };
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { shouldCreateUser: opts?.create ?? false },
      });
      if (error) {
        if (/signups not allowed/i.test(error.message)) {
          return { error: "No account found for that email — register first." };
        }
        return { error: error.message };
      }
      return {};
    },
    []
  );

  const verifyCode = useCallback(
    async (email: string, code: string): Promise<AuthResult> => {
      const supabase = getSupabase();
      if (!supabase) return { error: NOT_CONFIGURED };
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: code.trim(),
        type: "email",
      });
      if (error) {
        return {
          error: /expired|invalid/i.test(error.message)
            ? "That code is invalid or has expired — request a new one."
            : error.message,
        };
      }
      await refreshUser();
      return {};
    },
    [refreshUser]
  );

  const signInWithGoogle = useCallback(async (): Promise<AuthResult> => {
    const supabase = getSupabase();
    if (!supabase) return { error: NOT_CONFIGURED };
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/auth/callback` },
    });
    return error ? { error: error.message } : {};
  }, []);

  const updateProfile = useCallback(
    async (input: {
      nickname?: string;
      birthDate?: string | null;
    }): Promise<AuthResult> => {
      const supabase = getSupabase();
      if (!supabase) return { error: NOT_CONFIGURED };
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();
      if (!authUser) return { error: "You need to be signed in." };

      const patch: Partial<Pick<ProfileRow, "nickname" | "birth_date">> = {};
      if (input.nickname !== undefined) patch.nickname = input.nickname.trim();
      if (input.birthDate !== undefined) patch.birth_date = input.birthDate;

      const { error } = await supabase
        .from("profiles")
        .update(patch)
        .eq("id", authUser.id);
      if (error) {
        if (error.code === "23505") {
          return { error: "That nickname is taken — try another." };
        }
        if (error.code === "23514") {
          return {
            error:
              "Nickname must be 2–24 characters: letters, numbers, spaces, . _ -",
          };
        }
        return { error: error.message };
      }
      await refreshUser();
      return {};
    },
    [refreshUser]
  );

  const logout = useCallback(async () => {
    const supabase = getSupabase();
    setUser(null);
    if (supabase) await supabase.auth.signOut();
  }, []);

  const value = useMemo(
    () => ({
      user,
      ready,
      configured: isSupabaseConfigured,
      sendCode,
      verifyCode,
      signInWithGoogle,
      updateProfile,
      logout,
    }),
    [user, ready, sendCode, verifyCode, signInWithGoogle, updateProfile, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
