"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Board } from "@/components/Board";
import { PromotionModal } from "@/components/PromotionModal";
import { Logo } from "@/components/Logo";
import { useAuth } from "@/lib/auth";
import { useSettings } from "@/lib/settings";
import { toMoveRows } from "@/lib/pgn";
import { useChessGame, type GameSnapshot } from "@/lib/useChessGame";

const DRAW = [
  "",
  "stalemate",
  "the 50-move rule",
  "threefold repetition",
  "insufficient material",
];

interface Over {
  result: number; // 1 white, 2 black, 3 draw
  label: string;
}

export default function GamePage() {
  return (
    <Suspense fallback={<GameShell><LoadingBoard /></GameShell>}>
      <GameScreen />
    </Suspense>
  );
}

function GameScreen() {
  const params = useSearchParams();
  const mode = params.get("mode") === "bot" ? "bot" : "local";
  const minutes = clampMinutes(Number(params.get("min")));

  const { settings } = useSettings();
  const { user } = useAuth();
  const game = useChessGame({ mode, botColor: 1 });
  const { snapshot } = game;

  // --- clocks (local, display-only) --------------------------------------
  const [resetToken, setResetToken] = useState(0);
  const [whiteSec, setWhiteSec] = useState(minutes * 60);
  const [blackSec, setBlackSec] = useState(minutes * 60);
  const [clockFlag, setClockFlag] = useState<Over | null>(null);

  useEffect(() => {
    setWhiteSec(minutes * 60);
    setBlackSec(minutes * 60);
    setClockFlag(null);
  }, [minutes, resetToken]);

  const engineOver = snapshot?.gameOver ? engineOverLabel(snapshot) : null;
  const over: Over | null = engineOver ?? game.manualResult ?? clockFlag;

  const reviewing = !!snapshot?.canRedo;
  const clockRunning =
    game.status === "ready" &&
    !!snapshot &&
    !over &&
    !reviewing &&
    (snapshot.ply > 0 || mode === "bot"); // don't burn time before move 1 in local

  useEffect(() => {
    if (!clockRunning || !snapshot) return;
    const whiteToMove = snapshot.turn === 0;
    const id = window.setInterval(() => {
      if (whiteToMove) setWhiteSec((s) => Math.max(0, s - 1));
      else setBlackSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(id);
  }, [clockRunning, snapshot]);

  useEffect(() => {
    if (clockFlag || over) return;
    if (whiteSec <= 0) setClockFlag({ result: 2, label: "White out of time" });
    else if (blackSec <= 0)
      setClockFlag({ result: 1, label: "Black out of time" });
  }, [whiteSec, blackSec, clockFlag, over]);

  function newGame() {
    game.newGame();
    setResetToken((t) => t + 1);
  }

  const blocked = !!over;
  function onSquare(sq: number) {
    if (blocked) return;
    game.onSquareClick(sq);
  }

  // --- players -----------------------------------------------------------
  const you = {
    name: mode === "bot" ? user?.name ?? "You" : "White",
    tag: mode === "bot" ? "You" : "Pass-and-play",
    initials: user?.initials,
  };
  const opponent = {
    name: mode === "bot" ? "PyChess Bot" : "Black",
    tag: mode === "bot" ? "Level 1 · greedy" : "Pass-and-play",
    initials: undefined as string | undefined,
  };

  const whiteToMove = snapshot?.turn === 0;

  return (
    <GameShell onNewGame={newGame} onFlip={game.flip} status={game.status}>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* Board + players */}
        <div
          className="mx-auto flex w-full flex-col gap-3"
          style={{ maxWidth: "min(620px, calc(100dvh - 210px))" }}
        >
          <PlayerBar
            player={opponent}
            seconds={blackSec}
            active={clockRunning && !whiteToMove}
            icon={mode === "bot" ? <BotIcon /> : undefined}
          />

          <div className="relative">
            {game.status === "ready" && snapshot ? (
              <Board
                snapshot={snapshot}
                selected={game.selected}
                legalTargets={game.legalTargets}
                flipped={game.flipped}
                onSquareClick={onSquare}
                showCoordinates={settings.showCoordinates}
                highlightLastMove={settings.highlightLastMove}
              />
            ) : (
              <LoadingBoard error={game.status === "error" ? game.error : null} />
            )}

            {over && (
              <div className="absolute inset-0 z-20 grid place-items-center rounded-2xl bg-night/70 backdrop-blur-sm">
                <div className="animate-pop-in rounded-2xl bg-white px-8 py-6 text-center shadow-pop">
                  <p className="text-xs font-bold uppercase tracking-wider text-gold-600">
                    {over.result === 3 ? "Draw" : "Game over"}
                  </p>
                  <p className="mt-1 text-xl font-black text-ink">{over.label}</p>
                  <button
                    type="button"
                    onClick={newGame}
                    className="mt-4 rounded-full bg-ink px-6 py-2.5 text-sm font-bold text-paper transition hover:bg-ink-800"
                  >
                    New game
                  </button>
                </div>
              </div>
            )}
          </div>

          <PlayerBar
            player={you}
            seconds={whiteSec}
            active={clockRunning && whiteToMove}
          />
        </div>

        {/* Moves panel */}
        <MovesPanel game={game} over={over} onNewGame={newGame} />
      </div>

      {game.promotion && (
        <PromotionModal
          promotion={game.promotion}
          onChoose={game.choosePromotion}
          onCancel={game.cancelPromotion}
        />
      )}
    </GameShell>
  );
}

// --- shell (dark chrome shared with the Suspense fallback) ----------------
function GameShell({
  children,
  onNewGame,
  onFlip,
  status,
}: {
  children: React.ReactNode;
  onNewGame?: () => void;
  onFlip?: () => void;
  status?: string;
}) {
  return (
    <div className="min-h-screen bg-night text-paper">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Logo tone="light" />
        <div className="flex items-center gap-2 sm:gap-3">
          {onFlip && (
            <button
              type="button"
              onClick={onFlip}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-paper/80 transition hover:bg-white/10"
            >
              Flip
            </button>
          )}
          {onNewGame && (
            <button
              type="button"
              onClick={onNewGame}
              className="rounded-full border border-white/15 px-3 py-1.5 text-xs font-semibold text-paper/80 transition hover:bg-white/10"
            >
              New game
            </button>
          )}
          <span className="flex items-center gap-2 text-sm text-paper/70">
            <span
              className={`h-2 w-2 rounded-full ${
                status === "error"
                  ? "bg-red-400"
                  : status === "ready"
                    ? "bg-positive"
                    : "bg-gold animate-pulse"
              }`}
            />
            {status === "error"
              ? "Engine offline"
              : status === "ready"
                ? "Engine ready"
                : "Loading…"}
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pb-12 sm:px-6">{children}</main>
    </div>
  );
}

function PlayerBar({
  player,
  seconds,
  active,
  icon,
}: {
  player: { name: string; tag: string; initials?: string };
  seconds: number;
  active: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-full bg-white/10 text-sm font-bold text-paper">
          {icon ?? player.initials ?? <PawnIcon />}
        </span>
        <div>
          <p className="text-sm font-bold text-paper">{player.name}</p>
          <p className="text-xs text-paper/50">{player.tag}</p>
        </div>
      </div>
      <span
        className={`rounded-xl px-4 py-2 font-mono text-lg font-bold tabular-nums transition-colors ${
          active ? "bg-paper text-ink" : "bg-white/10 text-paper/70"
        }`}
      >
        {formatClock(seconds)}
      </span>
    </div>
  );
}

function MovesPanel({
  game,
  over,
  onNewGame,
}: {
  game: ReturnType<typeof useChessGame>;
  over: Over | null;
  onNewGame: () => void;
}) {
  const { snapshot } = game;
  const rows = useMemo(() => toMoveRows(game.sanHistory), [game.sanHistory]);
  const currentPly = snapshot?.ply ?? 0;

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (listRef.current)
      listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [game.sanHistory.length]);

  const status = turnStatus(game, over);

  return (
    <aside className="flex h-fit flex-col rounded-3xl bg-white text-ink shadow-pop lg:sticky lg:top-6">
      {/* Header */}
      <div className="flex items-center justify-between px-6 pt-6">
        <h2 className="text-xl font-bold">Moves</h2>
        <span
          className={`rounded-full px-3 py-1 text-xs font-bold ${status.tone}`}
        >
          {status.text}
        </span>
      </div>

      {/* Column labels */}
      <div className="mt-4 grid grid-cols-[2.5rem_1fr_1fr] px-6 text-[11px] font-bold uppercase tracking-wider text-muted">
        <span />
        <span className="px-2">White</span>
        <span className="px-2">Black</span>
      </div>

      {/* Move rows */}
      <div
        ref={listRef}
        className="scroll-slim mt-1 h-[300px] overflow-y-auto px-4 lg:h-[360px]"
      >
        {rows.length === 0 ? (
          <p className="px-2 py-10 text-center text-sm text-muted">
            No moves yet — make the first move.
          </p>
        ) : (
          <ol>
            {rows.map((row) => (
              <li
                key={row.no}
                className="grid grid-cols-[2.5rem_1fr_1fr] items-center rounded-lg py-0.5"
              >
                <span className="pl-2 text-xs font-semibold text-muted">
                  {row.no}.
                </span>
                <MoveButton
                  cell={row.white}
                  current={row.white?.ply === currentPly}
                  onClick={() => row.white && game.goToPly(row.white.ply)}
                />
                <MoveButton
                  cell={row.black}
                  current={row.black?.ply === currentPly}
                  onClick={() => row.black && game.goToPly(row.black.ply)}
                />
              </li>
            ))}
          </ol>
        )}
      </div>

      {/* Footer: navigation + actions */}
      <div className="border-t border-line px-6 py-4">
        <div className="flex items-center justify-center gap-1">
          <NavButton label="First" disabled={!snapshot?.canUndo} onClick={game.toStart}>
            ⏮
          </NavButton>
          <NavButton label="Previous" disabled={!snapshot?.canUndo} onClick={game.undo}>
            ◀
          </NavButton>
          <NavButton label="Next" disabled={!snapshot?.canRedo} onClick={game.redo}>
            ▶
          </NavButton>
          <NavButton label="Last" disabled={!snapshot?.canRedo} onClick={game.toEnd}>
            ⏭
          </NavButton>
        </div>

        <div className="mt-4 flex items-center justify-between">
          {over ? (
            <button
              type="button"
              onClick={onNewGame}
              className="w-full rounded-full bg-ink px-5 py-2.5 text-sm font-bold text-paper transition hover:bg-ink-800"
            >
              New game
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={game.agreeDraw}
                className="text-sm font-semibold text-muted transition hover:text-ink"
              >
                Offer draw
              </button>
              <button
                type="button"
                onClick={game.resign}
                className="text-sm font-bold text-gold-600 transition hover:text-gold"
              >
                Resign
              </button>
            </>
          )}
        </div>
      </div>
    </aside>
  );
}

