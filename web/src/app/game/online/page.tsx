"use client";

import { Suspense, useMemo } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Board } from "@/components/Board";
import { PromotionModal } from "@/components/PromotionModal";
import { Logo } from "@/components/Logo";
import { useSettings } from "@/lib/settings";
import { toMoveRows } from "@/lib/pgn";
import { useOnlineGame } from "@/lib/onlineGame";
import type { GameSnapshot } from "@/lib/useChessGame";

export default function OnlineGamePage() {
  return (
    <Suspense fallback={<Shell><Centered>Loading…</Centered></Shell>}>
      <OnlineGameScreen />
    </Suspense>
  );
}

function OnlineGameScreen() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const { settings } = useSettings();
  const game = useOnlineGame(id);
  const snap = game.snapshot;

  if (!id) return <Shell><Centered>No game specified.</Centered></Shell>;
  if (game.connection === "error") {
    return <Shell><Centered>{game.error ?? "Couldn't load this game."}</Centered></Shell>;
  }
  if (!snap || game.connection === "loading" || game.connection === "connecting") {
    return <Shell><Centered>Connecting to your game…</Centered></Shell>;
  }

  const flipped = snap.myColorIndex === 1;
  // <Board/> reads board/lastFrom/lastTo/checkSquare; the rest are unused here.
  const boardSnapshot: GameSnapshot = {
    board: snap.board,
    turn: snap.turn,
    inCheck: snap.checkSquare >= 0,
    checkSquare: snap.checkSquare,
    lastFrom: snap.lastFrom,
    lastTo: snap.lastTo,
    gameOver: snap.status === "finished",
    isCheckmate: false,
    result: 0,
    drawReason: 0,
    canUndo: false,
    canRedo: false,
    pgn: "",
    ply: snap.moveCount,
  };

  // Top = opponent, bottom = me.
  const topName = flipped ? snap.whiteName : snap.blackName;
  const bottomName = flipped ? snap.blackName : snap.whiteName;
  const topColorIdx = flipped ? 0 : 1;
  const topClock = topColorIdx === 0 ? snap.clockWhiteMs : snap.clockBlackMs;
  const bottomClock = topColorIdx === 0 ? snap.clockBlackMs : snap.clockWhiteMs;

  const over = snap.status === "finished" ? resultBanner(snap) : null;

  return (
    <Shell>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="mx-auto flex w-full flex-col gap-3" style={{ maxWidth: "min(620px, calc(100dvh - 210px))" }}>
          <PlayerBar name={topName} clockMs={topClock} active={snap.status === "active" && snap.turn === topColorIdx} />

          <div className="relative">
            <Board
              snapshot={boardSnapshot}
              selected={game.selected}
              legalTargets={game.legalTargets}
              flipped={flipped}
              onSquareClick={game.onSquareClick}
              showCoordinates={settings.showCoordinates}
              highlightLastMove={settings.highlightLastMove}
            />

            {snap.status === "waiting" && (
              <div className="absolute inset-0 z-20 grid place-items-center rounded-2xl bg-night/70 backdrop-blur-sm">
                <div className="rounded-2xl bg-surface px-8 py-6 text-center shadow-pop">
                  <p className="text-xs font-bold uppercase tracking-wider text-gold-600">Private game</p>
                  <p className="mt-1 text-lg font-black text-ink">Waiting for your friend…</p>
                  <p className="mt-2 text-sm text-muted">The game begins as soon as they join.</p>
                </div>
              </div>
            )}

            {over && (
              <div className="absolute inset-0 z-20 grid place-items-center rounded-2xl bg-night/70 backdrop-blur-sm">
                <div className="animate-pop-in rounded-2xl bg-surface px-8 py-6 text-center shadow-pop">
                  <p className="text-xs font-bold uppercase tracking-wider text-gold-600">{over.kicker}</p>
                  <p className="mt-1 text-xl font-black text-ink">{over.label}</p>
                  <Link href="/play" className="mt-4 inline-block rounded-full bg-ink px-6 py-2.5 text-sm font-bold text-paper transition hover:bg-ink-800">
                    Back to play
                  </Link>
                </div>
              </div>
            )}

            {game.pending && (
              <div className="pointer-events-none absolute inset-x-0 bottom-2 z-10 text-center text-xs font-semibold text-night-foreground/70">
                Sending move…
              </div>
            )}
          </div>

          <PlayerBar name={`${bottomName} (you)`} clockMs={bottomClock} active={snap.status === "active" && snap.turn !== topColorIdx} />
        </div>

        {/* Side panel */}
        <aside className="flex min-h-[300px] flex-col rounded-2xl border border-night-foreground/10 bg-night-foreground/5 p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wider text-night-foreground/60">Moves</h2>
            <span className="text-xs font-semibold text-night-foreground/50">
              {snap.status === "active"
                ? snap.isMyTurn ? "Your move" : "Opponent's move"
                : snap.status === "waiting" ? "Waiting" : "Finished"}
            </span>
          </div>
          <MovesList moves={game.moves} />
          {game.error && (
            <p className="mt-2 rounded-lg bg-red-500/15 px-3 py-2 text-xs font-medium text-red-300">{game.error}</p>
          )}
          {(snap.status === "active" || snap.status === "waiting") && (
            <button
              type="button"
              onClick={() => game.resign()}
              className="mt-3 rounded-full border border-night-foreground/20 px-4 py-2.5 text-sm font-semibold text-night-foreground/80 transition hover:bg-night-foreground/10"
            >
              {snap.status === "waiting" ? "Cancel game" : "Resign"}
            </button>
          )}
        </aside>
      </div>

      {game.promotion && (
        <PromotionModal
          promotion={game.promotion}
          onChoose={game.choosePromotion}
          onCancel={game.cancelPromotion}
        />
      )}
    </Shell>
  );
}

