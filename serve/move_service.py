"""The move server: a chess position in, the value network's move out.

Signed-in players of the web app can play the large Convolutional bot here at
any depth, 200 moves an hour each. This module is the whole service; it runs
on Modal (serve/modal_app.py) and, for tests, anywhere.

    POST /move   {"fen": "...", "pgn": "1. e4 e5 ...", "depth": 1-3}
                 Authorization: Bearer <the player's Supabase access token>
             ->  {"move": "g1f3", "san": "Nf3", "score": 0.53, "depth": 3, ...}

How a request is handled:

1. Validate the position (no quota is spent on a malformed request). The
   moves played so far (`pgn`) are replayed so threefold repetition counts.
2. Spend one move of the player's hourly quota: a Supabase RPC called with
   the player's own token, so Supabase also checks the token. Anonymous
   (guest) sessions and expired tokens are refused there.
3. Search: chess_engine.player's full-width negamax to the requested depth.
   The tree is expanded by the C++ engine, and every position at the horizon
   is evaluated in large batches (`OnnxModel`).

Speed (`OnnxModel`): ONNX Runtime on the GPU, float16 when it agrees with
float32 on real positions, batches padded to a few fixed sizes so cuDNN
picks its kernels once (at warm-up) instead of on every new batch size.
"""

import asyncio
import logging
import time
import warnings
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

import numpy as np

import chess_engine as ce
from chess_engine import _core, player

log = logging.getLogger("pychess.move_service")

MAX_DEPTH = player.MAX_DEPTH
MAX_POSITIONS = 400_000          # horizon positions per move; deeper trees fall back a ply
MAX_PGN_CHARS = 20_000
BUCKETS = (64, 256, 1024, 2048, 4096, player.EVAL_CHUNK)   # batch sizes the session runs


# =============================================================================
# The network
# =============================================================================
class OnnxModel:
    """The value network in ONNX Runtime: (N, 19, 8, 8) planes -> (N, 3) W/D/L probabilities.

    On a GPU the session uses CUDA with float16 weights when they reproduce
    float32's probabilities (to `fp16_tolerance`), and pads every batch to one
    of `buckets` so each shape is tuned once, during `warm_up`.
    """

    def __init__(self, path: str, providers: Optional[Sequence] = None, try_fp16: bool = True,
                 buckets: Sequence[int] = BUCKETS, fp16_tolerance: float = 2e-3):
        import onnxruntime as ort

        self.ort = ort
        self.buckets = tuple(sorted(buckets))
        if providers is None:
            providers = [p for p in ("CUDAExecutionProvider", "CPUExecutionProvider")
                         if p in ort.get_available_providers()]
        self.providers = [self._with_options(p) for p in providers]
        self.session = self._session(path)
        self.on_gpu = self.session.get_providers()[0] == "CUDAExecutionProvider"
        self.precision = "float32"
        if try_fp16 and self.on_gpu:
            self._try_fp16(path, fp16_tolerance)
        self.input_name = self.session.get_inputs()[0].name
        log.info("value network on %s, %s", self.session.get_providers()[0], self.precision)

    @staticmethod
    def _with_options(provider):
        if provider == "CUDAExecutionProvider":
            return (provider, {"cudnn_conv_algo_search": "EXHAUSTIVE",   # tuned once per bucket
                               "do_copy_in_default_stream": True,
                               "use_tf32": 1})
        return provider

    def _session(self, model):
        options = self.ort.SessionOptions()
        options.graph_optimization_level = self.ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        return self.ort.InferenceSession(model, sess_options=options, providers=self.providers)

    def _try_fp16(self, path: str, tolerance: float) -> None:
        """Switch to float16 weights if they reproduce float32's probabilities on real positions."""
        try:
            import onnx
            from onnxconverter_common import float16

            with warnings.catch_warnings():   # tiny weights rounded to float16's smallest values
                warnings.simplefilter("ignore", UserWarning)
                half = float16.convert_float_to_float16(onnx.load(path), keep_io_types=True)
            session = self._session(half.SerializeToString())
            planes = sample_planes()
            name = session.get_inputs()[0].name
            exact = player.softmax(self.session.run(None, {name: planes})[0])
            approx = player.softmax(session.run(None, {name: planes})[0].astype(np.float32))
            error = float(np.abs(exact - approx).max())
            if error <= tolerance:
                self.session, self.precision = session, "float16"
            else:
                log.warning("float16 differs from float32 by %.4f; staying in float32", error)
        except Exception as err:  # the converter or the GPU kernels; float32 always works
            log.warning("float16 unavailable (%s: %s); staying in float32", type(err).__name__, err)

    def warm_up(self) -> None:
        """Run every bucket once, so no player waits for kernel selection."""
        for size in self.buckets:
            self(np.zeros((size, ce.NUM_PLANES, 8, 8), np.float32))

    def __call__(self, planes: np.ndarray) -> np.ndarray:
        n = len(planes)
        out = np.empty((n, 3), np.float32)
        top = self.buckets[-1]
        for start in range(0, n, top):
            chunk = planes[start:start + top]
            size = next(b for b in self.buckets if b >= len(chunk))
            if size != len(chunk):   # pad to the bucket; the padding's outputs are dropped
                chunk = np.concatenate([chunk, np.zeros((size - len(chunk),) + chunk.shape[1:], np.float32)])
            logits = self.session.run(None, {self.input_name: np.ascontiguousarray(chunk, np.float32)})[0]
            out[start:start + top] = player.softmax(logits[: min(top, n - start)].astype(np.float32))
        return out


