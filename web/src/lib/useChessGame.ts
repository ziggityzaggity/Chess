"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadEngine, type ChessGame } from "./engine";
import { chooseBotMove } from "./bot";

export type EngineStatus = "loading" | "ready" | "error";

export type PromoPiece = "q" | "r" | "b" | "n";
export type GameMode = "local" | "bot";

export interface PendingPromotion {
  from: number;
  to: number;
  color: number; // 0 white, 1 black
}

// Result forced by resignation / draw agreement (the engine has no concept of
// these, so we track them alongside its own game-over detection).
export interface ManualResult {
  result: number; // 1 white wins, 2 black wins, 3 draw
  label: string;
}

// A flat, render-ready view of the engine state. Recomputed after every action
// so React components stay pure and never reach into the imperative engine.
export interface GameSnapshot {
  board: string; // 64 chars
  turn: number; // 0 white, 1 black
  inCheck: boolean;
  checkSquare: number; // -1 if not in check
  lastFrom: number;
  lastTo: number;
  gameOver: boolean;
  isCheckmate: boolean;
  result: number; // 0 ongoing, 1 white, 2 black, 3 draw
  drawReason: number;
  canUndo: boolean;
  canRedo: boolean;
  pgn: string;
  ply: number;
}

/** "e2" -> 52 (row-major, row 0 = top / black's back rank). */
export function squareFromName(name: string): number {
  return (8 - (name.charCodeAt(1) - 48)) * 8 + (name.charCodeAt(0) - 97);
}

function snapshotOf(game: ChessGame): GameSnapshot {
  const lastUci = game.lastMoveUci();
  let lastFrom = -1;
  let lastTo = -1;
  if (lastUci.length >= 4) {
    lastFrom = squareFromName(lastUci.slice(0, 2));
    lastTo = squareFromName(lastUci.slice(2, 4));
  }
  const inCheck = game.inCheck();
  return {
    board: game.boardString(),
    turn: game.turn(),
    inCheck,
    checkSquare: inCheck ? game.kingSquare(game.turn()) : -1,
    lastFrom,
    lastTo,
    gameOver: game.isGameOver(),
    isCheckmate: game.isCheckmate(),
    result: game.result(),
    drawReason: game.drawReason(),
    canUndo: game.canUndo(),
    canRedo: game.canRedo(),
    pgn: game.pgn(),
    ply: game.ply(),
  };
}

export interface UseChessGameOptions {
  mode?: GameMode;
  /** Which colour the bot plays (0 white, 1 black). Only used when mode="bot". */
  botColor?: number;
}

export interface UseChessGame {
  status: EngineStatus;
  error: string | null;
  snapshot: GameSnapshot | null;
  sanHistory: string[];
  selected: number;
  legalTargets: number[];
  flipped: boolean;
  promotion: PendingPromotion | null;
  mode: GameMode;
  botColor: number;
  botThinking: boolean;
  manualResult: ManualResult | null;
  onSquareClick: (square: number) => void;
  choosePromotion: (piece: PromoPiece) => void;
  cancelPromotion: () => void;
  newGame: () => void;
  undo: () => void;
  redo: () => void;
  toStart: () => void;
  toEnd: () => void;
  goToPly: (ply: number) => void;
  flip: () => void;
  resign: () => void;
  agreeDraw: () => void;
}

