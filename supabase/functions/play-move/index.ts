// play-move — authoritative move validation for realtime PvP games.
//
// Flow: verify the caller's JWT → read the game (service role) → cheap checks
// (status / participant / turn / move_count) → validate the move with the WASM
// engine (replaying history for threefold) → apply it atomically via the
// service-role-only RPC apply_validated_move → broadcast the new state on the
// private per-game channel. The client's HTTP response and the broadcast carry
// the same authoritative state, gated by moveCount on both sides.

import { validateMove } from "./engine.ts";

const URL = Deno.env.get("SUPABASE_URL")!;
const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const svcHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // 1. Identify the caller from their JWT (validated against the auth server).
  const authHeader = req.headers.get("Authorization") ?? "";
  const userRes = await fetch(`${URL}/auth/v1/user`, {
    headers: { apikey: ANON, Authorization: authHeader },
  });
  if (!userRes.ok) return json({ error: "not_authenticated" }, 401);
  const user = await userRes.json();
  const uid: string | undefined = user?.id;
  if (!uid) return json({ error: "not_authenticated" }, 401);

  // 2. Parse request.
  let payload: { gameId?: string; uci?: string; expectedMoveCount?: number };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "bad_request" }, 400);
  }
  const { gameId, uci, expectedMoveCount } = payload;
  if (!gameId || typeof uci !== "string" || typeof expectedMoveCount !== "number") {
    return json({ error: "bad_request" }, 400);
  }

  // 3. Read the authoritative game row (service role).
  const rowRes = await fetch(
    `${URL}/rest/v1/active_games?id=eq.${gameId}&select=id,status,host_id,guest_id,host_color,fen,moves,move_count,time_control,clock_white_ms,clock_black_ms,last_move_at`,
    { headers: svcHeaders },
  );
  const rows = await rowRes.json();
  const g = Array.isArray(rows) ? rows[0] : null;
  if (!g) return json({ error: "game_not_found" }, 404);

  // 4. Cheap authoritative checks before touching the engine.
  if (g.status !== "active") return json({ error: "not_active" }, 409);
  if (uid !== g.host_id && uid !== g.guest_id) return json({ error: "not_a_participant" }, 403);
  if (g.move_count !== expectedMoveCount) {
    return json({ error: "conflict", currentMoveCount: g.move_count }, 409);
  }
  const sideToMove = String(g.fen).split(" ")[1]; // 'w' | 'b'
  const moverColor =
    g.host_color === "white"
      ? uid === g.host_id ? "w" : "b"
      : uid === g.host_id ? "b" : "w";
  if (sideToMove !== moverColor) return json({ error: "not_your_turn" }, 409);

  // 5. Validate the move with the engine (replays history from startpos).
  const v = await validateMove({ moves: g.moves ?? [], fen: g.fen, uci });
  if (!v.ok) {
    const status = v.reason === "illegal_move" || v.reason === "bad_uci" ? 422 : 409;
    return json({ accepted: false, reason: v.reason }, status);
  }

  // 6. Display-only clocks: decrement the mover's remaining time.
  let cw: number | null = g.clock_white_ms;
  let cb: number | null = g.clock_black_ms;
  if (g.time_control !== "unlimited") {
    const elapsed = Math.max(0, Date.now() - Date.parse(g.last_move_at));
    if (moverColor === "w") cw = Math.max(0, (cw ?? 0) - elapsed);
    else cb = Math.max(0, (cb ?? 0) - elapsed);
  }

  // 7. Apply atomically via the service-role-only RPC.
  const applyRes = await fetch(`${URL}/rest/v1/rpc/apply_validated_move`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({
      p_game_id: gameId,
      p_user_id: uid,
      p_expected_move_count: expectedMoveCount,
      p_uci: uci,
      p_san: v.san,
      p_new_fen: v.fen,
      p_clock_white_ms: cw,
      p_clock_black_ms: cb,
      p_game_over: v.gameOver,
      p_result: v.result,
      p_end_reason: v.endReason,
    }),
  });
  if (!applyRes.ok) {
    const err = await applyRes.json().catch(() => ({}));
    // PostgREST maps our PTxyz errcodes to HTTP status; surface as conflict.
    return json({ accepted: false, reason: err?.message ?? "apply_failed" }, applyRes.status === 404 ? 404 : 409);
  }
  const applied = (await applyRes.json())?.[0] ?? {};
  const newMoveCount = applied.move_count ?? expectedMoveCount + 1;

  // 8. Broadcast the new authoritative state to the private per-game channel.
  const broadcastPayload = {
    type: "move",
    uci,
    san: v.san,
    fen: v.fen,
    moveCount: newMoveCount,
    clockWhiteMs: cw,
    clockBlackMs: cb,
    gameOver: v.gameOver,
    result: applied.result ?? v.result,
    endReason: applied.end_reason ?? v.endReason,
    status: applied.status ?? "active",
  };
  await fetch(`${URL}/realtime/v1/api/broadcast`, {
    method: "POST",
    headers: svcHeaders,
    body: JSON.stringify({
      messages: [{ topic: `game:${gameId}`, event: "game", private: true, payload: broadcastPayload }],
    }),
  }).catch(() => {}); // broadcast is advisory; the HTTP response + DB are authoritative.

  // 9. Respond to the mover with the same authoritative state.
  return json({ accepted: true, ...broadcastPayload });
});
