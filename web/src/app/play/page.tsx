"use client";

import { useEffect, useMemo, useRef } from "react";
import { Board } from "@/components/Board";
import { PromotionModal } from "@/components/PromotionModal";
import { useChessGame, type GameSnapshot } from "@/lib/useChessGame";

const RESULT = ["", "White wins", "Black wins", "Draw"];
const DRAW = [
  "",
  "stalemate",
  "the 50-move rule",
  "threefold repetition",
  "insufficient material",
];

interface MoveRow {
  no: number;
  white?: string;
  black?: string;
}

// Turn the engine's SAN movetext ("1. e4 e5 2. Nf3 ...") into table rows.
function parsePgn(pgn: string): MoveRow[] {
  const tokens = pgn.trim().split(/\s+/).filter(Boolean);
  const rows: MoveRow[] = [];
  let current: MoveRow | null = null;
  for (const token of tokens) {
    const numbered = token.match(/^(\d+)\.(\.\.)?$/);
    if (numbered) {
      current = { no: parseInt(numbered[1], 10) };
      if (numbered[2]) current.white = "…"; // black-to-move start position
      rows.push(current);
      continue;
    }
    if (!current) {
      current = { no: rows.length + 1 };
      rows.push(current);
    }
    if (current.white === undefined) current.white = token;
    else if (current.black === undefined) current.black = token;
  }
  return rows;
}

function statusText(s: GameSnapshot): string {
  if (s.gameOver) {
    if (s.result === 3) return `Draw by ${DRAW[s.drawReason] ?? "agreement"}`;
    const base = RESULT[s.result] || "Game over";
    return s.isCheckmate ? `${base} by checkmate` : base;
  }
  const side = s.turn === 0 ? "White" : "Black";
  return s.inCheck ? `${side} to move — check!` : `${side} to move`;
}

export default function PlayPage() {
  const game = useChessGame();

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        {/* Board column */}
        <div className="mx-auto w-full max-w-[640px]">
          {game.status === "ready" && game.snapshot ? (
            <Board
              snapshot={game.snapshot}
              selected={game.selected}
              legalTargets={game.legalTargets}
              flipped={game.flipped}
              onSquareClick={game.onSquareClick}
            />
          ) : (
            <BoardPlaceholder
              status={game.status}
              error={game.error}
            />
          )}
        </div>

        {/* Side panel */}
        <SidePanel game={game} />
      </div>

      {game.promotion && (
        <PromotionModal
          promotion={game.promotion}
          onChoose={game.choosePromotion}
          onCancel={game.cancelPromotion}
        />
      )}
    </main>
  );
}

function SidePanel({ game }: { game: ReturnType<typeof useChessGame> }) {
  const { snapshot, status } = game;
  const ready = status === "ready" && snapshot !== null;

  const rows = useMemo(
    () => (snapshot ? parsePgn(snapshot.pgn) : []),
    [snapshot]
  );

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [snapshot?.ply]);

  const gameOver = ready && snapshot!.gameOver;
  const turnWhite = ready && snapshot!.turn === 0;

  return (
    <aside className="flex flex-col gap-4">
      {/* Status card */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-white/20 ${
              !ready
                ? "bg-slate-600"
                : gameOver
                  ? "bg-brand-400"
                  : turnWhite
                    ? "bg-white"
                    : "bg-slate-900"
            }`}
          />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-white">
              {ready
                ? statusText(snapshot!)
                : status === "error"
                  ? "Engine unavailable"
                  : "Loading engine…"}
            </p>
            <p className="text-xs text-slate-400">
              {ready ? `Move ${Math.floor(snapshot!.ply / 2) + 1} · ${snapshot!.ply} ply` : "C++ · WebAssembly"}
            </p>
          </div>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-2 gap-2">
        <ControlButton onClick={game.newGame} disabled={!ready} primary>
          New game
        </ControlButton>
        <ControlButton onClick={game.flip} disabled={!ready}>
          Flip board
        </ControlButton>
        <ControlButton
          onClick={game.undo}
          disabled={!ready || !snapshot!.canUndo}
        >
          ↶ Undo
        </ControlButton>
        <ControlButton
          onClick={game.redo}
          disabled={!ready || !snapshot!.canRedo}
        >
          Redo ↷
        </ControlButton>
      </div>

      {/* Move list */}
      <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
        <div className="border-b border-white/10 px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400">
          Moves
        </div>
        <div
          ref={listRef}
          className="scroll-slim h-64 overflow-y-auto px-2 py-2 lg:h-[360px]"
        >
          {rows.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-slate-500">
              No moves yet — make the first move.
            </p>
          ) : (
            <ol className="text-sm">
              {rows.map((row) => (
                <li
                  key={row.no}
                  className="grid grid-cols-[2rem_1fr_1fr] items-center gap-1 rounded-md px-2 py-1 odd:bg-white/[0.02]"
                >
                  <span className="text-xs font-semibold text-slate-500">
                    {row.no}.
                  </span>
                  <span className="font-medium text-slate-200">
                    {row.white ?? ""}
                  </span>
                  <span className="font-medium text-slate-200">
                    {row.black ?? ""}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </aside>
  );
}

function ControlButton({
  children,
  onClick,
  disabled,
  primary = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-xl px-3 py-2.5 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? "bg-brand-500 text-slate-950 shadow-lg shadow-emerald-500/20 enabled:hover:bg-brand-400"
          : "border border-white/10 bg-white/5 text-slate-200 enabled:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function BoardPlaceholder({
  status,
  error,
}: {
  status: string;
  error: string | null;
}) {
  return (
    <div className="grid aspect-square w-full place-items-center rounded-2xl border border-white/10 bg-white/[0.02] p-8 text-center">
      {status === "error" ? (
        <div className="max-w-sm">
          <p className="text-base font-semibold text-red-400">
            Couldn&apos;t load the chess engine
          </p>
          <p className="mt-2 text-sm text-slate-400">
            The WebAssembly module isn&apos;t available. Build it from the repo
            root and restart the dev server:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-slate-900 p-3 text-left text-xs text-slate-300">
            emcmake cmake -S . -B build-web -G Ninja{"\n"}cmake --build build-web
          </pre>
          {error && (
            <p className="mt-3 text-xs text-slate-500">Details: {error}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-slate-400">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-brand-400" />
          <p className="text-sm font-medium">Loading engine…</p>
        </div>
      )}
    </div>
  );
}
