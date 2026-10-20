"""Fast CPU checks of ai/dqn_training.py: move indices, targets, transitions, training, export.

    pytest ai/test_dqn_training.py
"""

import json
from pathlib import Path

import pytest

np = pytest.importorskip("numpy")
torch = pytest.importorskip("torch")
pytest.importorskip("pandas")
pytest.importorskip("sklearn")
pytest.importorskip("onnx")

import chess_engine as ce  # noqa: E402

import dqn_training as dq  # noqa: E402

PGN = Path(__file__).parent / "data" / "twic_otb2300.pgn"
MEDIUM = Path(__file__).parents[1] / "web" / "public" / "models" / "value_net_medium.onnx"
SCHOLARS = "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4"     # Qxf7#
MATED = "r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4"
PROMOTIONS = "1n5k/P1P5/8/8/8/8/5p1p/K5N1 w - - 0 1"


def tiny(formulation="afterstate", **kw):
    return dq.config_for("smoke", formulation=formulation, **kw)


@pytest.fixture(scope="module")
def pool():
    return dq.pgn_start_pool(PGN, 20, max_games=60)


# ----------------------------------------------------------------------------- moves
def test_move_index_is_unique_and_colour_symmetric(pool):
    boards = torch.from_numpy(np.concatenate([pool[:300], ce.boards_from_fens([PROMOTIONS, SCHOLARS])]))
    kids, moves, parent, _ = dq.gpu.expand(boards)
    index = dq.move_index(moves, boards[parent, 64] != 0)
    assert int(index.min()) >= 0 and int(index.max()) < dq.NUM_ACTIONS
    key = parent * dq.NUM_ACTIONS + index
    assert len(torch.unique(key)) == len(key)

    def index_of(fen, uci):
        g = ce.Game(fen)
        b = torch.from_numpy(g.board_array()).unsqueeze(0)
        _, mv, par, _ = dq.gpu.expand(b)
        i = [m.uci() for m in g.legal_moves()].index(uci)
        return int(dq.move_index(mv, b[par, 64] != 0)[i])

    start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
    e4 = index_of(start, "e2e4")
    assert e4 == 1 * 64 + 52                                   # north, 2 squares, from view square e2
    assert index_of("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1", "e7e5") == e4
    a7, c7 = 8, 10                                             # view squares (row 1)
    assert index_of(PROMOTIONS, "a7b8n") == (64 + 0 * 3 + 2) * 64 + a7   # knight under-promotion, capture right
    assert index_of(PROMOTIONS, "c7c8r") == (64 + 2 * 3 + 1) * 64 + c7   # rook, straight on
    assert index_of(PROMOTIONS, "c7c8q") == 0 * 64 + c7                  # queen promotion: north, 1 square


def test_hasher_sees_transpositions_not_rights():
    a, b = ce.Game(), ce.Game()
    for san in ["Nf3", "Nf6", "Nc3"]:
        a.push_san(san)
    for san in ["Nc3", "Nf6", "Nf3"]:
        b.push_san(san)
    h = dq.BoardHasher("cpu")
    boards = torch.from_numpy(np.stack([a.board_array(), b.board_array(),
                                        ce.board_from_fen("r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1"),
                                        ce.board_from_fen("r3k2r/8/8/8/8/8/8/R3K2R w Kkq - 0 1")]))
    out = h(boards)
    assert out[0] == out[1] and out[2] != out[3]


# ----------------------------------------------------------------------------- networks
def test_heuristic_features_at_the_start():
    x = torch.from_numpy(ce.encode_boards(ce.startpos()[None], planes=23))
    f = dq.heuristic_features(x)[0]
    assert f.shape == (dq.N_FEATURES,) == (len(dq.FEATURE_NAMES),)
    assert f[:12].tolist() == [8, 2, 2, 2, 1, 1] * 2
    assert f[12:].abs().sum() == 0                            # nothing in danger, nothing in the centre


@pytest.mark.parametrize("formulation, shape", [("afterstate", (5, 3)), ("action_head", (5, dq.NUM_ACTIONS))])
def test_networks(formulation, shape):
    net = dq.build_qnet(tiny(formulation)).eval()
    assert net.input_planes == 23 and net(torch.zeros(5, 23, 8, 8)).shape == shape


def test_onnx_value_net_matches_onnxruntime():
    net = dq.load_onnx_value_net(MEDIUM)
    x = ce.encode_boards(dq.pgn_sample_boards())
    reference = dq.player.OnnxEvaluator(str(MEDIUM), providers=["CPUExecutionProvider"])(x)
    with torch.no_grad():
        got = torch.softmax(net(torch.from_numpy(x)), 1).numpy()
    assert np.allclose(got, reference, atol=1e-5)


# ----------------------------------------------------------------------------- targets
def test_mover_target_flips_and_discounts():
    win = torch.tensor([[1.0, 0.0, 0.0]])
    assert torch.allclose(dq.mover_target(win, torch.tensor([2]), 1.0), win)
    assert torch.allclose(dq.mover_target(win, torch.tensor([1]), 1.0), torch.tensor([[0.0, 0.0, 1.0]]))
    half = dq.mover_target(win, torch.tensor([2]), 0.5)        # 0.25 of the win is left, the rest a draw
    assert torch.allclose(half, torch.tensor([[0.25, 0.75, 0.0]]))


