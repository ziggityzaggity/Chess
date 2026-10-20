"""The heuristic planes (19-22) checked against python-chess, an independent implementation."""

from __future__ import annotations

import numpy as np
import pytest

import chess_engine as ce

chess = pytest.importorskip("chess")

VALUES = {chess.PAWN: 1, chess.KNIGHT: 3, chess.BISHOP: 3, chess.ROOK: 5, chess.QUEEN: 9, chess.KING: 100}
FENS = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1",
    "r3k3/8/3p4/4N3/4B2q/8/8/4K3 w - - 0 1",
    "rn1q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1BP2/PPPQ2PP/2KR1B1R b - - 4 10",
]


def reference(fen: str) -> np.ndarray:
    """Planes 19-22 in the side-to-move view, computed with python-chess."""
    board = chess.Board(fen)
    us = board.turn
    out = np.zeros((4, 8, 8), dtype=np.float32)
    for square in chess.SQUARES:
        rank, file = chess.square_rank(square), chess.square_file(square)
        row = 7 - rank if us == chess.WHITE else rank          # our back rank at the bottom
        for i, colour in enumerate((us, not us)):
            out[i, row, file] = min(len(board.attackers(colour, square)), 4) / 4
        piece = board.piece_at(square)
        if piece is None:
            continue
        attackers = board.attackers(not piece.color, square)
        cheapest = min((VALUES[board.piece_type_at(a)] for a in attackers), default=0)
        defended = bool(board.attackers(piece.color, square))
        danger = bool(attackers) and (cheapest < VALUES[piece.piece_type] or not defended)
        out[2 if piece.color == us else 3, row, file] = float(danger)
    return out


def positions(n: int = 400) -> list[str]:
    rng = np.random.default_rng(0)
    fens = list(FENS)
    for start in FENS:
        board = chess.Board(start)
        for _ in range(n // len(FENS)):
            moves = list(board.legal_moves)
            if not moves or board.is_game_over():
                board = chess.Board(start)
                continue
            board.push(moves[rng.integers(len(moves))])
            fens.append(board.fen())
    return fens


def test_heuristic_planes_match_python_chess():
    fens = positions()
    planes = ce.encode_boards(ce.boards_from_fens(fens), planes=ce.HEURISTIC_PLANES)
    for fen, x in zip(fens, planes):
        np.testing.assert_array_equal(x[19:], reference(fen), err_msg=fen)


def test_first_19_planes_are_the_standard_encoding():
    boards = ce.boards_from_fens(FENS)
    np.testing.assert_array_equal(ce.encode_boards(boards, planes=23)[:, :19], ce.encode_boards(boards))
    assert ce.Game(FENS[1]).encode(23).shape == (23, 8, 8)
    with pytest.raises(ValueError):
        ce.encode_boards(boards, planes=20)


def test_gpu_module_encodes_heuristic_planes():
    torch = pytest.importorskip("torch")
    from chess_engine import gpu

    boards = ce.boards_from_fens(FENS)
    x = gpu.encode(torch.from_numpy(boards), ce.HEURISTIC_PLANES)
    np.testing.assert_array_equal(x.numpy(), ce.encode_boards(boards, planes=23))
    if gpu.kernels_available():
        np.testing.assert_array_equal(gpu.encode(torch.from_numpy(boards).cuda(), 23).cpu().numpy(), x.numpy())