export function useChessGame(options: UseChessGameOptions = {}): UseChessGame {
  const mode = options.mode ?? "local";
  const botColor = options.botColor ?? 1;

  const gameRef = useRef<ChessGame | null>(null);
  const scratchRef = useRef<ChessGame | null>(null); // used only by the bot
  const [status, setStatus] = useState<EngineStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);
  const [sanHistory, setSanHistory] = useState<string[]>([]);

  const [selected, setSelected] = useState(-1);
  const [legalTargets, setLegalTargets] = useState<number[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);
  const [botThinking, setBotThinking] = useState(false);
  const [manualResult, setManualResult] = useState<ManualResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEngine()
      .then((Module) => {
        if (cancelled) return;
        gameRef.current = new Module.ChessGame();
        scratchRef.current = new Module.ChessGame();
        setSnapshot(snapshotOf(gameRef.current));
        setStatus("ready");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(-1);
    setLegalTargets([]);
  }, []);

  const play = useCallback((from: number, to: number, promo: string) => {
    const game = gameRef.current;
    if (!game) return;
    const plyBefore = game.ply();
    const res = game.doMove(from, to, promo);
    if (res && res.ok) {
      // If we had stepped back into history, this move starts a new branch:
      // drop everything after the current point, then append the new SAN.
      setSanHistory((prev) => [...prev.slice(0, plyBefore), res.san]);
    }
    setSelected(-1);
    setLegalTargets([]);
    setPromotion(null);
    setSnapshot(snapshotOf(game));
  }, []);

  const onSquareClick = useCallback(
    (square: number) => {
      const game = gameRef.current;
      if (!game || game.isGameOver() || manualResult) return;
      // Don't let a human move for the bot.
      if (mode === "bot" && game.turn() === botColor) return;

      const board = game.boardString();
      const piece = board[square];
      const whiteToMove = game.turn() === 0;
      const isOwnPiece =
        piece !== "." && whiteToMove === (piece === piece.toUpperCase());

      if (selected === -1) {
        if (isOwnPiece) {
          setSelected(square);
          setLegalTargets(Array.from(game.movesFrom(square)));
        }
        return;
      }

      if (square === selected) {
        clearSelection();
        return;
      }

      if (legalTargets.includes(square)) {
        if (game.isPromotion(selected, square)) {
          setPromotion({ from: selected, to: square, color: game.turn() });
        } else {
          play(selected, square, "");
        }
        return;
      }

      if (isOwnPiece) {
        setSelected(square);
        setLegalTargets(Array.from(game.movesFrom(square)));
      } else {
        clearSelection();
      }
    },
    [selected, legalTargets, clearSelection, play, manualResult, mode, botColor]
  );

  const choosePromotion = useCallback(
    (piece: PromoPiece) => {
      if (promotion) play(promotion.from, promotion.to, piece);
    },
    [promotion, play]
  );

  const cancelPromotion = useCallback(() => {
    setPromotion(null);
    clearSelection();
  }, [clearSelection]);

  const newGame = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    game.reset();
    clearSelection();
    setPromotion(null);
    setManualResult(null);
    setSanHistory([]);
    setSnapshot(snapshotOf(game));
  }, [clearSelection]);

  const undo = useCallback(() => {
    const game = gameRef.current;
    if (!game || !game.undo()) return;
    clearSelection();
    setPromotion(null);
    setSnapshot(snapshotOf(game));
  }, [clearSelection]);

  const redo = useCallback(() => {
    const game = gameRef.current;
    if (!game || !game.redo()) return;
    clearSelection();
    setSnapshot(snapshotOf(game));
  }, [clearSelection]);

  const toStart = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    while (game.canUndo()) game.undo();
    clearSelection();
    setPromotion(null);
    setSnapshot(snapshotOf(game));
  }, [clearSelection]);

  const toEnd = useCallback(() => {
    const game = gameRef.current;
    if (!game) return;
    while (game.canRedo()) game.redo();
    clearSelection();
    setSnapshot(snapshotOf(game));
  }, [clearSelection]);

  const goToPly = useCallback(
    (ply: number) => {
      const game = gameRef.current;
      if (!game) return;
      while (game.ply() > ply && game.canUndo()) game.undo();
      while (game.ply() < ply && game.canRedo()) game.redo();
      clearSelection();
      setPromotion(null);
      setSnapshot(snapshotOf(game));
    },
    [clearSelection]
  );

  const flip = useCallback(() => setFlipped((f) => !f), []);

  const resign = useCallback(() => {
    const game = gameRef.current;
    if (!game || manualResult || game.isGameOver()) return;
    const whiteToMove = game.turn() === 0;
    const loser = whiteToMove ? "White" : "Black";
    setManualResult({
      result: whiteToMove ? 2 : 1,
      label: `${loser} resigned`,
    });
  }, [manualResult]);

  const agreeDraw = useCallback(() => {
    const game = gameRef.current;
    if (!game || manualResult || game.isGameOver()) return;
    setManualResult({ result: 3, label: "Draw agreed" });
  }, [manualResult]);

  // --- bot opponent -------------------------------------------------------
  // When it's the bot's turn and we're at the live tip (not reviewing), pick a
  // move on the scratch instance and play it after a short, human-ish pause.
  useEffect(() => {
    if (mode !== "bot" || status !== "ready") return;
    const s = snapshot;
    if (!s || s.gameOver || manualResult) return;
    if (s.canRedo) return; // user is reviewing earlier moves
    if (s.turn !== botColor) return;

    setBotThinking(true);
    const timer = window.setTimeout(() => {
      const game = gameRef.current;
      const scratch = scratchRef.current;
      if (
        !game ||
        !scratch ||
        game.isGameOver() ||
        game.canRedo() ||
        game.turn() !== botColor
      ) {
        setBotThinking(false);
        return;
      }
      const uci = chooseBotMove(scratch, game.fen(), botColor);
      if (uci) {
        play(
          squareFromName(uci.slice(0, 2)),
          squareFromName(uci.slice(2, 4)),
          uci.length >= 5 ? uci[4] : ""
        );
      }
      setBotThinking(false);
    }, 450);

    return () => {
      window.clearTimeout(timer);
      setBotThinking(false);
    };
  }, [mode, botColor, status, snapshot, manualResult, play]);

  return {
    status,
    error,
    snapshot,
    sanHistory,
    selected,
    legalTargets,
    flipped,
    promotion,
    mode,
    botColor,
    botThinking,
    manualResult,
    onSquareClick,
    choosePromotion,
    cancelPromotion,
    newGame,
    undo,
    redo,
    toStart,
    toEnd,
    goToPly,
    flip,
    resign,
    agreeDraw,
  };
}