function MoveButton({
  cell,
  current,
  onClick,
}: {
  cell?: { san: string; ply: number };
  current: boolean;
  onClick: () => void;
}) {
  if (!cell) return <span className="px-2" />;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`mx-1 rounded-md px-2 py-1 text-left text-sm font-semibold transition ${
        current ? "bg-gold/20 text-gold-600" : "text-ink-700 hover:bg-paper-100"
      }`}
    >
      {cell.san}
    </button>
  );
}

function NavButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="grid h-9 w-9 place-items-center rounded-lg text-muted transition hover:bg-paper-100 hover:text-ink disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function LoadingBoard({ error }: { error?: string | null }) {
  return (
    <div className="grid aspect-square w-full place-items-center rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
      {error ? (
        <div className="max-w-sm">
          <p className="text-base font-semibold text-red-300">
            Couldn&apos;t load the chess engine
          </p>
          <p className="mt-2 text-sm text-paper/60">
            The WebAssembly module isn&apos;t available. Build it from the repo
            root and restart the dev server:
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-black/40 p-3 text-left text-xs text-paper/70">
            emcmake cmake -S . -B build-web -G Ninja{"\n"}cmake --build build-web
          </pre>
        </div>
      ) : (
        <div className="flex flex-col items-center gap-3 text-paper/60">
          <span className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-gold" />
          <p className="text-sm font-medium">Loading engine…</p>
        </div>
      )}
    </div>
  );
}

