"use client";

import { AuthProvider } from "@/lib/auth";
import { SettingsProvider } from "@/lib/settings";

// Client-side context providers, mounted once at the root so every page shares
// the same mock-auth session and board settings.
export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <SettingsProvider>{children}</SettingsProvider>
    </AuthProvider>
  );
}
