import Link from "next/link";
import { StaticBoard, START_BOARD } from "@/components/StaticBoard";

const FEATURES = [
  {
    title: "Native-speed engine",
    body: "The move generator is hand-written C++ compiled to WebAssembly — perft-verified for correctness and fast enough to feel instant.",
    icon: (
      <path d="M13 2L4.5 13H11l-1 9 8.5-11H12l1-9z" />
    ),
  },
  {
    title: "Every rule, handled",
    body: "Castling, en passant, under-promotion, check and mate — plus draws by stalemate, the 50-move rule, threefold repetition and insufficient material.",
    icon: (
      <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6l7-3zM9.5 12l2 2 3.5-4" />
    ),
  },
  {
    title: "Runs in your browser",
    body: "No server, no account, no network round-trips. The whole engine is a tiny WebAssembly module — load it once and keep playing offline.",
    icon: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M3 12h18M12 3c2.5 2.5 3.8 5.6 3.8 9S14.5 18.5 12 21c-2.5-2.5-3.8-5.6-3.8-9S9.5 5.5 12 3z" />
      </>
    ),
  },
];

export default function HomePage() {
  return (
    <main>
      {/* Hero */}
      <section className="mx-auto max-w-6xl px-4 pb-16 pt-12 sm:px-6 sm:pt-20">
        <div className="grid items-center gap-12 lg:grid-cols-2">
          <div className="animate-fade-in">
            <span className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-brand-400">
              C++ · WebAssembly
            </span>
            <h1 className="mt-5 text-4xl font-black leading-[1.05] tracking-tight text-white sm:text-6xl">
              Chess that runs
              <br />
              at{" "}
              <span className="bg-gradient-to-r from-brand-400 to-emerald-600 bg-clip-text text-transparent">
                native speed
              </span>
              .
            </h1>
            <p className="mt-6 max-w-md text-lg leading-relaxed text-slate-300">
              A complete chess engine written in C++ and compiled to WebAssembly,
              wrapped in a clean, responsive board. Open the page and play — no
              install, no server, no waiting.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="/play"
                className="inline-flex items-center gap-2 rounded-xl bg-brand-500 px-6 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-brand-400 hover:shadow-emerald-500/40"
              >
                Play now
                <span aria-hidden>→</span>
              </Link>
              <Link
                href="/play"
                className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-6 py-3 text-base font-semibold text-slate-200 transition hover:bg-white/10"
              >
                New game
              </Link>
            </div>
          </div>

          <div className="relative animate-fade-in">
            <div className="absolute -inset-6 -z-10 rounded-[2rem] bg-gradient-to-tr from-brand-500/20 via-emerald-500/5 to-sky-500/10 blur-2xl" />
            <div className="mx-auto w-full max-w-md">
              <StaticBoard board={START_BOARD} />
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div
              key={f.title}
              className="group rounded-2xl border border-white/10 bg-white/[0.03] p-6 transition hover:border-brand-400/40 hover:bg-white/[0.05]"
            >
              <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-500/10 text-brand-400 ring-1 ring-inset ring-brand-400/20">
                <svg
                  viewBox="0 0 24 24"
                  className="h-6 w-6"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.7"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  {f.icon}
                </svg>
              </div>
              <h3 className="mt-4 text-lg font-bold text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-slate-400">
                {f.body}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* CTA band */}
      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
        <div className="relative overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-slate-900 to-slate-950 px-6 py-14 text-center">
          <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-500/10 blur-3xl" />
          <h2 className="relative text-3xl font-black tracking-tight text-white sm:text-4xl">
            Ready to make your move?
          </h2>
          <p className="relative mx-auto mt-3 max-w-lg text-slate-300">
            Click-to-move, legal-move highlighting, undo/redo, board flip and a
            live move list — everything you need for a quick game.
          </p>
          <Link
            href="/play"
            className="relative mt-8 inline-flex items-center gap-2 rounded-xl bg-brand-500 px-7 py-3 text-base font-semibold text-slate-950 shadow-lg shadow-emerald-500/25 transition hover:bg-brand-400"
          >
            Start playing
            <span aria-hidden>→</span>
          </Link>
        </div>
      </section>

      <footer className="border-t border-white/5">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-2 px-4 py-8 text-sm text-slate-500 sm:flex-row sm:px-6">
          <p>Gambit — a C++ chess core, compiled to WebAssembly.</p>
          <p>Built with Next.js &amp; Tailwind CSS.</p>
        </div>
      </footer>
    </main>
  );
}
