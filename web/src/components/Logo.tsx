import Link from "next/link";

// A compact knight silhouette used as the brand mark. `currentColor` so it can
// sit on light (gold) or dark (paper) surfaces.
export function KnightMark({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={className}
      fill="currentColor"
      aria-hidden="true"
    >
      <path d="M20.4 6.2c.9 1 .8 2.3.4 3.6 2.8.3 5.6 1.4 7.9 3.6 3.6 3.4 5.2 8.3 5.7 13.2.5 4.9.2 9.9.2 14.8H12.7c-.5-2.9.3-5.6 2.2-7.8 1.8-2.1 4.2-3.6 6.2-5.5 1.3-1.2 2.6-2.7 2.6-4.6 0-.9-.5-1.9-1.4-2.1-1 .5-1.6 1.6-2.6 2.2-1.6 1-3.9.9-5.3-.5-1.2-1.1-1.6-2.9-1.2-4.5.7-2.8 3-4.8 5.4-6.2-1-.7-2.2-1.1-3-2.1-.6-.8-.5-2 .3-2.6.8-.6 1.9-.3 2.6.2-.2-1.2-.2-2.6.7-3.5.6-.6 1.6-.6 2.2 0z" />
    </svg>
  );
}

export function Logo({
  tone = "dark",
  className = "",
}: {
  /** "dark" = ink wordmark for light pages; "light" = paper wordmark for dark pages. */
  tone?: "dark" | "light";
  className?: string;
}) {
  return (
    <Link
      href="/"
      className={`group inline-flex items-center gap-2.5 ${className}`}
      aria-label="PyChess — home"
    >
      <KnightMark className="h-7 w-7 text-gold transition-transform group-hover:-translate-y-0.5" />
      <span
        className={`text-lg font-extrabold tracking-tight ${
          tone === "light" ? "text-paper" : "text-ink"
        }`}
      >
        PyChess
      </span>
    </Link>
  );
}