@pytest.mark.parametrize("formulation", ["afterstate", "action_head"])
def test_bootstrap_uses_the_rules(formulation):
    net = dq.build_qnet(tiny(formulation))
    d = torch.from_numpy(ce.boards_from_fens([SCHOLARS, MATED, SCHOLARS]))
    done = torch.tensor([0, 1, 2], dtype=torch.uint8)
    dist = dq.bootstrap_dist(d, done, net, net)
    assert dist.tolist() == [[1.0, 0.0, 0.0], [0.0, 0.0, 1.0], [0.0, 1.0, 0.0]]   # mate in one, mated, a draw


# ----------------------------------------------------------------------------- games
@pytest.mark.parametrize("opponent", ["self", "cnn"])
def test_transitions(pool, opponent):
    cfg = tiny(opponent=opponent, parallel_games=6, max_plies=24, n_step=2)
    net = dq.build_qnet(cfg)
    opp = dq.load_onnx_value_net(MEDIUM) if opponent == "cnn" else None
    games = dq.SelfPlay(cfg, net, pool, "cpu", opp, seed=1)
    batches = [b for b in (games.step(0.05, 0.1) for _ in range(60)) if b is not None]
    assert batches
    batch = {k: torch.cat([b[k] for b in batches]) for k in batches[0]}
    stride = 1 if opponent == "self" else 2
    assert int(batch["m"].max()) <= cfg.n_step * stride
    for i in range(min(len(batch["a"]), 40)):
        s, x = batch["s"][i:i + 1], batch["x"][i]
        kids, moves, parent, _ = dq.gpu.expand(s)
        hit = (kids == x).all(1).nonzero().squeeze(1)                # x is a child of s ...
        assert len(hit) == 1
        assert int(dq.move_index(moves[hit], s[0:1, 64] != 0)) == int(batch["a"][i])   # ... by move a
        m = int(batch["m"][i])
        assert m >= 1 and (batch["d"][i, 64] == s[0, 64]) == (m % 2 == 0)
        if opponent == "cnn":
            assert m % 2 == 0 or int(batch["done"][i]) != 0         # the learner's own turn, unless the game ended
        if int(batch["done"][i]) == 0 and m < cfg.n_step * stride:
            _, st = ce.count_legal(batch["d"][i:i + 1].numpy())
            assert int(st[0]) == int(ce.Status.ONGOING)              # a short window means the game was cut off
    assert sum(games.endings.values()) > 0


def test_repetition_ends_the_game():
    cfg = tiny(parallel_games=1, max_plies=40, pgn_start_frac=0.0, random_opening_plies=0)
    games = dq.SelfPlay(cfg, dq.build_qnet(cfg), None, "cpu", seed=0)
    shuffle = ["g1f3", "g8f6", "f3g1", "f6g8"] * 2
    for i, uci in enumerate(shuffle):
        board = games.current()
        kids, moves, _, _ = dq.gpu.expand(board)
        target = [j for j, m in enumerate(ce.moves_to_uci(moves.numpy())) if m == uci][0]
        # play the move by hand through the same bookkeeping as step()
        games.actions[0, games.ply[0]] = 0
        games.learner_moved[0, games.ply[0]] = True
        games.ply += 1
        games.traj[0, games.ply[0]] = kids[target]
        games.hashes[0, games.ply[0]] = games.hasher(kids[target:target + 1])[0]
    seen = int((games.hashes[0, :games.ply[0] + 1] == games.hashes[0, games.ply[0]]).sum())
    assert seen == 3                                                  # the start position, a third time


# ----------------------------------------------------------------------------- training and export
@pytest.mark.parametrize("formulation", ["afterstate", "action_head"])
def test_train_resume_and_deploy(tmp_path, pool, formulation):
    cfg = tiny(formulation, max_minutes=None, total_positions=300, eval_every_minutes=0.05,
               checkpoint_every_minutes=0.05, eval_games=2, eval_max_plies=20, max_plies=30, warmup=16)
    state = dq.train(cfg, tmp_path / "run", "cpu", start_pool=pool, log=lambda *_: None)
    assert state["finished"] and state["train_steps"] > 0 and state["history"]
    assert json.loads((tmp_path / "run" / "history.json").read_text())[-1]["positions"] == state["positions"]
    again = dq.train(dq.replace(cfg, total_positions=600),
                     tmp_path / "run", "cpu", start_pool=pool, log=lambda *_: None)
    assert again["positions"] > state["positions"]                   # resumed, then trained further
    with pytest.raises(ValueError):                                  # other settings: refuse to resume
        dq.train(dq.replace(cfg, n_step=7), tmp_path / "run", "cpu", start_pool=pool, log=lambda *_: None)

    models = tmp_path / "models"
    if formulation == "action_head":
        with pytest.raises(ValueError):
            dq.deploy(tmp_path / "run", models, force=True)
        return
    if not again["best"]["beats_greedy"]:
        with pytest.raises(RuntimeError):
            dq.deploy(tmp_path / "run", models)
    entry = dq.deploy(tmp_path / "run", models, force=True)
    assert entry["id"] == "dqn-small" and entry["encoding"] == dq.ENCODING and entry["planes"] == 23
    manifest = json.loads((models / "manifest.json").read_text())
    assert [m["id"] for m in manifest["models"]] == ["dqn-small"]
    evaluator = dq.player.load_evaluator(str(models / entry["file"]))
    assert evaluator.input_planes == 23
    move = dq.player.choose_move(ce.Game(SCHOLARS), evaluator)
    assert move.uci == "h5f7"                                         # mate in one, through the ONNX file
