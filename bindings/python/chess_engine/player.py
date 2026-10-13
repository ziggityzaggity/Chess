"""Choosing moves with a value network.

The network estimates, for a position, the probabilities that the side to
move goes on to win, draw or lose: [W, D, L] (its input is the encoding in
core/encode.hpp). To move, the player looks one ply ahead: it evaluates the
position after each legal move — where the *opponent* is to move — and plays
the move with the best expected score for itself:

    score(move) = P(opponent loses) + 0.5 * P(draw)          (0 = loss, 1 = win)

Positions the rules already decide skip the network: a mating move scores 1;
a move into stalemate, insufficient material, the 50-move rule or threefold
repetition scores 0.5.

Optionally the player looks further ahead (depth 2 or 3 plies). The search
is plain minimax over expected scores ("negamax"): the value of a position
for the side to move is the best, over its moves, of 1 - (value of the
resulting position for the opponent), and positions at the search horizon are
valued by the network. Each extra ply costs ~35x more network evaluations,
all batched, and catches what one ply cannot see: a piece moved to an
attacked square, a capture that is recaptured, a mate in two.

Entry points:
    choose_move(game, evaluator)       one game, e.g. against a human
    select_moves(boards, model)        many games at once, batched on the GPU
    python -m chess_engine.player model.onnx     play it in a terminal
"""

from __future__ import annotations

import argparse
import math
import random
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

import numpy as np

from . import _core
from ._core import Game, Move, Status

# (N, 19, 8, 8) float32 inputs -> (N, 3) probabilities [win, draw, loss] for
# the side to move in each position.
Evaluator = Callable[[np.ndarray], np.ndarray]

WIN, DRAW, LOSS = 0, 1, 2
_TERMINAL_NAMES = {
    int(Status.CHECKMATE): "checkmate",
    int(Status.STALEMATE): "stalemate",
    int(Status.INSUFFICIENT_MATERIAL): "insufficient material",
    int(Status.FIFTY_MOVE): "fifty-move rule",
}


def softmax(logits: np.ndarray) -> np.ndarray:
    z = logits - logits.max(axis=-1, keepdims=True)
    e = np.exp(z)
    return e / e.sum(axis=-1, keepdims=True)


@dataclass
class ScoredMove:
    move: Move
    uci: str
    san: str
    score: float                                   # expected score for the mover, 0..1
    wdl: Optional[tuple[float, float, float]]      # mover's (win, draw, loss); None if decided
    terminal: Optional[str]                        # why the rules decide it, if they do


MAX_DEPTH = 3


def _check_depth(depth: int) -> None:
    if not 1 <= depth <= MAX_DEPTH:
        raise ValueError(f"depth must be between 1 and {MAX_DEPTH}")


def position_values(boards: np.ndarray, evaluate: Evaluator, plies: int) -> np.ndarray:
    """Expected score (0..1) for the side to move in each of `boards`, after
    searching `plies` more plies (0 = ask the network directly).

    Positions the rules decide are valued without the network: checkmated 0,
    any rule draw 0.5. The tree is expanded one level at a time, so every
    network call is one batch.
    """
    values = np.full(len(boards), 0.5)
    if len(boards) == 0:
        return values
    _, status = _core.count_legal(boards)
    values[status == int(Status.CHECKMATE)] = 0.0
    live = np.flatnonzero(status == int(Status.ONGOING))
    if len(live) == 0:
        return values
    if plies == 0:
        p = np.asarray(evaluate(_core.encode_boards(boards[live])), dtype=np.float64)
        values[live] = p[:, WIN] + 0.5 * p[:, DRAW]
    else:
        kids, _, _, offsets = _core.expand_boards(boards[live])     # every live board has a move
        kid_values = position_values(kids, evaluate, plies - 1)
        values[live] = np.maximum.reduceat(1.0 - kid_values, offsets[:-1])
    return values


def score_moves(game: Game, evaluate: Evaluator, depth: int = 1) -> list[ScoredMove]:
    """Every legal move of `game` with the mover's expected score.

    depth=1 scores the position after the move; depth 2 and 3 search the
    replies too (see the module docstring). The W/D/L breakdown is reported
    for depth 1 only (deeper scores combine many positions).
    """
    _check_depth(depth)
    boards, moves = game.children()
    if not moves:
        return []
    _, status = _core.count_legal(boards)
    scratch = game.copy()                          # repetition checks without touching `game`
    scores = np.zeros(len(moves))
    terminal: list[Optional[str]] = [None] * len(moves)
    wdl: list[Optional[tuple[float, float, float]]] = [None] * len(moves)
    to_eval = []
    for i, m in enumerate(moves):
        st = int(status[i])
        if st == int(Status.CHECKMATE):
            scores[i], terminal[i] = 1.0, "checkmate"
        elif st != int(Status.ONGOING):
            scores[i], terminal[i] = 0.5, _TERMINAL_NAMES[st]
        else:
            scratch.push(m)
            repeated = scratch.is_threefold()
            scratch.undo()
            if repeated:
                scores[i], terminal[i] = 0.5, "threefold repetition"
            else:
                to_eval.append(i)
    if to_eval and depth == 1:
        probs = np.asarray(evaluate(_core.encode_boards(boards[to_eval])), dtype=np.float64)
        for k, i in enumerate(to_eval):
            w, d, l = probs[k]                     # the opponent's view ...
            wdl[i] = (float(l), float(d), float(w))  # ... flipped to the mover's
            scores[i] = l + 0.5 * d
    elif to_eval:
        opponent = position_values(boards[to_eval], evaluate, depth - 1)
        scores[to_eval] = 1.0 - opponent
    return [ScoredMove(m, m.uci(), game.san(m), float(scores[i]), wdl[i], terminal[i])
            for i, m in enumerate(moves)]


