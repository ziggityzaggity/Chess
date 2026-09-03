"use client";

// Mock, client-only "auth" state. There is NO real authentication here — the
// login page never verifies anything. This context exists purely so the UI can
// demonstrate the logged-in experience: the navbar swaps the "Log in" button
// for a profile avatar, and pages can greet the user by name. State is kept in
// localStorage so a refresh preserves the demo session.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface User {
  name: string;
  email: string;
  initials: string;
  birthDate?: string; // ISO date (YYYY-MM-DD), optional — collected at onboarding
}

const STORAGE_KEY = "pychess:user";

function initialsFor(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface AuthContextValue {
  user: User | null;
  /** True once we've read localStorage, so the navbar doesn't flash. */
  ready: boolean;
  login: (input?: { name?: string; email?: string; birthDate?: string }) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setUser(JSON.parse(raw) as User);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, []);

  const login = useCallback(
    (input?: { name?: string; email?: string; birthDate?: string }) => {
    const email = input?.email?.trim() || "player@example.com";
    const name =
      input?.name?.trim() ||
      // Derive a friendly name from the email local-part when none is given.
      email
        .split("@")[0]
        .replace(/[._-]+/g, " ")
        .replace(/\b\w/g, (c) => c.toUpperCase());
    const next: User = {
      name,
      email,
      initials: initialsFor(name),
      birthDate: input?.birthDate?.trim() || undefined,
    };
    setUser(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  const value = useMemo(
    () => ({ user, ready, login, logout }),
    [user, ready, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
