import { useCallback, useEffect, useRef, useState } from "react";
import { makeEngine, type ChessEngine } from "./engine";

export type EngineStatus = "loading" | "ready" | "error";
export type PromoPiece = "q" | "r" | "b" | "n";

export interface PendingPromotion {
  from: number;
  to: number;
  color: number; // 0 white, 1 black
}

// Flat, render-ready view of the engine state, recomputed after each action so
// components stay pure and never reach into the imperative native object.
export interface GameSnapshot {
  board: string;
  turn: number;
  inCheck: boolean;
  checkSquare: number;
  lastFrom: number;
  lastTo: number;
  gameOver: boolean;
  isCheckmate: boolean;
  result: number;
  drawReason: number;
  canUndo: boolean;
  canRedo: boolean;
  pgn: string;
  ply: number;
}

/** "e2" -> 52 (row-major, row 0 = top). */
export function squareFromName(name: string): number {
  return (8 - (name.charCodeAt(1) - 48)) * 8 + (name.charCodeAt(0) - 97);
}

function snapshotOf(game: ChessEngine): GameSnapshot {
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
  onSquarePress: (square: number) => void;
  choosePromotion: (piece: PromoPiece) => void;
  cancelPromotion: () => void;
  newGame: () => void;
  undo: () => void;
  redo: () => void;
  flip: () => void;
}

export function useChessGame(): UseChessGame {
  const gameRef = useRef<ChessEngine | null>(null);
  const [status, setStatus] = useState<EngineStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<GameSnapshot | null>(null);

  const [selected, setSelected] = useState(-1);
  const [legalTargets, setLegalTargets] = useState<number[]>([]);
  const [flipped, setFlipped] = useState(false);
  const [promotion, setPromotion] = useState<PendingPromotion | null>(null);

  useEffect(() => {
    try {
      const game = makeEngine(); // synchronous JSI construction
      gameRef.current = game;
      setSnapshot(snapshotOf(game));
      setStatus("ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, []);

  const clearSelection = useCallback(() => {
    setSelected(-1);
    setLegalTargets([]);
  }, []);

  const play = useCallback((from: number, to: number, promo: string) => {
    const game = gameRef.current;
    if (!game) return;
    game.doMove(from, to, promo);
    setSelected(-1);
    setLegalTargets([]);
    setPromotion(null);
    setSnapshot(snapshotOf(game));
  }, []);

  const onSquarePress = useCallback(
    (square: number) => {
      const game = gameRef.current;
      if (!game || game.isGameOver()) return;

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
    onSquarePress,
    choosePromotion,
    cancelPromotion,
    newGame,
    undo,
    redo,
    flip,
  };
}