def choose_move(game: Game, evaluate: Evaluator, temperature: float = 0.0,
                rng: Optional[random.Random] = None, depth: int = 1) -> Optional[ScoredMove]:
    """The move with the best expected score (None if the game is over).

    A mate in one is always played: a confident network can score many
    winning moves at exactly 1.0 (float32 softmax saturates), and only the
    mate actually ends the game. Otherwise temperature 0 plays the best move
    (ties broken at random if `rng` is given) and temperature > 0 samples moves
    with probability proportional to exp(score / temperature), for variety.
    depth (1-3) is how many plies to look ahead.
    """
    scored = score_moves(game, evaluate, depth)
    if not scored:
        return None
    rng = rng or random.Random(0)
    mates = [s for s in scored if s.terminal == "checkmate"]
    if mates:
        return mates[0]
    if temperature <= 0:
        best = max(s.score for s in scored)
        return rng.choice([s for s in scored if s.score >= best - 1e-9])
    top = max(s.score for s in scored)
    weights = [math.exp((s.score - top) / temperature) for s in scored]
    return rng.choices(scored, weights=weights, k=1)[0]


# --------------------------------------------------------------------------- evaluators
class TorchEvaluator:
    """Evaluator for a PyTorch model mapping (N, 19, 8, 8) inputs to (N, 3) logits."""

    def __init__(self, model, device=None, batch_size: int = 8192):
        import torch

        self.torch = torch
        try:
            model.eval()
        except (RuntimeError, NotImplementedError):
            pass  # torch.export modules are exported in eval mode and refuse .eval()
        self.model = model
        if device is None:
            param = next(iter(model.parameters()), None)
            device = param.device if param is not None else "cpu"
        self.device = torch.device(device)
        self.batch_size = batch_size

    def __call__(self, x: np.ndarray) -> np.ndarray:
        torch = self.torch
        out = []
        with torch.inference_mode():
            for i in range(0, len(x), self.batch_size):
                xb = torch.from_numpy(np.ascontiguousarray(x[i:i + self.batch_size])).to(self.device)
                out.append(torch.softmax(self.model(xb).float(), dim=-1).cpu().numpy())
        return np.concatenate(out) if out else np.zeros((0, 3), np.float32)


class OnnxEvaluator:
    """Evaluator for an exported ONNX model (see the notebook's export step)."""

    def __init__(self, path: str, providers: Optional[Sequence[str]] = None):
        import onnxruntime as ort

        self.session = ort.InferenceSession(path, providers=list(providers or ort.get_available_providers()))
        self.input_name = self.session.get_inputs()[0].name

    def __call__(self, x: np.ndarray) -> np.ndarray:
        logits = self.session.run(None, {self.input_name: np.ascontiguousarray(x, dtype=np.float32)})[0]
        return softmax(logits)


def load_evaluator(path: str) -> Evaluator:
    """An evaluator for an exported model: .onnx (onnxruntime) or .pt2 (torch.export)."""
    if path.endswith(".onnx"):
        return OnnxEvaluator(path)
    if path.endswith(".pt2"):
        import torch

        return TorchEvaluator(torch.export.load(path).module(), device="cpu")
    raise ValueError(f"unsupported model file {path!r}: expected .onnx or .pt2")


# --------------------------------------------------------------------------- batched (GPU)
def _network_probs(model, boards, eval_batch: int):
    import torch

    from . import gpu

    probs = torch.empty((boards.shape[0], 3), dtype=torch.float32, device=boards.device)
    use_amp = boards.is_cuda                               # half precision: ~2x faster, same choices
    with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16, enabled=use_amp):
        for i in range(0, boards.shape[0], eval_batch):
            probs[i:i + eval_batch] = torch.softmax(model(gpu.encode(boards[i:i + eval_batch])).float(), dim=-1)
    return probs


