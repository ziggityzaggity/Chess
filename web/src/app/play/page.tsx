import Link from "next/link";
import { KnightMark } from "@/components/Logo";

const MODES = [
  {
    href: "/play/local",
    title: "Local game",
    subtitle: "Pass and play on this device",
    icon: <KnightMark className="h-6 w-6" />,
  },
  {
    href: "/play/friend",
    title: "Play a friend",
    subtitle: "Start or join a private game",
    icon: <PersonIcon className="h-6 w-6" />,
  },
  {
    href: "/play/bot",
    title: "Play the bot",
    subtitle: "Try to beat one of our bots",
    icon: <RookIcon className="h-6 w-6" />,
  },
];

export default function NewGamePage() {
  return (
    <main className="mx-auto max-w-6xl px-4 py-10 sm:px-6 sm:py-14">
      <h1 className="text-4xl font-black tracking-tight text-ink sm:text-5xl">
        Start a new game
      </h1>
      <p className="mt-3 text-base text-muted">Choose how you want to play.</p>
      <div className="mt-9 grid gap-4 sm:grid-cols-3">
        {MODES.map((mode) => (
          <Link
            key={mode.href}
            href={mode.href}
            className="group flex flex-col items-start rounded-2xl border border-line bg-surface p-5 shadow-card transition hover:border-gold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
          >
            <span className="text-gold">{mode.icon}</span>
            <h2 className="mt-4 text-base font-bold text-ink">{mode.title}</h2>
            <p className="mt-1 text-sm text-muted">{mode.subtitle}</p>
            <span
              aria-hidden="true"
              className="mt-auto pt-6 text-sm font-semibold text-gold-600"
            >
              Continue{" "}
              <span className="inline-block transition-transform group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>
        ))}
      </div>
    </main>
  );
}

function PersonIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21c1.5-4 4-6 7-6s5.5 2 7 6" />
    </svg>
  );
}

function RookIcon({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M6 4h2v2h2V4h4v2h2V4h2v5l-2 2v5l1 4H7l1-4v-5L6 9z" />
      <rect x="5" y="20" width="14" height="2" rx="1" />
    </svg>
  );
}
