"""Tests for the chess_engine Python bindings (CPU paths; GPU paths run when available)."""

from __future__ import annotations

import pathlib

import numpy as np
import pytest

import chess_engine as ce

ROOT = pathlib.Path(__file__).resolve().parents[3]
START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1"
KIWIPETE = "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1"


def sample_boards(n_levels: int = 2) -> np.ndarray:
    level = ce.boards_from_fens([START, KIWIPETE])
    out = [level]
    for _ in range(n_levels):
        level = ce.expand_boards(level)[0]
        out.append(level)
    return np.concatenate(out)


# ----------------------------------------------------------------------------- Game
def test_game_basics():
    g = ce.Game()
    assert g.turn == ce.WHITE and len(g.legal_moves()) == 20
    for san in ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6"]:
        assert g.push_san(san)
    mate = g.parse_san("Qxf7#")
    assert g.san(mate) == "Qxf7#" and mate.uci() == "h5f7" and mate.is_capture()
    assert g.push(mate)
    assert g.is_checkmate() and g.result() == ce.Result.WHITE_WINS
    assert g.pgn() == "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#"
    assert g.undo() and not g.is_game_over() and g.redo() and g.is_checkmate()
    with pytest.raises(ValueError):
        ce.Game("not a fen")
    with pytest.raises(ValueError):
        ce.Game().parse_san("Ke2")
    assert ce.Game().parse_uci("e2e5") is None


def test_game_copy_is_independent():
    g = ce.Game()
    g.push_uci("e2e4")
    h = g.copy()
    h.push_uci("e7e5")
    assert g.ply == 1 and h.ply == 2


def test_game_encode_and_children():
    g = ce.Game()
    g.push_san("e4")
    x = g.encode()
    assert x.shape == (19, 8, 8) and x.dtype == np.float32
    np.testing.assert_array_equal(x, ce.encode_boards(g.board_array())[0])
    boards, moves = g.children()
    assert boards.shape == (20, 72) and len(moves) == 20
    assert [m.uci() for m in moves] == g.legal_uci()
    for b, m in zip(boards, moves):  # each child is the position after that move
        h = g.copy()
        h.push(m)
        assert ce.board_to_fen(b) == h.fen()


def test_board_fields_layout():
    b = ce.board_from_fen("r3k2r/8/8/8/4P3/8/8/R3K2R b Kq e3 7 30")
    f = ce.board_fields(b)[0]
    assert f["side"] == ce.BLACK
    assert f["castling"] == ce.CASTLE_WHITE_KINGSIDE | ce.CASTLE_BLACK_QUEENSIDE
    assert ce.board_to_fen(b) == "r3k2r/8/8/8/4P3/8/8/R3K2R b Kq e3 7 30"
    assert f["ep"] == 5 * 8 + 4  # e3 = row 5, col 4
    assert (f["halfmove"], f["fullmove"]) == (7, 30)
    assert f["sq"][0] == 8 + 4 and f["sq"][60] == 6  # black rook a8, white king e1


def test_board_bytes_are_deterministic():
    """Byte 67 is an explicit zero field (not padding), so arrays compare byte-wise."""
    boards = sample_boards()
    assert (boards[:, 67] == 0).all()
    children = ce.expand_boards(boards)[0]
    assert (children[:, 67] == 0).all()
    again = ce.expand_boards(boards)[0]
    np.testing.assert_array_equal(children, again)


# ----------------------------------------------------------------------------- encoding
def test_encoding_planes():
    x = ce.encode_boards(ce.startpos())[0]
    assert ce.NUM_PLANES == 19 and len(ce.PLANE_NAMES) == 19
    assert x[0].sum() == 8 and x[6].sum() == 8           # our / their pawns
    assert x[5, 7, 4] == 1 and x[11, 0, 4] == 1          # our king e1, their king e8
    assert all(x[p].sum() == 64 for p in range(12, 16))  # all castling rights
    assert x[16].sum() == 0 and x[17].sum() == 0 and x[18].sum() == 64
    # Each square holds at most one piece plane.
    boards = sample_boards()
    enc = ce.encode_boards(boards)
    assert enc[:, :12].sum(axis=1).max() == 1


def test_encoding_is_colour_symmetric():
    """A position and its colour-flipped mirror encode identically."""
    a = ce.encode_boards(ce.board_from_fen("r3k2r/8/8/8/4P3/8/8/R3K2R b Kq e3 7 30"))
    b = ce.encode_boards(ce.board_from_fen("r3k2r/8/8/4p3/8/8/8/R3K2R w Qk e6 7 30"))
    np.testing.assert_array_equal(a, b)


def test_threads_do_not_change_results():
    boards = sample_boards()
    np.testing.assert_array_equal(ce.encode_boards(boards, threads=1), ce.encode_boards(boards, threads=4))
    c1, s1 = ce.count_legal(boards, threads=1)
    c4, s4 = ce.count_legal(boards, threads=4)
    np.testing.assert_array_equal(c1, c4)
    np.testing.assert_array_equal(s1, s4)


