"use client";

// onlineGame.ts — realtime multiplayer client layer.
//
// The server is the single source of truth. A local WASM engine instance is
// used ONLY to render the board and to offer legal-move highlighting for the
// side to move; every actual move is submitted to the `play-move` edge function,
// which validates and persists it. Both the mover's HTTP response and the
// opponent's realtime broadcast carry the same authoritative state, applied
// under a moveCount sequence guard with resync-from-DB on any gap.

import { useCallback, useEffect, useRef, useState } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase/client";
import { loadEngine, type ChessGame } from "./engine";
import type { PromoPiece } from "./useChessGame";

export type OnlineStatus = "waiting" | "active" | "finished";
export type Color = "white" | "black";

export interface MoveEntry {
  uci: string;
  san: string;
}

/** "e2" -> 52 (row-major, row 0 = black's back rank). */
export function squareFromName(name: string): number {
  return (8 - (name.charCodeAt(1) - 48)) * 8 + (name.charCodeAt(0) - 97);
}
/** 52 -> "e2". */
export function squareToName(sq: number): string {
  return String.fromCharCode(97 + (sq & 7)) + String(8 - (sq >> 3));
}

// ---------------------------------------------------------------------------
// RPC / edge-function helpers
// ---------------------------------------------------------------------------
export interface CreateResult {
  id: string;
  code: string;
}

const RPC_ERRORS: Record<string, string> = {
  limit_hour: "You can host up to 5 games per hour — try again later.",
  limit_lifetime: "You've reached the lifetime limit of hosted games.",
  not_authenticated: "Please sign in to play online.",
  guest_cannot_host: "Create a free account to host a game.",
  game_not_found: "That game code wasn't found (it may have expired).",
  wrong_password: "That password is incorrect.",
  cannot_join_own_game: "You can't join your own game.",
  already_taken: "Someone already joined that game.",
  too_many_join_attempts: "Too many attempts — wait a moment and try again.",
};

function friendlyError(message: string | undefined, fallback: string): string {
  if (!message) return fallback;
  return RPC_ERRORS[message] ?? fallback;
}

export async function createOnlineGame(input: {
  password: string;
  color: Color;
  timeControl: string;
}): Promise<CreateResult> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Online play isn't configured.");
  const { data, error } = await supabase.rpc("create_hosted_game", {
    p_password: input.password,
    p_host_color: input.color,
    p_time_control: input.timeControl,
  });
  if (error) throw new Error(friendlyError(error.message, "Couldn't create the game."));
  const row = Array.isArray(data) ? data[0] : data;
  return { id: row.id, code: row.code };
}

export async function joinOnlineGame(
  code: string,
  password: string,
  guestName?: string,
): Promise<string> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Online play isn't configured.");
  const { data, error } = await supabase.rpc("join_active_game", {
    p_code: code.trim().toUpperCase(),
    p_password: password,
    p_guest_name: guestName?.trim() || undefined,
  });
  if (error) throw new Error(friendlyError(error.message, "Couldn't join the game."));
  const row = Array.isArray(data) ? data[0] : data;
  // The RPC returns an outcome row (ok/reason) so throttle attempts persist.
  if (!row || !row.ok) throw new Error(friendlyError(row?.reason ?? undefined, "Couldn't join the game."));
  return row.id as string;
}

export async function resignOnlineGame(gameId: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("Online play isn't configured.");
  const { error } = await supabase.rpc("resign_active_game", { p_game_id: gameId });
  if (error) throw new Error(friendlyError(error.message, "Couldn't resign."));
}

// ---------------------------------------------------------------------------
// Authoritative game state as the board needs it.
// ---------------------------------------------------------------------------
export interface OnlineGameState {
  id: string;
  status: OnlineStatus;
  fen: string;
  moves: MoveEntry[];
  moveCount: number;
  hostColor: Color;
  hostId: string;
  guestId: string | null;
  hostName: string | null;  // display-name snapshots on the game row (no profiles read)
  guestName: string | null; // null until a guest has joined
  myColor: Color | null; // null while still resolving / spectator (not used)
  turn: Color; // side to move per fen
  result: string | null; // '1-0' | '0-1' | '1/2-1/2' | '*' | null
  endReason: string | null;
  clockWhiteMs: number | null;
  clockBlackMs: number | null;
}

export interface OnlineSnapshot {
  board: string; // 64 chars for <Board/>
  turn: number; // 0 white, 1 black
  checkSquare: number;
  lastFrom: number;
  lastTo: number;
  myColorIndex: number; // 0 white, 1 black
  isMyTurn: boolean;
  status: OnlineStatus;
  result: string | null;
  endReason: string | null;
  moveCount: number;
  clockWhiteMs: number | null;
  clockBlackMs: number | null;
  whiteName: string;
  blackName: string;
}