def sample_planes(n: int = 256) -> np.ndarray:
    """Encoded positions from a real game, for checking a model's numerics."""
    rep = ce.replay_games(["1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 6. Be3 e5 7. Nb3 Be6 "
                           "8. f3 Be7 9. Qd2 O-O 10. O-O-O Nbd7 11. g4 b5 12. g5 Nh5 13. Kb1 Nb6 *"])
    boards = rep["boards"]
    kids = _core.expand_boards(boards)[0]
    return _core.encode_boards(np.concatenate([boards, kids])[:n])


# =============================================================================
# Positions and the search
# =============================================================================
class BadRequest(ValueError):
    """The request names an impossible or finished position."""


def game_from(fen: str, pgn: str = "") -> ce.Game:
    """The game to move in. With the moves played so far, repetitions count as the rules say."""
    if len(pgn) > MAX_PGN_CHARS:
        raise BadRequest("pgn is too long")
    try:
        target = ce.Game(fen)
    except ValueError as err:
        raise BadRequest(str(err)) from None
    if pgn.strip():
        game = ce.Game()
        if all(game.push_san(san) for san in ce.san_tokens(pgn)[0]) and game.fen() == target.fen():
            target = game
        else:
            log.info("pgn does not lead to the fen; playing from the fen without its history")
    if target.is_game_over():
        raise BadRequest("the game is over")
    return target


def affordable_depth(game: ce.Game, depth: int, max_positions: int = MAX_POSITIONS) -> int:
    """The deepest search up to `depth` whose horizon holds at most `max_positions` positions."""
    level, _ = game.children()
    for d in range(2, depth + 1):
        counts, _ = _core.count_legal(level)
        if int(counts.sum()) > max_positions:
            return d - 1
        if d < depth:
            level = _core.expand_boards(level)[0]
    return depth


@dataclass
class MoveResult:
    move: str
    san: str
    score: float          # expected score for the mover, 0..1
    depth: int            # plies actually searched
    positions: int        # positions the network evaluated
    elapsed_ms: float


def best_move(game: ce.Game, evaluate: player.Evaluator, depth: int) -> MoveResult:
    """chess_engine.player's move (mate in one first, then full-width negamax to `depth`)."""
    t0 = time.perf_counter()
    boards, moves = game.children()
    _, status = _core.count_legal(boards)
    for i, m in enumerate(moves):                 # a mate in one needs no search
        if int(status[i]) == int(ce.Status.CHECKMATE):
            return MoveResult(m.uci(), game.san(m), 1.0, 1, 0, round((time.perf_counter() - t0) * 1000, 1))
    depth = affordable_depth(game, depth)
    seen = 0

    def counting(planes):
        nonlocal seen
        seen += len(planes)
        return evaluate(planes)

    choice = player.choose_move(game, counting, depth=depth)
    return MoveResult(choice.uci, choice.san, round(choice.score, 4), depth, seen,
                      round((time.perf_counter() - t0) * 1000, 1))


BENCHMARK_FENS = {
    "opening": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "middlegame": "rn1q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1BP2/PPPQ2PP/2KR1B1R b - - 4 10",
    "tactical": "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "endgame": "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
}


