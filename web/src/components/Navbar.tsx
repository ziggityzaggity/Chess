"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";

const LINKS = [
  { href: "/play", label: "Play", match: ["/play", "/game"] },
  { href: "/assistant", label: "Assistant", match: ["/assistant"] },
  { href: "/settings", label: "Settings", match: ["/settings"] },
];

export function Navbar() {
  const pathname = usePathname();
  const { user, ready } = useAuth();

  // The live game screen is a full-bleed dark surface with its own header.
  if (pathname === "/game") return null;

  return (
    <header className="sticky top-0 z-30 border-b border-line/70 bg-paper/85 backdrop-blur-md">
      <nav className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
        <Logo />

        <div className="flex items-center gap-1 sm:gap-6">
          <div className="hidden items-center gap-1 sm:flex sm:gap-6">
            {LINKS.map((link) => {
              const active = link.match.some((m) => pathname.startsWith(m));
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-sm transition-colors ${
                    active
                      ? "font-semibold text-ink"
                      : "font-medium text-muted hover:text-ink"
                  }`}
                >
                  {link.label}
                </Link>
              );
            })}
          </div>

          {/* Auth slot: swaps between "Log in" and the profile avatar. */}
          <div className="flex items-center">
            {!ready ? (
              <div className="h-9 w-9 rounded-full bg-ink/5" />
            ) : user ? (
              <ProfileMenu />
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/register"
                  className="rounded-full border border-ink/15 px-4 py-2 text-sm font-semibold text-ink transition hover:bg-ink/5 sm:px-5"
                >
                  Register
                </Link>
                <Link
                  href="/login"
                  className="rounded-full bg-ink px-4 py-2 text-sm font-semibold text-paper transition hover:bg-ink-800 sm:px-5"
                >
                  Log in
                </Link>
              </div>
            )}
          </div>
        </div>
      </nav>
    </header>
  );
}

function ProfileMenu() {
  const { user, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!user) return null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        className="grid h-9 w-9 place-items-center rounded-full bg-gold text-sm font-bold text-white ring-2 ring-transparent transition hover:ring-gold/30"
      >
        {user.initials}
      </button>

      {open && (
        <div
          role="menu"
          className="animate-pop-in absolute right-0 mt-2 w-56 overflow-hidden rounded-2xl border border-line bg-white shadow-pop"
        >
          <div className="border-b border-line px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
          </div>
          <MenuItem onClick={() => { setOpen(false); router.push("/play"); }}>
            New game
          </MenuItem>
          <MenuItem onClick={() => { setOpen(false); router.push("/settings"); }}>
            Settings
          </MenuItem>
          <div className="border-t border-line">
            <MenuItem
              onClick={() => {
                setOpen(false);
                logout();
                router.push("/");
              }}
              danger
            >
              Log out
            </MenuItem>
          </div>
        </div>
      )}
    </div>
  );
}

function MenuItem({
  children,
  onClick,
  danger = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`block w-full px-4 py-2.5 text-left text-sm font-medium transition hover:bg-paper-100 ${
        danger ? "text-red-600" : "text-ink-700"
      }`}
    >
      {children}
    </button>
  );
}