def position_values_batched(boards, model, plies: int, eval_batch: int = 32768):
    """position_values() for a tensor of boards, entirely on boards.device:
    the CUDA kernels expand each level and the network evaluates the horizon."""
    import torch

    from . import gpu

    values = torch.full((boards.shape[0],), 0.5, device=boards.device)
    if boards.shape[0] == 0:
        return values
    _, status = gpu.count_legal(boards)
    st = status.to(torch.int64)
    values[st == int(Status.CHECKMATE)] = 0.0
    live = (st == int(Status.ONGOING)).nonzero().squeeze(1)
    if len(live) == 0:
        return values
    if plies == 0:
        p = _network_probs(model, boards[live], eval_batch)
        values[live] = p[:, WIN] + 0.5 * p[:, DRAW]
    else:
        kids, _, kparent, _ = gpu.expand(boards[live])
        kid_values = position_values_batched(kids, model, plies - 1, eval_batch)
        values[live] = torch.full((len(live),), -math.inf, device=boards.device).scatter_reduce(
            0, kparent, 1.0 - kid_values, "amax")
    return values


def select_moves(boards, model, temperature: float = 0.0, generator=None, eval_batch: int = 32768,
                 depth: int = 1):
    """Pick a move in each of G positions at once, entirely on boards.device.

    boards: (G, 72) uint8 tensor; every position must have a legal move.
    model: maps (N, 19, 8, 8) float32 to (N, 3) [W, D, L] logits.
    Returns a dict of tensors, one entry per game: "child" (G, 72) the
    position after the chosen move, "move" (G, 4), "score" (G,) the mover's
    expected score, "status" (G,) the child's Status. Repetition draws are not
    detected here (boards carry no history). depth (1-3) is how many plies
    to look ahead.
    """
    import torch

    from . import gpu

    children, moves, parent, offsets = gpu.expand(boards)
    g, m = boards.shape[0], children.shape[0]
    if bool((offsets[1:] == offsets[:-1]).any()):
        raise ValueError("select_moves: a position has no legal moves (game over)")
    _check_depth(depth)
    _, status = gpu.count_legal(children)
    st = status.to(torch.int64)
    score = 1.0 - position_values_batched(children, model, depth - 1, eval_batch)   # rule results included
    key = score
    if temperature > 0:                                       # Gumbel-max = softmax sampling
        u = torch.rand(m, device=score.device, generator=generator).clamp_(1e-12, 1.0)
        key = score / temperature - torch.log(-torch.log(u))
    # A mate in one always wins the selection (saturated network scores can
    # tie it at 1.0; see choose_move).
    key = torch.where(st == int(Status.CHECKMATE), torch.full_like(key, math.inf), key)
    best = torch.full((g,), -math.inf, device=key.device).scatter_reduce(0, parent, key, "amax")
    idx = torch.arange(m, device=key.device)
    choice = torch.full((g,), m, device=key.device, dtype=torch.int64).scatter_reduce(
        0, parent, torch.where(key == best[parent], idx, m), "amin")
    return {"child": children[choice], "move": moves[choice], "score": score[choice],
            "status": status[choice], "index": choice}


# --------------------------------------------------------------------------- terminal play
def _print_board(game: Game, flip: bool) -> None:
    rows = str(game).strip().splitlines()
    if flip:
        rows = [" ".join(reversed(r.split())) for r in reversed(rows)]
    ranks = range(1, 9) if flip else range(8, 0, -1)
    for rank, row in zip(ranks, rows):
        print(f" {rank}  {row}")
    print("    " + " ".join("hgfedcba" if flip else "abcdefgh"))


def main(argv: Optional[Sequence[str]] = None) -> int:
    ap = argparse.ArgumentParser(description="Play against a value network in the terminal.")
    ap.add_argument("model", help="exported model: .onnx (needs onnxruntime) or .pt2 (torch.export)")
    ap.add_argument("--color", choices=("white", "black"), default="white", help="your colour")
    ap.add_argument("--temperature", type=float, default=0.0)
    ap.add_argument("--depth", type=int, choices=(1, 2, 3), default=1,
                    help="plies to look ahead (1: the position after our move)")
    ap.add_argument("--fen", default=None, help="start position")
    args = ap.parse_args(argv)

    evaluate = load_evaluator(args.model)
    game = Game(args.fen) if args.fen else Game()
    human = 0 if args.color == "white" else 1
    rng = random.Random()
    while not game.is_game_over():
        print()
        _print_board(game, flip=human == 1)
        if game.turn == human:
            text = input("your move (SAN or UCI, 'undo', 'quit'): ").strip()
            if text == "quit":
                return 0
            if text == "undo":
                game.undo(), game.undo()
                continue
            if not (game.push_uci(text) if game.parse_uci(text) is not None else _try_san(game, text)):
                print("  illegal or unreadable move")
            continue
        choice = choose_move(game, evaluate, args.temperature, rng, depth=args.depth)
        detail = choice.terminal or ("W/D/L %.2f/%.2f/%.2f" % choice.wdl if choice.wdl else f"depth {args.depth}")
        print(f"engine plays {choice.san}   (expected score {choice.score:.2f}; {detail})")
        game.push(choice.move)
    print()
    _print_board(game, flip=human == 1)
    print("game over:", game.result().name, game.draw_reason().name if game.result() == _core.Result.DRAW else "")
    print(game.pgn())
    return 0


def _try_san(game: Game, text: str) -> bool:
    try:
        return game.push(game.parse_san(text))
    except ValueError:
        return False


if __name__ == "__main__":
    raise SystemExit(main())