def benchmark(model, depths: Sequence[int] = (1, 2, 3)) -> list:
    """Move latency of `model` on a few typical positions, as rows of a table."""
    return [{"position": name, **best_move(ce.Game(fen), model, depth).__dict__}
            for name, fen in BENCHMARK_FENS.items() for depth in depths]


# =============================================================================
# The hourly quota (Supabase)
# =============================================================================
@dataclass
class Quota:
    allowed: bool
    limit: int
    remaining: int
    retry_after_s: int = 0


class SignInRequired(Exception):
    """No valid, non-anonymous Supabase session."""


class QuotaUnavailable(Exception):
    """Supabase could not be asked."""


class SupabaseQuota:
    """Spends one move of the caller's hourly quota via `public.consume_model_move()`.

    The RPC runs as the caller (their token), so PostgREST verifies the token
    and the function refuses anonymous sessions; see
    supabase/migrations/*_model_server_quota.sql.
    """

    def __init__(self, url: str, anon_key: str, timeout_s: float = 5.0):
        import httpx

        self.endpoint = f"{url.rstrip('/')}/rest/v1/rpc/consume_model_move"
        self.anon_key = anon_key
        self.client = httpx.AsyncClient(timeout=timeout_s)   # keeps the connection to Supabase warm

    async def consume(self, token: str) -> Quota:
        import httpx

        try:
            r = await self.client.post(self.endpoint, json={},
                                       headers={"apikey": self.anon_key, "Authorization": f"Bearer {token}"})
        except httpx.HTTPError as err:
            raise QuotaUnavailable(type(err).__name__) from None
        if r.status_code in (401, 403):
            raise SignInRequired()
        if r.status_code != 200:
            raise QuotaUnavailable(f"HTTP {r.status_code}")
        body = r.json()
        return Quota(bool(body["allowed"]), int(body["limit"]), int(body["remaining"]),
                     int(body.get("retry_after_s") or 0))


# =============================================================================
# The HTTP API
# =============================================================================
def create_app(evaluate: player.Evaluator, quota, allowed_origins: Sequence[str] = ("*",),
               max_concurrent_searches: int = 4, max_depth: int = MAX_DEPTH):
    """The FastAPI app. `quota` has `async consume(token) -> Quota`.

    Requests deeper than `max_depth` are searched to `max_depth` (a CPU-only
    deployment caps it at 2); the response's `depth` says how deep it went.
    """
    from fastapi import FastAPI, Header
    from fastapi.concurrency import run_in_threadpool
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import JSONResponse
    from pydantic import BaseModel, Field

    app = FastAPI(title="PyChess move server", docs_url=None, redoc_url=None)
    app.add_middleware(CORSMiddleware, allow_origins=list(allowed_origins), allow_methods=["POST", "GET"],
                       allow_headers=["authorization", "content-type"], max_age=3600)
    searches = asyncio.Semaphore(max_concurrent_searches)   # bounds GPU memory per container

    class MoveRequest(BaseModel):
        fen: str = Field(min_length=10, max_length=100)
        pgn: str = Field(default="", max_length=MAX_PGN_CHARS)
        depth: int = Field(default=1, ge=1, le=MAX_DEPTH)

    def error(status: int, code: str, message: str, **extra):
        headers = {"Retry-After": str(extra["retry_after_s"])} if "retry_after_s" in extra else None
        return JSONResponse({"error": code, "message": message, **extra}, status_code=status, headers=headers)

    @app.get("/health")
    async def health():
        return {"ok": True}

    @app.post("/move")
    async def move(req: MoveRequest, authorization: Optional[str] = Header(default=None)):
        token = (authorization or "").removeprefix("Bearer ").strip()
        if not token:
            return error(401, "sign_in_required", "Sign in to play this bot.")
        try:
            game = game_from(req.fen, req.pgn)
        except BadRequest as err:
            return error(400, "bad_position", str(err))
        try:
            q = await quota.consume(token)
        except SignInRequired:
            return error(401, "sign_in_required", "Sign in to play this bot.")
        except QuotaUnavailable as err:
            log.warning("quota check failed: %s", err)
            return error(503, "unavailable", "The move server can't check your quota right now.")
        if not q.allowed:
            return error(429, "rate_limited", f"You've used all {q.limit} server moves this hour.",
                         limit=q.limit, remaining=0, retry_after_s=q.retry_after_s)
        async with searches:
            result = await run_in_threadpool(best_move, game, evaluate, min(req.depth, max_depth))
        return {**result.__dict__, "limit": q.limit, "remaining": q.remaining}

    return app
