"use client";

import { pieceSrc } from "@/lib/pieces";
import type { PendingPromotion, PromoPiece } from "@/lib/useChessGame";

const PIECES: PromoPiece[] = ["q", "r", "b", "n"];
const LABELS: Record<PromoPiece, string> = {
  q: "Queen",
  r: "Rook",
  b: "Bishop",
  n: "Knight",
};

export function PromotionModal({
  promotion,
  onChoose,
  onCancel,
}: {
  promotion: PendingPromotion;
  onChoose: (piece: PromoPiece) => void;
  onCancel: () => void;
}) {
  const white = promotion.color === 0;

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-ink/60 p-4 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="animate-pop-in rounded-2xl border border-line bg-white p-5 shadow-pop"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="mb-3 text-center text-sm font-semibold text-muted">
          Promote to…
        </p>
        <div className="flex gap-3">
          {PIECES.map((p) => {
            const glyph = white ? p.toUpperCase() : p;
            const src = pieceSrc(glyph);
            return (
              <button
                key={p}
                type="button"
                onClick={() => onChoose(p)}
                aria-label={LABELS[p]}
                className="grid h-16 w-16 place-items-center rounded-xl bg-paper-100 ring-1 ring-line transition hover:bg-paper-200 hover:ring-gold"
              >
                {src && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={src} alt={LABELS[p]} className="h-12 w-12 object-contain" />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
