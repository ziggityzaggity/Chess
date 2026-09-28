"""PyChess chess engine for Python and PyTorch.

The C++ core (core/*.hpp) compiled with pybind11, plus helpers for training
and playing with a neural network.

Playing a game, one turn at a time::

    import chess_engine as ce
    g = ce.Game()
    g.push_san("e4")
    x = g.encode()                  # (19, 8, 8) float32 network input
    boards, moves = g.children()    # every position one legal move away

Bulk data for training (numpy, multithreaded C++, GIL released)::

    games = ce.split_pgn(open("games.pgn").read())
    data = ce.replay_games([movetext for _, movetext in games])
    X = ce.encode_boards(data["boards"])          # (P, 19, 8, 8)

The same batch operations on PyTorch tensors, on the GPU if available, live in
``chess_engine.gpu``; move selection with a value network in
``chess_engine.player``.

Positions travel as 72-byte ``chess::Board`` records, i.e. uint8 arrays of
shape (N, 72); ``board_fields`` views them as named fields.
"""

from __future__ import annotations

import numpy as np

from ._core import (  # noqa: F401  (re-exported API)
    BLACK,
    BOARD_BYTES,
    CUDA_COMPILED,
    NUM_PLANES,
    PLANE_NAMES,
    WHITE,
    DrawReason,
    Game,
    Move,
    Result,
    Status,
    board_from_fen,
    board_to_fen,
    board_to_string,
    boards_from_fens,
    count_legal,
    cuda_available,
    cuda_build_info,
    cuda_device_count,
    cuda_device_name,
    cuda_perft,
    encode_boards,
    expand_boards,
    moves_to_uci,
    perft,
    perft_batch,
    replay_games,
    san_tokens,
    split_pgn,
    startpos,
)

__version__ = "0.2.0"

# Layout of chess::Board (core/chess.hpp), pinned there by static_asserts.
BOARD_DTYPE = np.dtype(
    {
        "names": ["sq", "side", "castling", "ep", "halfmove", "fullmove"],
        "formats": [("u1", (64,)), "u1", "u1", "i1", "<u2", "<u2"],
        "offsets": [0, 64, 65, 66, 68, 70],
        "itemsize": BOARD_BYTES,
    }
)

# Castling-right bits in the `castling` field.
CASTLE_WHITE_KINGSIDE, CASTLE_WHITE_QUEENSIDE = 1, 2
CASTLE_BLACK_KINGSIDE, CASTLE_BLACK_QUEENSIDE = 4, 8

# Index of each outcome in the value network's output (side-to-move view).
WIN, DRAW, LOSS = 0, 1, 2


def board_fields(boards: np.ndarray) -> np.ndarray:
    """View (N, 72) uint8 boards as structured records.

    Fields: ``sq`` (64 square bytes: 0 empty, else colour * 8 + type with
    type P=1 N=2 B=3 R=4 Q=5 K=6), ``side`` (0 white, 1 black to move),
    ``castling`` (bit mask, see CASTLE_*), ``ep`` (en-passant target square
    or -1), ``halfmove`` and ``fullmove``.
    """
    arr = np.ascontiguousarray(boards, dtype=np.uint8).reshape(-1, BOARD_BYTES)
    return arr.view(BOARD_DTYPE).reshape(-1)
