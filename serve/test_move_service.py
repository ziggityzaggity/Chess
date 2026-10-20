"""Tests for the move server, on the CPU with the untrained fixture network.

    pytest serve
"""

from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
pytest.importorskip("onnxruntime")
pytest.importorskip("fastapi")
httpx = pytest.importorskip("httpx")

import chess_engine as ce  # noqa: E402
from chess_engine import player  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import move_service as ms  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[1] / "web" / "tests" / "fixtures" / "tiny_value_net.onnx"
MIDDLEGAME = "rn1q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1BP2/PPPQ2PP/2KR1B1R b - - 4 10"
SCHOLARS = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"


@pytest.fixture(scope="module")
def model():
    m = ms.OnnxModel(str(FIXTURE), providers=["CPUExecutionProvider"])
    m.warm_up()
    return m


# ----------------------------------------------------------------------------- the network
def test_model_matches_plain_onnxruntime(model):
    planes = ms.sample_planes(300)
    reference = player.OnnxEvaluator(str(FIXTURE), providers=["CPUExecutionProvider"])(planes)
    assert np.allclose(model(planes), reference, atol=1e-5)


@pytest.mark.parametrize("n", [1, 63, 64, 65, 1000, 8192, 8193, 20000])
def test_padding_to_buckets_never_changes_results(model, n):
    planes = np.resize(ms.sample_planes(300), (n, ce.NUM_PLANES, 8, 8)).astype(np.float32)
    got = model(planes)
    unpadded = player.softmax(model.session.run(None, {model.input_name: planes})[0])
    assert got.shape == (n, 3)
    assert np.allclose(got, unpadded, atol=1e-5)


def test_cpu_stays_in_float32(model):
    assert model.precision == "float32" and not model.on_gpu


# ----------------------------------------------------------------------------- positions
def test_game_from_fen():
    assert ms.game_from(MIDDLEGAME).fen() == ce.Game(MIDDLEGAME).fen()


def test_history_makes_repetitions_count():
    moves = "1. Nf3 Nf6 2. Ng1 Ng8 3. Nf3 Nf6 4. Ng1"
    game = ce.Game()
    for san in ce.san_tokens(moves)[0]:
        game.push_san(san)
    with_history = ms.game_from(game.fen(), moves)
    assert with_history.ply == 7
    with_history.push_san("Ng8")                      # the start position for the third time
    assert with_history.is_threefold()


def test_history_that_does_not_lead_to_the_fen_is_ignored():
    game = ms.game_from(MIDDLEGAME, "1. e4 e5")
    assert game.fen() == ce.Game(MIDDLEGAME).fen()


@pytest.mark.parametrize("fen, pgn", [
    ("not a fen at all", ""),
    ("7k/6Q1/6K1/8/8/8/8/8 b - - 0 1", ""),           # checkmated
    (MIDDLEGAME, "x" * (ms.MAX_PGN_CHARS + 1)),
])
def test_bad_requests(fen, pgn):
    with pytest.raises(ms.BadRequest):
        ms.game_from(fen, pgn)


def test_depth_falls_back_when_the_tree_is_too_big():
    game = ce.Game(MIDDLEGAME)
    assert ms.affordable_depth(game, 3) == 3
    assert ms.affordable_depth(game, 3, max_positions=5_000) == 2
    assert ms.affordable_depth(game, 3, max_positions=10) == 1


# ----------------------------------------------------------------------------- the search
@pytest.mark.parametrize("depth", [1, 2, 3])
def test_best_move_matches_the_player(model, depth):
    game = ce.Game(MIDDLEGAME)
    result = ms.best_move(game, model, depth)
    expected = player.choose_move(game, model, depth=depth)
    assert result.move == expected.uci and result.depth == depth
    assert result.move in game.legal_uci() and result.positions > 0


def test_mate_in_one_needs_no_network(model):
    result = ms.best_move(ce.Game(SCHOLARS), model, 3)
    assert result.san == "Qxf7#" and result.positions == 0


