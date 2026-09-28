"""Batch chess operations on PyTorch tensors — on the GPU when possible.

Every function takes boards as a uint8 tensor of shape (N, 72) (one
``chess::Board`` per row, see ``chess_engine.board_fields``) on any device and
returns tensors on that same device:

    encode(boards)       -> (N, 19, 8, 8) float32 network input
    count_legal(boards)  -> counts int32 (N,), status uint8 (N,)
    expand(boards)       -> children uint8 (M, 72), moves uint8 (M, 4),
                            parent int64 (M,), offsets int64 (N + 1,)

For CUDA tensors these launch the engine's CUDA kernels (core/gpu/) on the
current PyTorch stream: no host round trips, except reading the total child
count in ``expand``. The kernels share their chess logic with the CPU engine,
so results are identical on every device (``self_test`` checks this).

If the engine was built without CUDA, ``encode`` falls back to pure PyTorch
ops on the tensor's device (``encode_torch``, also the readable reference for
the encoding) and move generation to the multithreaded CPU engine, copying
boards to the host and back.
"""

from __future__ import annotations

import warnings

import torch

from . import _core

__all__ = [
    "kernels_available",
    "encode",
    "encode_torch",
    "count_legal",
    "expand",
    "perft",
    "self_test",
]

NUM_PLANES = _core.NUM_PLANES
BOARD_BYTES = _core.BOARD_BYTES
_warned = False


def kernels_available() -> bool:
    """True if the engine was built with CUDA and a GPU is visible."""
    return bool(_core.cuda_available())


def _as_boards(boards: torch.Tensor) -> torch.Tensor:
    if not isinstance(boards, torch.Tensor):
        raise TypeError("boards must be a torch.Tensor of dtype uint8")
    if boards.dtype != torch.uint8:
        raise TypeError(f"boards must be uint8, got {boards.dtype}")
    if boards.dim() == 1:
        boards = boards.unsqueeze(0)
    if boards.dim() != 2 or boards.shape[1] != BOARD_BYTES:
        raise ValueError(f"boards must have shape (N, {BOARD_BYTES}), got {tuple(boards.shape)}")
    boards = boards.contiguous()
    if boards.data_ptr() % 8:  # chess::Board is 8-byte aligned
        boards = boards.clone()
    return boards


def _on_gpu(t: torch.Tensor) -> bool:
    global _warned
    if not t.is_cuda:
        return False
    if kernels_available():
        return True
    if not _warned:
        warnings.warn(
            "chess_engine was built without CUDA kernels: move generation for CUDA tensors "
            "runs on the CPU. Reinstall on a machine with nvcc to enable the GPU path.",
            RuntimeWarning,
            stacklevel=3,
        )
        _warned = True
    return False


def _stream(device: torch.device) -> int:
    return torch.cuda.current_stream(device).cuda_stream


def encode(boards: torch.Tensor) -> torch.Tensor:
    """Network input for each board: (N, 19, 8, 8) float32, side-to-move view."""
    b = _as_boards(boards)
    n = b.shape[0]
    if _on_gpu(b):
        out = torch.empty((n, NUM_PLANES, 8, 8), dtype=torch.float32, device=b.device)
        if n:
            _core.cuda_encode(b.data_ptr(), n, out.data_ptr(), b.device.index, _stream(b.device))
        return out
    if b.is_cuda:
        return encode_torch(b)
    return torch.from_numpy(_core.encode_boards(b.numpy()))


def encode_torch(boards: torch.Tensor) -> torch.Tensor:
    """The encoding written in plain PyTorch ops (any device).

    A readable reference for core/encode.hpp and the fallback when the CUDA
    kernels are unavailable. Planes 0-11 one-hot the pieces (ours, then
    theirs), 12-15 are our/their king/queen-side castling rights, 16 the
    en-passant square, 17 the half-move clock / 100, 18 all ones. When black
    is to move the board is flipped vertically so "our" pieces are at the
    bottom.
    """
    b = _as_boards(boards).to(torch.int64)
    n, dev = b.shape[0], b.device
    side = b[:, 64]
    castling = b[:, 65]
    ep = b[:, 66]                                   # 0..63, or 255 (-1) for none
    halfmove = b[:, 68] | (b[:, 69] << 8)

    black = (side != 0).unsqueeze(1)                # black to move: rank r -> 9 - r
    view = torch.arange(64, device=dev)
    board_sq = torch.where(black, view ^ 56, view)  # board square shown at each view square
    piece = torch.gather(b[:, :64], 1, board_sq)
    ptype, pcolor = piece & 7, piece >> 3
    valid = (ptype >= 1) & (ptype <= 6) & (piece < 16)
    plane = torch.where(pcolor == black.to(torch.int64), ptype - 1, ptype + 5)

    out = torch.zeros((n, NUM_PLANES, 64), dtype=torch.float32, device=dev)
    out.scatter_(1, torch.where(valid, plane, 0).unsqueeze(1), valid.to(torch.float32).unsqueeze(1))

    white = side == 0
    wk, wq, bk, bq = ((castling >> i) & 1 for i in range(4))
    rights = [torch.where(white, wk, bk), torch.where(white, wq, bq),   # ours
              torch.where(white, bk, wk), torch.where(white, bq, wq)]   # theirs
    for i, r in enumerate(rights):
        out[:, 12 + i] = r.to(torch.float32).unsqueeze(1)
    has_ep = ep < 64
    ep_view = torch.where(white, ep, ep ^ 56).clamp(0, 63)
    out[:, 16].scatter_(1, ep_view.unsqueeze(1), has_ep.to(torch.float32).unsqueeze(1))
    out[:, 17] = (halfmove.clamp(max=100).to(torch.float32) / 100.0).unsqueeze(1)
    out[:, 18] = 1.0
    return out.view(n, NUM_PLANES, 8, 8)


