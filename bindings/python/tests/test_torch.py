"""Tests for chess_engine.gpu (PyTorch batch ops) and chess_engine.player."""

from __future__ import annotations

import ctypes
import random

import numpy as np
import pytest

torch = pytest.importorskip("torch")

import chess_engine as ce  # noqa: E402
from chess_engine import gpu, player  # noqa: E402

KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"


def sample_boards() -> torch.Tensor:
    level = ce.boards_from_fens([ce.board_to_fen(ce.startpos()), KIWIPETE])
    out = [level]
    for _ in range(2):
        level = ce.expand_boards(level)[0]
        out.append(level)
    return torch.from_numpy(np.concatenate(out))


def test_encode_torch_matches_cpp():
    boards = sample_boards()
    ref = torch.from_numpy(ce.encode_boards(boards.numpy()))
    assert torch.equal(gpu.encode(boards), ref)
    assert torch.equal(gpu.encode_torch(boards), ref)
    rng = np.random.default_rng(1)
    junk = torch.from_numpy(rng.integers(0, 256, size=(512, 72), dtype=np.uint8))
    assert torch.equal(gpu.encode_torch(junk), torch.from_numpy(ce.encode_boards(junk.numpy())))


def test_cpu_batch_ops_and_self_test():
    assert gpu.perft(KIWIPETE, 3, "cpu") == 97862
    assert gpu.self_test("cpu", verbose=False)
    children, moves, parent, offsets = gpu.expand(sample_boards()[:5])
    counts, _ = gpu.count_legal(sample_boards()[:5])
    assert torch.equal(offsets.diff(), counts.long())
    assert children.shape[0] == moves.shape[0] == parent.shape[0] == int(offsets[-1])


def test_rejects_bad_input():
    with pytest.raises(TypeError):
        gpu.encode(torch.zeros(2, 72, dtype=torch.int32))
    with pytest.raises(ValueError):
        gpu.encode(torch.zeros(2, 70, dtype=torch.uint8))
    # Misaligned storage is copied rather than handed to C++ as-is.
    raw = torch.from_numpy(np.concatenate([np.zeros(1, np.uint8), ce.startpos()]))
    assert torch.equal(gpu.encode(raw[1:]), gpu.encode(torch.from_numpy(ce.startpos())))


def _array(ptr: int, count: int, ctype, dtype):
    return np.ctypeslib.as_array((ctype * count).from_address(ptr)).view(dtype)


@pytest.fixture
def fake_gpu(monkeypatch):
    """Run gpu.py's CUDA code path on CPU tensors with CPU stand-in kernels.

    Exercises the pointer passing, prefix sums and output allocation that the
    real kernels rely on; the kernels themselves are covered by the C++
    emulation test (core/gpu/emulation_test.cpp).
    """
    def enc(bp, n, op, device, stream):
        boards = _array(bp, n * 72, ctypes.c_uint8, np.uint8).reshape(n, 72)
        _array(op, n * 19 * 64, ctypes.c_float, np.float32)[:] = ce.encode_boards(boards).ravel()

    def count(bp, n, cp, sp, device, stream):
        boards = _array(bp, n * 72, ctypes.c_uint8, np.uint8).reshape(n, 72)
        c, s = ce.count_legal(boards)
        _array(cp, n, ctypes.c_int32, np.int32)[:] = c
        if sp:
            _array(sp, n, ctypes.c_uint8, np.uint8)[:] = s

    def expand(bp, n, offp, chp, mvp, pp, device, stream):
        boards = _array(bp, n * 72, ctypes.c_uint8, np.uint8).reshape(n, 72)
        offsets = _array(offp, n + 1, ctypes.c_int64, np.int64)
        ch, mv, par, off = ce.expand_boards(boards)
        np.testing.assert_array_equal(off, offsets)       # gpu.py's scan agrees
        m = len(ch)
        _array(chp, m * 72, ctypes.c_uint8, np.uint8)[:] = ch.ravel()
        if mvp:
            _array(mvp, m * 4, ctypes.c_uint8, np.uint8)[:] = mv.ravel()
        if pp:
            _array(pp, m, ctypes.c_int64, np.int64)[:] = par

    monkeypatch.setattr(gpu, "_on_gpu", lambda t: True)
    monkeypatch.setattr(gpu, "_stream", lambda device: 0)
    monkeypatch.setattr(gpu._core, "cuda_encode", enc)
    monkeypatch.setattr(gpu._core, "cuda_count_legal", count)
    monkeypatch.setattr(gpu._core, "cuda_expand", expand)


