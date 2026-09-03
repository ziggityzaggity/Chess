import Link from "next/link";

export default function HomePage() {
  return (
    <main className="mx-auto grid min-h-[calc(100vh-4rem)] max-w-6xl items-center px-4 py-12 sm:px-6">
      <section className="grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
        {/* Left — headline + calls to action */}
        <div className="animate-fade-in">
          <h1 className="text-5xl font-black leading-[0.95] tracking-tight text-ink sm:text-6xl lg:text-7xl">
            Play with
            <br />
            purpose.
          </h1>
          <p className="mt-6 max-w-md text-lg leading-relaxed text-muted">
            A focused place to play, learn, and understand the game one move at a
            time.
          </p>

          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link
              href="/play"
              className="rounded-full bg-ink px-7 py-3.5 text-base font-semibold text-paper shadow-card transition hover:bg-ink-800"
            >
              Start new game
            </Link>
            <Link
              href="/assistant"
              className="rounded-full border border-line bg-white px-7 py-3.5 text-base font-semibold text-ink transition hover:border-ink/20 hover:bg-paper-50"
            >
              Chess assistant
            </Link>
          </div>
        </div>

        {/* Right — decorative composition */}
        <HeroArt />
      </section>
    </main>
  );
}

// Two overlapping warm discs with a bold king and an outlined pawn — a flat,
// calm echo of the reference art. Purely decorative.
function HeroArt() {
  return (
    <div className="relative mx-auto hidden aspect-square w-full max-w-md lg:block">
      <div className="absolute left-2 top-6 h-[78%] w-[78%] rounded-full bg-paper-300" />
      <div className="absolute right-2 top-0 h-[55%] w-[55%] rounded-full bg-gold/25" />
      <svg
        viewBox="0 0 200 200"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {/* King — filled ink silhouette */}
        <g fill="#1d1b17">
          <rect x="72" y="150" width="56" height="12" rx="3" />
          <path d="M78 150c-4-14-8-24-8-33 0-12 9-19 20-19h20c11 0 20 7 20 19 0 9-4 19-8 33z" />
          <path d="M96 78h8v-8h-8zM88 68h24v9H88z" />
          <path d="M96 58h8v22h-8z" />
          <path d="M92 50h16v9H92z" />
        </g>
        {/* Pawn — outlined */}
        <g
          transform="translate(126 92) scale(0.62)"
          fill="none"
          stroke="#1d1b17"
          strokeWidth="7"
          strokeLinejoin="round"
        >
          <circle cx="34" cy="26" r="17" />
          <path d="M20 44h28c8 10 12 22 14 42H6c2-20 6-32 14-42z" />
        </g>
      </svg>
    </div>
  );
}