def count_legal(boards: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
    """(counts int32 (N,), status uint8 (N,)): legal moves and Status of each board."""
    b = _as_boards(boards)
    n = b.shape[0]
    if _on_gpu(b):
        counts = torch.empty(n, dtype=torch.int32, device=b.device)
        status = torch.empty(n, dtype=torch.uint8, device=b.device)
        if n:
            _core.cuda_count_legal(b.data_ptr(), n, counts.data_ptr(), status.data_ptr(),
                                   b.device.index, _stream(b.device))
        return counts, status
    counts, status = _core.count_legal(b.cpu().numpy())
    return torch.from_numpy(counts).to(b.device), torch.from_numpy(status).to(b.device)


def expand(boards: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """All legal children of all boards.

    Returns (children (M, 72) uint8, moves (M, 4) uint8, parent (M,) int64,
    offsets (N + 1,) int64). Board i's children are rows
    ``offsets[i]:offsets[i + 1]``, in legal-move order.
    """
    b = _as_boards(boards)
    n, dev = b.shape[0], b.device
    if _on_gpu(b):
        stream = _stream(dev)
        counts = torch.empty(n, dtype=torch.int32, device=dev)
        if n:
            _core.cuda_count_legal(b.data_ptr(), n, counts.data_ptr(), 0, dev.index, stream)
        offsets = torch.zeros(n + 1, dtype=torch.int64, device=dev)
        offsets[1:] = torch.cumsum(counts, 0, dtype=torch.int64)
        total = int(offsets[-1])                    # the one sync: output size
        children = torch.empty((total, BOARD_BYTES), dtype=torch.uint8, device=dev)
        moves = torch.empty((total, 4), dtype=torch.uint8, device=dev)
        parent = torch.empty(total, dtype=torch.int64, device=dev)
        if total:
            _core.cuda_expand(b.data_ptr(), n, offsets.data_ptr(), children.data_ptr(),
                              moves.data_ptr(), parent.data_ptr(), dev.index, stream)
        return children, moves, parent, offsets
    children, moves, parent, offsets = _core.expand_boards(b.cpu().numpy())
    return tuple(torch.from_numpy(x).to(dev) for x in (children, moves, parent, offsets))


def perft(fen: str, depth: int, device: str | torch.device = "cuda") -> int:
    """Breadth-first perft through ``expand``/``count_legal`` on `device`."""
    level = torch.from_numpy(_core.board_from_fen(fen)).unsqueeze(0).to(device)
    if depth <= 0:
        return 1
    for _ in range(depth - 1):
        level = expand(level)[0]
    return int(count_legal(level)[0].sum())


PERFT_SUITE = [
    ("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 4, 197281),
    ("r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 3, 97862),
    ("8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 5, 674624),
    ("r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 4, 422333),
    ("rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 3, 62379),
]


def self_test(device: str | torch.device = "cuda", boards: torch.Tensor | None = None,
              verbose: bool = True) -> bool:
    """Check the batch ops on `device` against the CPU engine.

    Runs a perft suite (validates move generation, including castling, en
    passant and promotions) and, on `boards` (or perft positions), compares
    encode / count_legal / expand with the CPU implementation, element for
    element. Returns True if everything matches.
    """
    device = torch.device(device)
    ok = True

    def report(name: str, passed: bool, detail: str = "") -> None:
        nonlocal ok
        ok &= passed
        if verbose:
            print(f"  {'ok  ' if passed else 'FAIL'} {name} {detail}")

    for fen, depth, expected in PERFT_SUITE:
        got = perft(fen, depth, device)
        report(f"perft({depth}) {fen.split()[0][:24]:24s}", got == expected, f"{got} (expected {expected})")

    if boards is None:
        level = torch.from_numpy(_core.board_from_fen(PERFT_SUITE[1][0])).unsqueeze(0)
        for _ in range(2):
            level = torch.cat([level, expand(level)[0]])
        boards = level
    cpu = boards.cpu()
    dev = boards.to(device)

    ref = torch.from_numpy(_core.encode_boards(cpu.numpy()))
    report("encode matches CPU", torch.equal(encode(dev).cpu(), ref), f"on {len(cpu)} boards")
    report("encode_torch matches CPU", torch.equal(encode_torch(dev).cpu(), ref))

    c_ref, s_ref = _core.count_legal(cpu.numpy())
    c, s = count_legal(dev)
    report("count_legal matches CPU",
           torch.equal(c.cpu(), torch.from_numpy(c_ref)) and torch.equal(s.cpu(), torch.from_numpy(s_ref)))

    e_ref = _core.expand_boards(cpu.numpy())
    e = expand(dev)
    report("expand matches CPU", all(torch.equal(x.cpu(), torch.from_numpy(y)) for x, y in zip(e, e_ref)),
           f"({len(e_ref[0])} children)")
    return ok