# ----------------------------------------------------------------------------- the API
class FakeQuota:
    def __init__(self, outcome):
        self.outcome, self.calls = outcome, 0

    async def consume(self, token):
        self.calls += 1
        if isinstance(self.outcome, Exception):
            raise self.outcome
        return self.outcome


ALLOWED = ms.Quota(allowed=True, limit=200, remaining=150)


def client(model, quota):
    return TestClient(ms.create_app(model, quota, ["https://www.pychess.app"]))


def test_move(model):
    quota = FakeQuota(ALLOWED)
    r = client(model, quota).post("/move", json={"fen": MIDDLEGAME, "depth": 2},
                                  headers={"Authorization": "Bearer token"})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["move"] in ce.Game(MIDDLEGAME).legal_uci()
    assert body["depth"] == 2 and body["remaining"] == 150 and body["limit"] == 200
    assert quota.calls == 1


def test_sign_in_is_required(model):
    quota = FakeQuota(ALLOWED)
    r = client(model, quota).post("/move", json={"fen": MIDDLEGAME})
    assert r.status_code == 401 and r.json()["error"] == "sign_in_required" and quota.calls == 0
    r = client(model, FakeQuota(ms.SignInRequired())).post(
        "/move", json={"fen": MIDDLEGAME}, headers={"Authorization": "Bearer guest-or-expired"})
    assert r.status_code == 401


def test_bad_positions_spend_no_quota(model):
    quota = FakeQuota(ALLOWED)
    c = client(model, quota)
    for body in ({"fen": "nonsense fen"}, {"fen": "7k/6Q1/6K1/8/8/8/8/8 b - - 0 1"}):
        r = c.post("/move", json=body, headers={"Authorization": "Bearer t"})
        assert r.status_code == 400 and r.json()["error"] == "bad_position"
    r = c.post("/move", json={"fen": MIDDLEGAME, "depth": 4}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 422
    assert quota.calls == 0


def test_hourly_limit(model):
    quota = FakeQuota(ms.Quota(allowed=False, limit=200, remaining=0, retry_after_s=1234))
    r = client(model, quota).post("/move", json={"fen": MIDDLEGAME}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 429 and r.headers["Retry-After"] == "1234"
    assert r.json()["retry_after_s"] == 1234 and r.json()["error"] == "rate_limited"


def test_quota_outage(model):
    r = client(model, FakeQuota(ms.QuotaUnavailable("timeout"))).post(
        "/move", json={"fen": MIDDLEGAME}, headers={"Authorization": "Bearer t"})
    assert r.status_code == 503


def test_cors_allows_only_the_site(model):
    c = client(model, FakeQuota(ALLOWED))
    ok = c.options("/move", headers={"Origin": "https://www.pychess.app", "Access-Control-Request-Method": "POST",
                                     "Access-Control-Request-Headers": "authorization,content-type"})
    assert ok.headers.get("access-control-allow-origin") == "https://www.pychess.app"
    bad = c.options("/move", headers={"Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


# ----------------------------------------------------------------------------- Supabase
@pytest.mark.parametrize("status, body, outcome", [
    (200, {"allowed": True, "limit": 200, "remaining": 7}, ms.Quota(True, 200, 7, 0)),
    (200, {"allowed": False, "limit": 200, "remaining": 0, "retry_after_s": 60}, ms.Quota(False, 200, 0, 60)),
    (401, {"code": "PT401"}, ms.SignInRequired),
    (403, {}, ms.SignInRequired),
    (500, {}, ms.QuotaUnavailable),
])
def test_supabase_quota(status, body, outcome):
    import asyncio

    seen = {}

    def handler(request):
        seen.update(url=str(request.url), auth=request.headers["authorization"], key=request.headers["apikey"])
        return httpx.Response(status, json=body)

    quota = ms.SupabaseQuota("https://ref.supabase.co/", "anon-key")
    quota.client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    if isinstance(outcome, ms.Quota):
        assert asyncio.run(quota.consume("user-token")) == outcome
    else:
        with pytest.raises(outcome):
            asyncio.run(quota.consume("user-token"))
    assert seen == {"url": "https://ref.supabase.co/rest/v1/rpc/consume_model_move",
                    "auth": "Bearer user-token", "key": "anon-key"}