// --- helpers --------------------------------------------------------------
function clampMinutes(n: number): number {
  return [3, 10, 30].includes(n) ? n : 3;
}

function formatClock(totalSeconds: number): string {
  const s = Math.max(0, totalSeconds);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function engineOverLabel(s: GameSnapshot): Over {
  if (s.result === 3)
    return { result: 3, label: `Draw by ${DRAW[s.drawReason] ?? "agreement"}` };
  const base = s.result === 1 ? "White wins" : "Black wins";
  return { result: s.result, label: s.isCheckmate ? `${base} · checkmate` : base };
}

function turnStatus(
  game: ReturnType<typeof useChessGame>,
  over: Over | null
): { text: string; tone: string } {
  if (over) return { text: "Game over", tone: "bg-ink text-paper" };
  const s = game.snapshot;
  if (!s) return { text: "Loading…", tone: "bg-paper-200 text-muted" };
  const check = s.inCheck ? " · check" : "";
  if (game.mode === "bot") {
    if (s.turn === game.botColor)
      return {
        text: (game.botThinking ? "Bot is thinking…" : "Bot to move") + check,
        tone: "bg-paper-200 text-muted",
      };
    return { text: "Your turn" + check, tone: "bg-gold/15 text-gold-600" };
  }
  return {
    text: (s.turn === 0 ? "White to move" : "Black to move") + check,
    tone: "bg-gold/15 text-gold-600",
  };
}

function PawnIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <path d="M12 3a3.2 3.2 0 0 0-2 5.7C8.7 9.5 8 11 8 12.7h8c0-1.7-.7-3.2-2-4A3.2 3.2 0 0 0 12 3zM7 20c.4-3 1.6-5 3-6h4c1.4 1 2.6 3 3 6z" />
    </svg>
  );
}

function BotIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden="true">
      <rect x="5" y="8" width="14" height="10" rx="3" />
      <path d="M12 3v3M9 13h.01M15 13h.01" stroke="#1b1916" strokeWidth="2" strokeLinecap="round" />
      <circle cx="12" cy="4" r="1.4" />
    </svg>
  );
}
