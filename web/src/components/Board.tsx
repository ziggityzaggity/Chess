"use client";

import { FILES, pieceSrc } from "@/lib/pieces";
import type { GameSnapshot } from "@/lib/useChessGame";

interface BoardProps {
  snapshot: GameSnapshot;
  selected: number;
  legalTargets: number[];
  flipped: boolean;
  onSquareClick: (square: number) => void;
  showCoordinates?: boolean;
  highlightLastMove?: boolean;
}

export function Board({
  snapshot,
  selected,
  legalTargets,
  flipped,
  onSquareClick,
  showCoordinates = true,
  highlightLastMove = true,
}: BoardProps) {
  const cells = [];

  for (let vis = 0; vis < 64; vis++) {
    const sq = flipped ? 63 - vis : vis;
    const row = sq >> 3;
    const col = sq & 7;
    const visRow = vis >> 3;
    const visCol = vis & 7;
    const isLight = ((row + col) & 1) === 0;

    const glyph = snapshot.board[sq];
    const src = pieceSrc(glyph);

    const isSelected = sq === selected;
    const isLastMove =
      highlightLastMove &&
      (sq === snapshot.lastFrom || sq === snapshot.lastTo);
    const isCheck = sq === snapshot.checkSquare;
    const isTarget = legalTargets.includes(sq);
    const isCapture = isTarget && glyph !== ".";

    const labelColor = isLight ? "text-board-dark/70" : "text-board-light/80";

    cells.push(
      <button
        key={vis}
        type="button"
        onClick={() => onSquareClick(sq)}
        aria-label={`${FILES[col]}${8 - row}`}
        className={`relative flex items-center justify-center ${
          isLight ? "bg-board-light" : "bg-board-dark"
        } transition-[background-color] focus:outline-none`}
      >
        {/* last-move + selection highlights */}
        {isLastMove && <span className="absolute inset-0 bg-amber-300/45" />}
        {isSelected && <span className="absolute inset-0 bg-amber-300/60" />}
        {isCheck && (
          <span className="absolute inset-0 bg-red-500/40 [box-shadow:inset_0_0_22px_6px_rgba(239,68,68,0.55)]" />
        )}

        {/* coordinate guides (lichess-style corner labels) */}
        {showCoordinates && visCol === 0 && (
          <span
            className={`pointer-events-none absolute left-0.5 top-0.5 text-[9px] font-bold sm:text-[11px] ${labelColor}`}
          >
            {8 - row}
          </span>
        )}
        {showCoordinates && visRow === 7 && (
          <span
            className={`pointer-events-none absolute bottom-0 right-0.5 text-[9px] font-bold sm:text-[11px] ${labelColor}`}
          >
            {FILES[col]}
          </span>
        )}

        {/* legal-move markers */}
        {isTarget &&
          (isCapture ? (
            <span className="absolute inset-[7%] rounded-full border-[6px] border-black/25" />
          ) : (
            <span className="absolute h-[30%] w-[30%] rounded-full bg-black/25" />
          ))}

        {/* the piece */}
        {src && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={src}
            alt={glyph}
            draggable={false}
            className="pointer-events-none relative z-10 h-[80%] w-[80%] object-contain drop-shadow-[0_2px_2px_rgba(0,0,0,0.35)]"
          />
        )}
      </button>
    );
  }

  return (
    <div className="aspect-square w-full select-none touch-none overflow-hidden rounded-2xl shadow-board ring-1 ring-black/50">
      <div className="grid h-full w-full grid-cols-8 grid-rows-8">{cells}</div>
    </div>
  );
}