def test_cuda_code_path_with_fake_kernels(fake_gpu):
    boards = sample_boards()
    assert torch.equal(gpu.encode(boards), torch.from_numpy(ce.encode_boards(boards.numpy())))
    c, s = gpu.count_legal(boards)
    c_ref, s_ref = ce.count_legal(boards.numpy())
    assert torch.equal(c, torch.from_numpy(c_ref)) and torch.equal(s, torch.from_numpy(s_ref))
    got = gpu.expand(boards)
    for a, b in zip(got, ce.expand_boards(boards.numpy())):
        assert torch.equal(a, torch.from_numpy(b))
    assert gpu.perft(KIWIPETE, 3, "cpu") == 97862
    empty = gpu.expand(torch.zeros((0, 72), dtype=torch.uint8))
    assert empty[0].shape == (0, 72) and empty[3].tolist() == [0]


@pytest.mark.skipif(not (torch.cuda.is_available() and gpu.kernels_available()),
                    reason="needs a GPU and chess_engine built with CUDA")
def test_real_gpu_self_test():
    assert gpu.self_test("cuda", sample_boards(), verbose=True)
    assert ce.cuda_perft(ce.board_to_fen(ce.startpos()), 4) == 197281


# ----------------------------------------------------------------------------- player
class MaterialNet(torch.nn.Module):
    """Stand-in value network: confident logits from the material balance."""

    VALUES = torch.tensor([1.0, 3.0, 3.0, 5.0, 9.0, 0.0]) * 10   # a pawn up ~ certain win

    def forward(self, x):
        counts = x[:, :12].sum(dim=(2, 3))
        bal = (counts[:, :6] - counts[:, 6:]) @ self.VALUES.to(x.device)
        return torch.stack([bal, torch.zeros_like(bal), -bal], dim=1)


def test_choose_move_takes_mate_and_material():
    evaluate = player.TorchEvaluator(MaterialNet(), device="cpu")
    g = ce.Game("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1")     # back-rank mate available
    best = player.choose_move(g, evaluate)
    assert best.san == "Rd8#" and best.score == 1.0 and best.terminal == "checkmate"
    g = ce.Game("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1")          # pawn takes the queen
    assert player.choose_move(g, evaluate).san == "exd5"
    assert player.choose_move(ce.Game("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"), evaluate) is None


def test_scores_are_from_the_movers_view():
    evaluate = player.TorchEvaluator(MaterialNet(), device="cpu")
    g = ce.Game("4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1")
    scored = {s.san: s for s in player.score_moves(g, evaluate)}
    assert scored["exd5"].score > 0.99 and scored["exd5"].wdl[0] > 0.99
    assert scored["e5"].score < 0.01
    assert abs(sum(scored["e5"].wdl) - 1.0) < 1e-6


def test_repetition_scores_as_draw():
    evaluate = player.TorchEvaluator(MaterialNet(), device="cpu")
    g = ce.Game()
    for uci in ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1"]:
        g.push_uci(uci)
    scored = {s.uci: s for s in player.score_moves(g, evaluate)}
    assert scored["f6g8"].terminal == "threefold repetition" and scored["f6g8"].score == 0.5
    assert g.ply == 7 and not g.can_redo()                       # game untouched


def test_temperature_sampling_varies():
    evaluate = player.TorchEvaluator(MaterialNet(), device="cpu")
    rng = random.Random(3)
    picks = {player.choose_move(ce.Game(), evaluate, temperature=1.0, rng=rng).uci for _ in range(20)}
    assert len(picks) > 3


def test_select_moves_batched_matches_single():
    model = MaterialNet()
    fens = ["6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1",
            "4k3/8/8/4p3/3Q4/8/8/4K3 b - - 0 1"]
    boards = torch.from_numpy(ce.boards_from_fens(fens))
    out = player.select_moves(boards, model)
    assert ce.moves_to_uci(out["move"].numpy()) == ["d1d8", "e4d5", "e5d4"]
    assert out["score"][0] == 1.0 and int(out["status"][0]) == int(ce.Status.CHECKMATE)
    sampled = player.select_moves(boards, model, temperature=0.5, generator=torch.Generator().manual_seed(0))
    assert sampled["child"].shape == (3, 72)
    with pytest.raises(ValueError):
        player.select_moves(torch.from_numpy(ce.board_from_fen("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1")), model)