def test_invalid_board_bytes_do_not_crash():
    rng = np.random.default_rng(0)
    junk = rng.integers(0, 256, size=(256, 72), dtype=np.uint8)
    enc = ce.encode_boards(junk)
    assert np.isfinite(enc).all()
    ce.count_legal(junk)


def test_bad_shapes_rejected():
    with pytest.raises(ValueError):
        ce.encode_boards(np.zeros((3, 71), np.uint8))
    with pytest.raises(ValueError):
        ce.board_to_fen(np.zeros((2, 72), np.uint8))


# ----------------------------------------------------------------------------- batch move generation
def test_perft_all_paths_agree():
    for fen, depth, expected in [(START, 4, 197281), (KIWIPETE, 3, 97862)]:
        assert ce.perft(fen, depth) == expected
        assert ce.perft_batch(fen, depth) == expected


def test_expand_matches_game_children():
    boards = sample_boards(1)
    children, moves, parent, offsets = ce.expand_boards(boards)
    counts, status = ce.count_legal(boards)
    np.testing.assert_array_equal(np.diff(offsets), counts)
    np.testing.assert_array_equal(parent, np.repeat(np.arange(len(boards)), counts))
    for i in range(0, len(boards), 17):
        g = ce.Game(ce.board_to_fen(boards[i]))
        kids, mv = g.children()
        lo, hi = offsets[i], offsets[i + 1]
        np.testing.assert_array_equal(children[lo:hi], kids)
        assert ce.moves_to_uci(moves[lo:hi]) == [m.uci() for m in mv]


def test_status_codes():
    fens = {
        "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3": ce.Status.CHECKMATE,
        "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1": ce.Status.STALEMATE,
        "8/8/4k3/8/8/3K1B2/8/8 w - - 0 1": ce.Status.INSUFFICIENT_MATERIAL,
        "8/8/4k3/8/8/3K1R2/8/8 w - - 100 80": ce.Status.FIFTY_MOVE,
        START: ce.Status.ONGOING,
    }
    _, status = ce.count_legal(ce.boards_from_fens(list(fens)))
    assert [ce.Status(int(s)) for s in status] == list(fens.values())


# ----------------------------------------------------------------------------- PGN
def test_san_tokens():
    toks, result = ce.san_tokens("1. e4 {c} e5 2.Nf3 (2. f4 exf4) Nc6 $1 3. Bb5!? 1-0")
    assert toks == ["e4", "e5", "Nf3", "Nc6", "Bb5!?"] and result == "1-0"


def test_split_and_replay_pgn():
    text = (ROOT / "pgns" / "WorldChamp2018.pgn").read_text()
    games = ce.split_pgn(text)
    assert len(games) == 15 and games[0][0]["White"] == "Caruana, Fabiano"
    data = ce.replay_games([m for _, m in games], threads=2)
    assert all(e == "" for e in data["error"]) and (data["error_ply"] == -1).all()
    assert len(data["boards"]) == int(data["n_plies"].sum()) + len(games)
    assert [t["Result"] for t, _ in games] == data["result_token"]
    # Positions are ordered by game, then ply; next_move is the move played.
    first = data["game"] == 0
    assert (data["ply"][first] == np.arange(first.sum())).all()
    g = ce.Game()
    for p in range(5):
        assert ce.board_to_fen(data["boards"][p]) == g.fen()
        g.push_uci(ce.moves_to_uci(data["next_move"][p])[0])


def test_replay_reports_errors():
    data = ce.replay_games(["1. e4 e5 2. Ke3 Nc6", "1. d4 d5 *"])
    assert data["error_ply"].tolist() == [2, -1]
    assert "Ke3" in data["error"][0] and data["error"][1] == ""
    assert data["n_plies"].tolist() == [2, 2]
    fen_start = ce.replay_games(["1... e5"], fens=["rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"])
    assert fen_start["error_ply"][0] == -1


def test_training_data_replays_like_python_chess():
    """Cross-check SAN parsing and move generation against python-chess."""
    chess = pytest.importorskip("chess")
    path = ROOT / "ai" / "data" / "twic_otb2300.pgn"
    if not path.exists():
        pytest.skip("training data not present")
    games = ce.split_pgn(path.read_text())[::50]          # every 50th game
    data = ce.replay_games([m for _, m in games])
    assert all(e == "" for e in data["error"])
    row = 0
    for gi, (_, movetext) in enumerate(games):
        board = chess.Board()
        sans, _ = ce.san_tokens(movetext)
        fens = [board.fen()]
        for san in sans:
            board.push_san(san)
            fens.append(board.fen())
        n = data["n_plies"][gi] + 1
        ours = [ce.board_to_fen(b) for b in data["boards"][row:row + n]]
        # python-chess only records an en-passant square when a capture is
        # possible; compare the other five FEN fields plus that rule.
        for mine, theirs in zip(ours, fens):
            a, b = mine.split(), theirs.split()
            assert a[:3] + a[4:] == b[:3] + b[4:], (mine, theirs)
            assert b[3] == "-" or a[3] == b[3]
        row += n
    assert row == len(data["boards"])