interface RowShape {
  id: string;
  status: OnlineStatus;
  fen: string;
  moves: MoveEntry[] | null;
  move_count: number;
  host_color: Color;
  host_id: string;
  guest_id: string | null;
  host_name: string | null;
  guest_name: string | null;
  result: string | null;
  end_reason: string | null;
  clock_white_ms: number | null;
  clock_black_ms: number | null;
}

const ROW_COLS =
  "id,status,fen,moves,move_count,host_color,host_id,guest_id,host_name,guest_name,result,end_reason,clock_white_ms,clock_black_ms";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export type ConnectionState = "loading" | "connecting" | "ready" | "error";

export interface UseOnlineGame {
  connection: ConnectionState;
  error: string | null;
  snapshot: OnlineSnapshot | null;
  selected: number;
  legalTargets: number[];
  promotion: { from: number; to: number; color: number } | null;
  pending: boolean;
  onSquareClick: (square: number) => void;
  choosePromotion: (piece: PromoPiece) => void;
  cancelPromotion: () => void;
  resign: () => Promise<void>;
  moves: MoveEntry[];
}

/** Drive a realtime multiplayer board for `gameId` as the current user. */
export function useOnlineGame(gameId: string): UseOnlineGame {
  const engineRef = useRef<ChessGame | null>(null);
  const stateRef = useRef<OnlineGameState | null>(null);
  const channelRef = useRef<RealtimeChannel | null>(null);
  const meRef = useRef<string | null>(null);

  const [connection, setConnection] = useState<ConnectionState>("loading");
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<OnlineSnapshot | null>(null);
  const [selected, setSelected] = useState(-1);
  const [legalTargets, setLegalTargets] = useState<number[]>([]);
  const [promotion, setPromotion] = useState<{ from: number; to: number; color: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [moves, setMoves] = useState<MoveEntry[]>([]);

  // Recompute the render snapshot from the authoritative state + engine.
  const publish = useCallback(() => {
    const st = stateRef.current;
    const eng = engineRef.current;
    if (!st || !eng) return;
    eng.setFen(st.fen);
    const turnIdx = st.turn === "white" ? 0 : 1;
    const myIdx = st.myColor === "black" ? 1 : 0;
    const last = st.moves[st.moves.length - 1];
    let lastFrom = -1;
    let lastTo = -1;
    if (last) {
      lastFrom = squareFromName(last.uci.slice(0, 2));
      lastTo = squareFromName(last.uci.slice(2, 4));
    }
    const inCheck = eng.inCheck();
    // Display names are snapshotted on the game row (host_name/guest_name), so
    // the board never reads the profiles table. The guest slot is empty until
    // someone joins a live game ("Waiting…"); the generic fallbacks only appear
    // for a row that predates the snapshot columns.
    const nameFor = (isGuestSlot: boolean): string => {
      const snap = isGuestSlot ? st.guestName : st.hostName;
      if (snap) return snap;
      if (isGuestSlot && st.status !== "finished") return "Waiting…";
      return isGuestSlot ? "Guest" : "Player";
    };
    const hostIsWhite = st.hostColor === "white";
    setSnapshot({
      board: eng.boardString(),
      turn: turnIdx,
      checkSquare: inCheck ? eng.kingSquare(turnIdx) : -1,
      lastFrom,
      lastTo,
      myColorIndex: myIdx,
      isMyTurn: st.status === "active" && st.myColor === st.turn,
      status: st.status,
      result: st.result,
      endReason: st.endReason,
      moveCount: st.moveCount,
      clockWhiteMs: st.clockWhiteMs,
      clockBlackMs: st.clockBlackMs,
      whiteName: hostIsWhite ? nameFor(false) : nameFor(true),
      blackName: hostIsWhite ? nameFor(true) : nameFor(false),
    });
    setMoves(st.moves);
  }, []);

  const applyRow = useCallback(
    (row: RowShape) => {
      const me = meRef.current;
      const myColor: Color | null =
        me == null
          ? null
          : me === row.host_id
            ? row.host_color
            : me === row.guest_id
              ? row.host_color === "white" ? "black" : "white"
              : null;
      stateRef.current = {
        id: row.id,
        status: row.status,
        fen: row.fen,
        moves: row.moves ?? [],
        moveCount: row.move_count,
        hostColor: row.host_color,
        hostId: row.host_id,
        guestId: row.guest_id,
        hostName: row.host_name,
        guestName: row.guest_name,
        myColor,
        turn: row.fen.split(" ")[1] === "b" ? "black" : "white",
        result: row.result,
        endReason: row.end_reason,
        clockWhiteMs: row.clock_white_ms,
        clockBlackMs: row.clock_black_ms,
      };
      setSelected(-1);
      setLegalTargets([]);
      publish();
    },
    [publish]
  );

  // Authoritative re-read of the game (source of truth on connect / gap / conflict).
  const resync = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    const { data: active } = await supabase
      .from("active_games")
      .select(ROW_COLS)
      .eq("id", gameId)
      .maybeSingle();
    if (active) {
      applyRow(active as unknown as RowShape);
      return;
    }
    // Row gone -> finished & swept, or abandoned: fall back to the archive.
    // This must work even on a FRESH load (no prior state), so build a full
    // finished state by replaying the archived moves to the final position.
    const { data: arch } = await supabase
      .from("game_archive")
      .select("active_game_id,white_id,black_id,white_name,black_name,result,end_reason,moves,time_control")
      .eq("active_game_id", gameId)
      .maybeSingle();
    if (arch) {
      const a = arch as unknown as {
        white_id: string | null;
        black_id: string | null;
        white_name: string;
        black_name: string;
        result: string;
        end_reason: string | null;
        moves: MoveEntry[] | null;
        time_control: string;
      };
      const archMoves = a.moves ?? [];
      const eng = engineRef.current;
      let finalFen = stateRef.current?.fen ?? START_FEN;
      if (eng) {
        eng.setFen(START_FEN);
        for (const m of archMoves) {
          eng.doMove(squareFromName(m.uci.slice(0, 2)), squareFromName(m.uci.slice(2, 4)), m.uci[4] ?? "");
        }
        finalFen = eng.fen();
      }
      const me = meRef.current;
      const myColor: Color | null =
        me && me === a.white_id ? "white" : me && me === a.black_id ? "black" : null;
      stateRef.current = {
        id: gameId,
        status: "finished",
        fen: finalFen,
        moves: archMoves,
        moveCount: archMoves.length,
        hostColor: "white", // synthetic: host=white so publish maps white/black correctly
        hostId: a.white_id ?? "",
        guestId: a.black_id,
        hostName: a.white_name, // archived snapshots survive nickname changes / profile deletion
        guestName: a.black_name,
        myColor,
        turn: finalFen.split(" ")[1] === "b" ? "black" : "white",
        result: a.result,
        endReason: a.end_reason,
        clockWhiteMs: null,
        clockBlackMs: null,
      };
      publish();
      return;
    }
    // Neither active nor archived, and nothing loaded yet -> not found.
    if (!stateRef.current) {
      setError("This game wasn't found — it may have expired.");
      setConnection("error");
    }
  }, [gameId, applyRow, publish]);

  // Apply an authoritative payload (from a broadcast or our own HTTP response),
  // gated by the moveCount sequence.
  const applyAuthoritative = useCallback(
    (p: {
      fen?: string;
      moveCount?: number;
      moves?: MoveEntry[];
      status?: OnlineStatus;
      result?: string | null;
      endReason?: string | null;
      clockWhiteMs?: number | null;
      clockBlackMs?: number | null;
      uci?: string;
      san?: string;
    }) => {
      const st = stateRef.current;
      if (!st || typeof p.moveCount !== "number" || !p.fen) return;
      if (p.moveCount <= st.moveCount) return; // stale / already applied
      if (p.moveCount > st.moveCount + 1) {
        void resync(); // gap — a move was missed
        return;
      }
      const appendedMoves = p.uci
        ? [...st.moves, { uci: p.uci, san: p.san ?? "" }]
        : st.moves;
      stateRef.current = {
        ...st,
        fen: p.fen,
        moveCount: p.moveCount,
        moves: appendedMoves,
        status: p.status ?? st.status,
        result: p.result ?? st.result,
        endReason: p.endReason ?? st.endReason,
        turn: p.fen.split(" ")[1] === "b" ? "black" : "white",
        clockWhiteMs: p.clockWhiteMs ?? st.clockWhiteMs,
        clockBlackMs: p.clockBlackMs ?? st.clockBlackMs,
      };
      setSelected(-1);
      setLegalTargets([]);
      publish();
    },
    [publish, resync]
  );

  // --- setup: engine + identity + channel ---------------------------------
  useEffect(() => {
    let cancelled = false;
    let localChannel: RealtimeChannel | null = null;
    const supabase = getSupabase();
    if (!supabase) {
      setError("Online play isn't configured.");
      setConnection("error");
      return;
    }
    (async () => {
      const [Module, { data: userData }] = await Promise.all([
        loadEngine(),
        supabase.auth.getUser(),
      ]);
      if (cancelled) return;
      engineRef.current = new Module.ChessGame();
      meRef.current = userData.user?.id ?? null;
      setConnection("connecting");

      // Private-channel auth uses the current session token.
      const { data: sess } = await supabase.auth.getSession();
      if (sess.session?.access_token) {
        await supabase.realtime.setAuth(sess.session.access_token);
      }

      const channel = supabase.channel(`game:${gameId}`, { config: { private: true } });
      localChannel = channel;
      channel.on("broadcast", { event: "game" }, ({ payload }) => {
        if (cancelled) return; // ignore post-unmount delivery
        applyAuthoritative(payload as Parameters<typeof applyAuthoritative>[0]);
      });
      channel.subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED" || status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Subscribe FIRST, then reconcile from the DB; the backstop poll then
          // keeps closing any missed-message window. CHANNEL_ERROR still works
          // via the poll fallback.
          void resync().then(() => setConnection("ready"));
        }
      });
      channelRef.current = channel;
    })().catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      setConnection("error");
    });

    return () => {
      cancelled = true;
      // Remove the channel whether or not the async IIFE finished assigning it.
      const chan = localChannel ?? channelRef.current;
      if (chan) supabase.removeChannel(chan);
      channelRef.current = null;
      engineRef.current?.delete?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId]);

  // Backstop poll while the game is live. Moves arrive via broadcast (fast
  // path); this catches state changes that do NOT broadcast — a guest joining,
  // and terminal transitions (resign / cancel / idle-abandonment) — and
  // self-heals any missed-broadcast desync by reconciling from the DB.
  useEffect(() => {
    const s = snapshot?.status;
    if (s !== "waiting" && s !== "active") return;
    const t = setInterval(() => void resync(), s === "waiting" ? 2500 : 4000);
    return () => clearInterval(t);
  }, [snapshot?.status, resync]);

  // --- submitting a move --------------------------------------------------
  const submit = useCallback(
    async (from: number, to: number, promo: string) => {
      const st = stateRef.current;
      const supabase = getSupabase();
      if (!st || !supabase) return;
      const uci = squareToName(from) + squareToName(to) + promo;
      const expected = st.moveCount;
      setPending(true);
      setSelected(-1);
      setLegalTargets([]);
      setPromotion(null);
      try {
        const { data, error: fnErr } = await supabase.functions.invoke("play-move", {
          body: { gameId, uci, expectedMoveCount: expected },
        });
        if (fnErr) {
          const ctx = (fnErr as { context?: Response }).context;
          const status = ctx?.status;
          let body: { reason?: string } = {};
          try {
            body = ctx ? await ctx.json() : {};
          } catch {
            /* ignore */
          }
          if (status === 409) {
            await resync(); // legitimate advance elsewhere — rebuild, don't revert
          } else if (status === 422) {
            setError("That move isn't legal.");
            setTimeout(() => setError(null), 2000);
          } else {
            setError(friendlyError(body.reason, "Move failed — please retry."));
            setTimeout(() => setError(null), 2500);
          }
          return;
        }
        applyAuthoritative(data as Parameters<typeof applyAuthoritative>[0]);
      } finally {
        setPending(false);
      }
    },
    [gameId, applyAuthoritative, resync]
  );

  // --- board interaction --------------------------------------------------
  const onSquareClick = useCallback(
    (square: number) => {
      const st = stateRef.current;
      const eng = engineRef.current;
      if (!st || !eng || pending) return;
      if (st.status !== "active" || st.myColor !== st.turn) return; // not my move

      const board = eng.boardString();
      const piece = board[square];
      const whiteToMove = st.turn === "white";
      const isOwnPiece = piece !== "." && whiteToMove === (piece === piece.toUpperCase());

      if (selected === -1) {
        if (isOwnPiece) {
          setSelected(square);
          setLegalTargets(Array.from(eng.movesFrom(square)));
        }
        return;
      }
      if (square === selected) {
        setSelected(-1);
        setLegalTargets([]);
        return;
      }
      if (legalTargets.includes(square)) {
        if (eng.isPromotion(selected, square)) {
          setPromotion({ from: selected, to: square, color: whiteToMove ? 0 : 1 });
        } else {
          void submit(selected, square, "");
        }
        return;
      }
      if (isOwnPiece) {
        setSelected(square);
        setLegalTargets(Array.from(eng.movesFrom(square)));
      } else {
        setSelected(-1);
        setLegalTargets([]);
      }
    },
    [selected, legalTargets, pending, submit]
  );

  const choosePromotion = useCallback(
    (piece: PromoPiece) => {
      if (promotion) void submit(promotion.from, promotion.to, piece);
    },
    [promotion, submit]
  );
  const cancelPromotion = useCallback(() => {
    setPromotion(null);
    setSelected(-1);
    setLegalTargets([]);
  }, []);

  const resign = useCallback(async () => {
    try {
      await resignOnlineGame(gameId);
      await resync();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't resign.");
    }
  }, [gameId, resync]);

  return {
    connection,
    error,
    snapshot,
    selected,
    legalTargets,
    promotion,
    pending,
    onSquareClick,
    choosePromotion,
    cancelPromotion,
    resign,
    moves,
  };
}