function resultBanner(snap: NonNullable<ReturnType<typeof useOnlineGame>["snapshot"]>) {
  const me = snap.myColorIndex; // 0 white, 1 black
  if (snap.result === "1/2-1/2") return { kicker: "Draw", label: drawLabel(snap.endReason) };
  if (snap.result === "*") return { kicker: "Game over", label: "Game abandoned" };
  const whiteWon = snap.result === "1-0";
  const iWon = (whiteWon && me === 0) || (!whiteWon && me === 1);
  const how =
    snap.endReason === "resignation" ? "by resignation" : snap.endReason === "checkmate" ? "by checkmate" : "";
  return {
    kicker: iWon ? "You won" : "You lost",
    label: `${iWon ? "Victory" : "Defeat"} ${how}`.trim(),
  };
}
function drawLabel(reason: string | null): string {
  if (reason === "stalemate") return "Draw by stalemate";
  return "Draw";
}

function fmtClock(ms: number | null): string {
  if (ms == null) return "∞";
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function PlayerBar({ name, clockMs, active }: { name: string; clockMs: number | null; active: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-2xl px-4 py-3 ${active ? "bg-gold/15 ring-1 ring-gold/40" : "bg-night-foreground/5"}`}>
      <div className="flex items-center gap-3">
        <span className="grid h-8 w-8 place-items-center rounded-full bg-night-foreground/10 text-sm font-bold text-night-foreground/70" aria-hidden="true">
          {name.trim().charAt(0).toUpperCase() || "?"}
        </span>
        <span className="text-sm font-semibold text-night-foreground truncate max-w-[12rem]">{name}</span>
      </div>
      <span className={`rounded-lg px-3 py-1 font-mono text-lg font-bold tabular-nums ${active ? "bg-night text-gold" : "bg-night-foreground/10 text-night-foreground/70"}`}>
        {fmtClock(clockMs)}
      </span>
    </div>
  );
}

function MovesList({ moves }: { moves: { uci: string; san: string }[] }) {
  const rows = useMemo(() => toMoveRows(moves.map((m) => m.san)), [moves]);
  return (
    <div className="mt-3 flex-1 overflow-y-auto rounded-xl bg-night/40 p-2">
      {rows.length === 0 ? (
        <p className="px-2 py-3 text-xs text-night-foreground/40">No moves yet.</p>
      ) : (
        <ol className="text-sm">
          {rows.map((r) => (
            <li key={r.no} className="flex items-center gap-2 rounded px-2 py-1 font-mono text-night-foreground/85">
              <span className="w-6 shrink-0 text-right text-night-foreground/40">{r.no}.</span>
              <span className="w-16">{r.white?.san ?? ""}</span>
              <span className="w-16">{r.black?.san ?? ""}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-night px-4 py-4 sm:px-6">
      <header className="mx-auto mb-4 flex max-w-6xl items-center justify-between">
        <Logo />
        <Link href="/play" className="rounded-full border border-night-foreground/20 px-4 py-2 text-sm font-semibold text-night-foreground/80 transition hover:bg-night-foreground/10">
          Leave
        </Link>
      </header>
      <div className="mx-auto max-w-6xl">{children}</div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return <div className="grid min-h-[60vh] place-items-center text-night-foreground/70">{children}</div>;
}
