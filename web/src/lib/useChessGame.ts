"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { loadEngine, type ChessGame } from "./engine";

export type EngineStatus = "loading" | "ready" | "error";

export type PromoPiece = "q" | "r" | "b" | "n";

export interface PendingPromotion {
  from: number;
  to: number;
  color: number; // 0 white, 1 black
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

export interface UseChessGame {
  status: EngineStatus;
  error: string | null;
  snapshot: GameSnapshot | null;
  selected: number;
  legalTargets: number[];
  flipped: boolean;
  promotion: PendingPromotion | null;
  onSquareClick: (square: number) => void;
  choosePromotion: (piece: PromoPiece) => void;
  cancelPromotion: () => void;
  newGame: () => void;
  undo: () => void;
  redo: () => void;
  flip: () => void;
}

export function useChessGame(): UseChessGame {
  const gameRef = useRef<ChessGame | null>(null);
  const [status, setStatus] = useState<EngineStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);

  const [selected, setSelected] = useState(-1);
  const [legalTargets, setLegalTargets] = useState<number[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadEngine()
      .then((Module) => {
        if (cancelled) return;
        gameRef.current = new Module.ChessGame();
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

  const play = useCallback(
    (from: number, to: number, promo: string) => {
      const game = gameRef.current;
      if (!game) return;
      game.doMove(from, to, promo);
      setSelected(-1);
      setLegalTargets([]);
      setPromotion(null);
      setSnapshot(snapshotOf(game));
    },
    []
  );

  const onSquareClick = useCallback(
    (square: number) => {
      const game = gameRef.current;
      if (!game || game.isGameOver()) return;

      const board = game.boardString();
      const piece = board[square];
      const whiteToMove = game.turn() === 0;
      const isOwnPiece =
        piece !== "." &&
        whiteToMove === (piece === piece.toUpperCase());

      // Nothing selected yet: pick up an own piece.
      if (selected === -1) {
        if (isOwnPiece) {
          setSelected(square);
          setLegalTargets(Array.from(game.movesFrom(square)));
        }
        return;
      }

      // Clicking the selected piece again deselects.
      if (square === selected) {
        clearSelection();
        return;
      }

      // A legal destination: play it (asking for a promotion piece if needed).
      if (legalTargets.includes(square)) {
        if (game.isPromotion(selected, square)) {
          setPromotion({ from: selected, to: square, color: game.turn() });
        } else {
          play(selected, square, "");
        }
        return;
      }

      // Otherwise re-select another own piece, or clear.
      if (isOwnPiece) {
        setSelected(square);
        setLegalTargets(Array.from(game.movesFrom(square)));
      } else {
        clearSelection();
      }
    },
    [selected, legalTargets, clearSelection, play]
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

  const flip = useCallback(() => setFlipped((f) => !f), []);

  return {
    status,
    error,
    snapshot,
    selected,
    legalTargets,
    flipped,
    promotion,
    onSquareClick,
    choosePromotion,
    cancelPromotion,
    newGame,
    undo,
    redo,
    flip,
  };
}
