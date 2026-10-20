"""The code behind ai/deep_q_network.ipynb: Deep Q-learning bots that learn by playing.

The Convolutional bots learned from 10,000 master games. These learn from
games they play: either against themselves (self-play) or against a fixed
opponent, the medium Convolutional bot searching two plies. Both loops train
an identical network with identical settings, so the comparison is about who
the learner plays, nothing else. See ai/DEEP_Q_PLAN.md for the design.

Two ways to represent the Q-function (the expected final score for the side to
move after a move) are implemented:

    afterstate    Q(s, a) = 1 - V(s . a): a network values the position after
                  each move. Same input and output as the Convolutional models,
                  so it plays in the web app unchanged. The bot players meet.
    action_head   one forward pass on s gives a Q-value for each of the 4,672
                  moves of the AlphaZero 8x8x73 move encoding; illegal moves
                  are masked. Textbook DQN, trained for comparison.

The networks see the 23-plane heuristic encoding (core/encode.hpp): the
standard 19 planes plus attack counts and pieces in danger. A small linear
"prior" on hand-made features (material, pieces in danger, centre
occupation and control) is added to the network's output; its weights start
random and are learned with the rest.

Everything runs on the GPU when one is present: games are 72-byte boards in
tensors, and the engine's CUDA kernels expand and encode them.

Sections:
    configuration   DQNConfig, PROFILES
    networks        heuristic_features, AfterstateQNet, ActionQNet, build_qnet, load_onnx_value_net
    moves           move_index (8x8x73), BoardHasher (repetitions)
    games           pgn_start_pool, SelfPlay (rolling games, n-step transitions)
    learning        ReplayBuffer, bootstrap_dist, td_loss
    evaluation      dqn_policy, evaluate
    training        train (resumable, time-budgeted)
    export          export_dqn, deploy
"""

from __future__ import annotations

import copy
import json
import math
import time
from dataclasses import asdict, dataclass, replace
from pathlib import Path
from typing import Callable, Optional

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

import chess_engine as ce
from chess_engine import gpu, player

try:   # run as a module (ai.dqn_training) or from ai/ (the notebook, Modal)
    from . import value_training as vt
except ImportError:
    import value_training as vt

ENCODING = "pychess-23plane-stm-v1"     # 19 standard planes + 4 heuristic planes (core/encode.hpp)
PLANES = ce.HEURISTIC_PLANES
MOVE_PLANES = 73                        # AlphaZero: 56 queen-like, 8 knight, 9 under-promotion
NUM_ACTIONS = MOVE_PLANES * 64
WIN, DRAW, LOSS = 0, 1, 2
FLIP = [LOSS, DRAW, WIN]                # a W/D/L distribution seen by the other player
REPO = Path(__file__).resolve().parents[1]


# =============================================================================
# Configuration
# =============================================================================
@dataclass
class DQNConfig:
    seed: int = 7
    size: str = "small"                 # small / medium / large (value_training.SIZES)
    formulation: str = "afterstate"     # "afterstate" or "action_head"
    opponent: str = "self"              # "self" (self-play) or "cnn" (a fixed Convolutional bot)
    opponent_model: str = "web/public/models/value_net_medium.onnx"
    opponent_depth: int = 2
    # network
    head_channels: int = 32
    hidden: int = 128
    prior: bool = True                  # the linear heuristic prior (random initial weights)
    dueling: bool = False               # action_head only: Q = V + A - mean(A)
    # the Q-learning target
    gamma: float = 0.995                # per ply; shrinks distant results towards a draw
    n_step: int = 3                     # learner moves before bootstrapping
    double_q: bool = True               # the online network picks the reply, the target network scores it
    tau: float = 0.005                  # Polyak averaging of the target network, per training step
    # games
    parallel_games: int = 2048
    max_plies: int = 300                # a game still running is cut off (and bootstrapped, not a draw)
    pgn_start_frac: float = 0.5         # share of games starting from a master-game position
    pgn_max_ply: int = 30               # ... taken from the first 30 plies of a game
    pgn_path: str = "ai/data/twic_otb2300.pgn"
    random_opening_plies: int = 4       # random moves at the start of a game from the initial position
    pgn_random_plies: int = 1           # ... and from a master-game position
    temperature_start: float = 0.05     # softmax over expected scores (0..1) while learning
    temperature_end: float = 0.005
    epsilon: float = 0.02               # chance of a uniformly random move
    # replay and optimisation
    buffer_size: int = 1_000_000
    warmup: int = 20_000                # transitions in the buffer before training starts
    replay_ratio: float = 4.0           # training samples per learner move played
    batch_size: int = 1024
    lr: float = 1e-3
    lr_warmup_steps: int = 300
    weight_decay: float = 1e-4
    grad_clip: float = 1.0
    # budget and bookkeeping
    max_minutes: Optional[float] = None
    total_positions: Optional[int] = None
    eval_every_minutes: float = 8.0
    eval_games: int = 200
    eval_max_plies: int = 300
    eval_vs_cnn: bool = False           # also play the opponent model at depth 1 when evaluating
    checkpoint_every_minutes: float = 5.0


PROFILES = {
    "gpu": DQNConfig(),
    "cpu": DQNConfig(parallel_games=64, buffer_size=100_000, warmup=2_000, batch_size=256, replay_ratio=2.0,
                     eval_every_minutes=5.0, eval_games=40, opponent_depth=1),
    "smoke": DQNConfig(parallel_games=8, max_plies=40, buffer_size=5_000, warmup=100, batch_size=32,
                       replay_ratio=2.0, lr_warmup_steps=10, eval_every_minutes=0.25, eval_games=4,
                       eval_max_plies=40, opponent_depth=1, checkpoint_every_minutes=0.25, max_minutes=0.5),
}


def config_for(profile: str = "gpu", **overrides) -> DQNConfig:
    return replace(PROFILES[profile], **overrides)


# =============================================================================
# Networks
# =============================================================================
PIECE_VALUES = (1.0, 3.0, 3.0, 5.0, 9.0, 0.0)
N_FEATURES = 21
FEATURE_NAMES = (
    [f"our_{p}" for p in ("pawns", "knights", "bishops", "rooks", "queens", "king")]
    + [f"their_{p}" for p in ("pawns", "knights", "bishops", "rooks", "queens", "king")]
    + ["our_material_in_danger", "their_material_in_danger", "our_pieces_in_danger", "their_pieces_in_danger",
       "in_check", "our_centre_pieces", "their_centre_pieces", "our_centre_attacks", "their_centre_attacks"]
)


def heuristic_features(x: torch.Tensor) -> torch.Tensor:
    """(N, 23, 8, 8) planes -> (N, 21) hand-made features, from the side to move's view.

    Material (12 piece counts); material and pieces in danger for each side,
    and whether we are in check (planes 21-22); pieces on and attacks into the
    centre squares d4, e4, d5, e5 (the same four squares in either view).
    """
    values = x.new_tensor(PIECE_VALUES).view(1, 6, 1, 1)
    ours, theirs = (x[:, 0:6] * values).sum(1), (x[:, 6:12] * values).sum(1)
    centre = x[:, :, 3:5, 3:5]
    feats = [
        x[:, :12].sum((2, 3)),
        (x[:, 21] * ours).sum((1, 2)).unsqueeze(1) / 10,
        (x[:, 22] * theirs).sum((1, 2)).unsqueeze(1) / 10,
        x[:, 21].sum((1, 2)).unsqueeze(1),
        x[:, 22].sum((1, 2)).unsqueeze(1),
        (x[:, 21] * x[:, 5]).sum((1, 2)).unsqueeze(1),             # our king in danger = in check
        centre[:, 0:6].sum((1, 2, 3)).unsqueeze(1),
        centre[:, 6:12].sum((1, 2, 3)).unsqueeze(1),
        centre[:, 19].sum((1, 2)).unsqueeze(1),
        centre[:, 20].sum((1, 2)).unsqueeze(1),
    ]
    return torch.cat(feats, 1)


def _trunk(planes: int, channels: int, blocks: int) -> nn.Sequential:
    return nn.Sequential(nn.Conv2d(planes, channels, 3, padding=1, bias=False), nn.BatchNorm2d(channels),
                         nn.ReLU(inplace=True), *[vt.ResidualBlock(channels) for _ in range(blocks)])


class AfterstateQNet(nn.Module):
    """(N, 23, 8, 8) -> (N, 3) W/D/L logits for the side to move: Q(s, a) = 1 - V(s . a).

    The value head is the Convolutional models' head without dropout; the
    heuristic prior adds a linear function of heuristic_features().
    """

    input_planes = PLANES

    def __init__(self, channels=32, blocks=3, head_channels=32, hidden=128, prior=True):
        super().__init__()
        self.trunk = _trunk(PLANES, channels, blocks)
        self.head = nn.Sequential(
            nn.Conv2d(channels, head_channels, 1, bias=False), nn.BatchNorm2d(head_channels), nn.ReLU(inplace=True),
            nn.Flatten(), nn.Linear(head_channels * 64, hidden), nn.ReLU(inplace=True), nn.Linear(hidden, 3))
        self.prior = nn.Linear(N_FEATURES, 3) if prior else None

    def forward(self, x):
        logits = self.head(self.trunk(x))
        if self.prior is not None:
            logits = logits + self.prior(heuristic_features(x))
        return logits


class ActionQNet(nn.Module):
    """(N, 23, 8, 8) -> (N, 4672) Q logits: sigmoid(logit) = the mover's expected score after each move.

    The same trunk as AfterstateQNet. A 1x1-convolution head gives 73 move
    planes per from-square (move_index). A state-value stream (with the
    heuristic prior) is added to every move; with dueling=True the moves'
    advantages are centred first.
    """

    input_planes = PLANES

    def __init__(self, channels=32, blocks=3, head_channels=32, hidden=128, prior=True, dueling=False):
        super().__init__()
        self.trunk = _trunk(PLANES, channels, blocks)
        self.moves = nn.Sequential(nn.Conv2d(channels, channels, 1, bias=False), nn.BatchNorm2d(channels),
                                   nn.ReLU(inplace=True), nn.Conv2d(channels, MOVE_PLANES, 1))
        self.value = nn.Sequential(
            nn.Conv2d(channels, head_channels, 1, bias=False), nn.BatchNorm2d(head_channels), nn.ReLU(inplace=True),
            nn.Flatten(), nn.Linear(head_channels * 64, hidden), nn.ReLU(inplace=True), nn.Linear(hidden, 1))
        self.prior = nn.Linear(N_FEATURES, 1) if prior else None
        self.dueling = dueling

    def forward(self, x):
        h = self.trunk(x)
        adv = self.moves(h).flatten(1)                      # plane-major: plane * 64 + from-square
        if self.dueling:
            adv = adv - adv.mean(1, keepdim=True)
        v = self.value(h)
        if self.prior is not None:
            v = v + self.prior(heuristic_features(x))
        return adv + v


def build_qnet(cfg: DQNConfig) -> nn.Module:
    size = vt.SIZES[cfg.size]
    if cfg.formulation == "afterstate":
        return AfterstateQNet(size.channels, size.blocks, cfg.head_channels, cfg.hidden, cfg.prior)
    if cfg.formulation == "action_head":
        return ActionQNet(size.channels, size.blocks, cfg.head_channels, cfg.hidden, cfg.prior, cfg.dueling)
    raise ValueError(f"unknown formulation {cfg.formulation!r}")


def load_onnx_value_net(path) -> nn.Module:
    """A Convolutional model exported to ONNX (web/public/models/value_net_*.onnx), back in PyTorch.

    The exporter folds each batch norm into the convolution before it, so the
    network is rebuilt with biased convolutions and no batch norm, and the
    weights are copied by name. It runs on the GPU with the training code (no
    ONNX Runtime needed) and matches onnxruntime to float precision.
    """
    import onnx
    from onnx import numpy_helper

    weights = {i.name: torch.from_numpy(numpy_helper.to_array(i).copy())
               for i in onnx.load(str(path)).graph.initializer}
    channels, planes = weights["stem.0.weight"].shape[:2]
    blocks = len({k.split(".")[1] for k in weights if k.startswith("tower.")})
    head_channels, hidden = weights["head.0.weight"].shape[0], weights["head.4.weight"].shape[0]
    zero_prior = (np.zeros((3, 12), np.float32), np.zeros(3, np.float32))
    net = vt.ValueNet(planes, channels, blocks, head_channels, hidden, 0.0, zero_prior)
    convs = {"stem.0": "stem.1", "head.0": "head.1"}
    convs.update({f"tower.{i}.conv{j}": f"tower.{i}.bn{j}" for i in range(blocks) for j in (1, 2)})
    modules = dict(net.named_modules())
    for conv, bn in convs.items():
        modules[conv].weight.data.copy_(weights[f"{conv}.weight"])
        modules[conv].bias = nn.Parameter(weights[f"{conv}.weight_bias"])
        parent, _, leaf = bn.rpartition(".")
        setattr(modules[parent], leaf, nn.Identity())
    for name in ("head.4.weight", "head.4.bias", "head.7.weight", "head.7.bias", "material.weight", "material.bias"):
        dict(net.named_parameters())[name].data.copy_(weights[name])
    net.input_planes = int(planes)
    return net.eval().requires_grad_(False)


# =============================================================================
# Moves and repetitions
# =============================================================================
# (sign(dr) + 1) * 3 + (sign(dc) + 1) -> direction: N NE E SE S SW W NW = 0..7 (row 0 at the top)
_QUEEN_DIRECTION = [7, 0, 1, 6, -1, 2, 5, 4, 3]
# (dr + 2) * 5 + (dc + 2) -> knight move 0..7
_KNIGHT = {1: 0, 3: 1, 5: 2, 9: 3, 15: 4, 19: 5, 21: 6, 23: 7}


def move_index(moves: torch.Tensor, black: torch.Tensor) -> torch.Tensor:
    """AlphaZero's 8x8x73 index of each move: plane * 64 + from-square, in the mover's view.

    moves: (M, 4) uint8 (from, to, flag, promo) as chess_engine returns them;
    black: (M,) bool, True where black made the move (its board is flipped,
    like the encoding). Planes 0-55 are queen-like moves (8 directions x 7
    distances, queen promotions included), 56-63 knight moves, 64-72
    under-promotions (knight, bishop, rook x left capture, push, right capture).
    """
    flip = black.to(torch.int64) * 56
    fr, to = moves[:, 0].to(torch.int64) ^ flip, moves[:, 1].to(torch.int64) ^ flip
    promo = moves[:, 3].to(torch.int64)
    dr, dc = to // 8 - fr // 8, to % 8 - fr % 8
    knight = dr.abs() * dc.abs() == 2
    under = (promo >= 2) & (promo <= 4)                    # knight, bishop, rook
    queen_dir = moves.new_tensor(_QUEEN_DIRECTION, dtype=torch.int64)[(dr.sign() + 1) * 3 + dc.sign() + 1]
    distance = torch.maximum(dr.abs(), dc.abs())
    knight_table = torch.full((25,), -1, dtype=torch.int64, device=moves.device)
    for k, v in _KNIGHT.items():
        knight_table[k] = v
    plane = torch.where(under, 64 + (promo - 2) * 3 + dc.clamp(-1, 1) + 1,
                        torch.where(knight, 56 + knight_table[((dr + 2) * 5 + dc + 2).clamp(0, 24)],
                                    queen_dir * 7 + distance - 1))
    return plane * 64 + fr


class BoardHasher:
    """64-bit hashes of positions (pieces, side, castling, en passant), for repetition draws.

    Boards carry no history, so the games keep each position's hash and a
    position seen for the third time ends the game in a draw, as the rules say.
    Additive Zobrist hashing: a sum of random 64-bit keys (wrapping), one per
    (square, piece) and per side, castling and en-passant state.
    """

    def __init__(self, device, seed: int = 1):
        g = torch.Generator().manual_seed(seed)

        def rand(*shape):
            return torch.randint(-2**62, 2**62, shape, generator=g, dtype=torch.int64).to(device)

        self.squares, self.side, self.castling, self.ep = rand(64, 16), rand(2), rand(16), rand(65)
        self.index = torch.arange(64, device=device)

    def __call__(self, boards: torch.Tensor) -> torch.Tensor:
        b = boards.to(torch.int64)
        h = self.squares[self.index, b[:, :64] & 15].sum(1)
        ep = torch.where(b[:, 66] < 64, b[:, 66], 64)
        return h + self.side[(b[:, 64] != 0).long()] + self.castling[b[:, 65] & 15] + self.ep[ep]


# =============================================================================
# Games
# =============================================================================
def pgn_start_pool(pgn_path, max_ply: int = 30, max_games: Optional[int] = None) -> np.ndarray:
    """Distinct positions from the first `max_ply` plies of the master games, as (N, 72) boards.

    Only the positions are used, never the games' results: the bots still
    learn the value of a position from their own games.
    """
    games = ce.split_pgn(Path(pgn_path).read_text())
    if max_games:
        games = games[:max_games]
    rep = ce.replay_games([movetext for _, movetext in games])
    boards = rep["boards"][rep["ply"] <= max_ply]
    _, status = ce.count_legal(boards)
    boards = boards[status == int(ce.Status.ONGOING)]
    return np.unique(boards, axis=0)


class SelfPlay:
    """`parallel_games` games played side by side, each restarted as soon as it ends.

    Every call to step() plays one move in every game. The learner chooses
    its moves with the online network (softmax over expected scores, plus a
    small chance of a random move); in "cnn" mode the other side is a fixed
    opponent searching opponent_depth plies. A finished game is turned into
    n-step transitions for the replay buffer (see transitions()).
    """

    def __init__(self, cfg: DQNConfig, net: nn.Module, start_pool: Optional[np.ndarray], device,
                 opponent: Optional[nn.Module] = None, seed: int = 0):
        self.cfg, self.net, self.opponent, self.device = cfg, net, opponent, torch.device(device)
        g, n = cfg.parallel_games, cfg.max_plies
        self.gen = torch.Generator(device=self.device).manual_seed(seed)
        self.hasher = BoardHasher(self.device)
        self.start = torch.from_numpy(ce.startpos()).to(self.device)
        self.pool = (torch.from_numpy(start_pool).to(self.device)
                     if start_pool is not None and len(start_pool) else None)
        self.traj = torch.zeros((g, n + 1, ce.BOARD_BYTES), dtype=torch.uint8, device=self.device)
        self.hashes = torch.zeros((g, n + 1), dtype=torch.int64, device=self.device)
        self.actions = torch.zeros((g, n), dtype=torch.int64, device=self.device)
        self.learner_moved = torch.zeros((g, n), dtype=torch.bool, device=self.device)
        self.ply = torch.zeros(g, dtype=torch.int64, device=self.device)
        self.random_plies = torch.zeros(g, dtype=torch.int64, device=self.device)
        self.learner_white = torch.arange(g, device=self.device) % 2 == 0     # cnn mode: colours alternate
        self.rows = torch.arange(g, device=self.device)
        self.endings: dict[str, int] = {}
        self.lengths: list[int] = []
        self.reset(self.rows)

    # ------------------------------------------------------------------ helpers
    def _rand(self, *shape):
        return torch.rand(shape, device=self.device, generator=self.gen)

    def reset(self, idx: torch.Tensor) -> None:
        if len(idx) == 0:
            return
        boards = self.start.repeat(len(idx), 1)
        random_plies = torch.full((len(idx),), self.cfg.random_opening_plies, device=self.device)
        if self.pool is not None and self.cfg.pgn_start_frac > 0:
            use = self._rand(len(idx)) < self.cfg.pgn_start_frac
            pick = (self._rand(len(idx)) * len(self.pool)).long().clamp(max=len(self.pool) - 1)
            boards = torch.where(use.unsqueeze(1), self.pool[pick], boards)
            random_plies = torch.where(use, self.cfg.pgn_random_plies, random_plies)
        self.traj[idx, 0] = boards
        self.hashes[idx, 0] = self.hasher(boards)
        self.ply[idx] = 0
        self.random_plies[idx] = random_plies
        self.learner_moved[idx] = False

    def current(self) -> torch.Tensor:
        return self.traj[self.rows, self.ply]

    def learner_to_move(self, boards: torch.Tensor) -> torch.Tensor:
        if self.cfg.opponent == "self":
            return torch.ones(len(boards), dtype=torch.bool, device=self.device)
        return (boards[:, 64] == 0) == self.learner_white

    # ------------------------------------------------------------------ one move in every game
    @torch.no_grad()
    def step(self, temperature: float, epsilon: float) -> Optional[dict]:
        """Play one move in every game; returns the transitions of the games that ended (or None)."""
        boards = self.current()
        g = len(boards)
        learner = self.learner_to_move(boards)
        random_move = self.ply < self.random_plies
        kids, moves, parent, _ = gpu.expand(boards)
        black = boards[parent, 64] != 0
        index = move_index(moves, black)

        # The learner's moves: scores for every child, then softmax sampling.
        thinking = learner & ~random_move
        key = self._rand(len(kids))                                    # random moves: uniform
        key = -torch.log(-torch.log(key.clamp_(1e-12, 1.0)))          # Gumbel noise
        mine = thinking[parent]
        if mine.any():
            scores = child_scores(self.net, boards, kids, moves, parent, index, mine, self.hashes, self.ply,
                                  self.hasher)
            t = max(temperature, 1e-6)
            key = torch.where(mine, scores / t + key, key)
            explore = (self._rand(g) < epsilon)[parent]
            key = torch.where(mine & explore, -torch.log(-torch.log(self._rand(len(kids)).clamp_(1e-12, 1.0))), key)
            mate = scores >= 2.0                                       # child_scores marks a mate in one with 2
            key = torch.where(mine & mate & ~explore, torch.full_like(key, math.inf), key)
        choice = vt._children_choice(boards, key, parent)

        # The fixed opponent's moves.
        theirs = ~learner & ~random_move
        if theirs.any():
            idx = theirs.nonzero().squeeze(1)
            picked = player.select_moves(boards[idx], self.opponent, depth=self.cfg.opponent_depth)["index"]
            # select_moves expands boards[idx] in the same order as gpu.expand(boards): map its indices back.
            offsets = torch.zeros(g + 1, dtype=torch.int64, device=self.device)
            offsets[1:] = torch.bincount(parent, minlength=g).cumsum(0)
            sub_counts = offsets[idx + 1] - offsets[idx]
            sub_offsets = torch.zeros(len(idx) + 1, dtype=torch.int64, device=self.device)
            sub_offsets[1:] = sub_counts.cumsum(0)
            local = picked - sub_offsets[torch.arange(len(idx), device=self.device)]
            choice[idx] = offsets[idx] + local

        # Advance every game.
        new = kids[choice]
        rows, t = self.rows, self.ply
        self.actions[rows, t] = index[choice]
        self.learner_moved[rows, t] = learner
        self.ply += 1
        self.traj[rows, self.ply] = new
        h = self.hasher(new)
        self.hashes[rows, self.ply] = h

        _, status = gpu.count_legal(new)
        status = status.long()
        steps = torch.arange(self.cfg.max_plies + 1, device=self.device)
        seen = ((self.hashes == h.unsqueeze(1)) & (steps <= self.ply.unsqueeze(1))).sum(1)
        repetition = (seen >= 3) & (status == int(ce.Status.ONGOING))
        cut = (self.ply >= self.cfg.max_plies) & (status == int(ce.Status.ONGOING)) & ~repetition
        ended = (status != int(ce.Status.ONGOING)) | repetition | cut
        outcome = torch.zeros(g, dtype=torch.uint8, device=self.device)   # for the side to move at the end
        outcome[status == int(ce.Status.CHECKMATE)] = 1                   # 1: it is mated
        outcome[ended & ~cut & (status != int(ce.Status.CHECKMATE))] = 2  # 2: a draw; 0: cut off
        if not ended.any():
            return None
        done = ended.nonzero().squeeze(1)
        self._count_endings(status[done], repetition[done], cut[done])
        out = self.transitions(done, outcome[done])
        self.reset(done)
        return out

    def _count_endings(self, status, repetition, cut) -> None:
        names = {int(ce.Status.CHECKMATE): "mate", int(ce.Status.STALEMATE): "stalemate",
                 int(ce.Status.INSUFFICIENT_MATERIAL): "no mating material", int(ce.Status.FIFTY_MOVE): "50-move rule"}
        for st, rep, c in zip(status.tolist(), repetition.tolist(), cut.tolist()):
            name = "move limit" if c else "repetition" if rep else names[st]
            self.endings[name] = self.endings.get(name, 0) + 1

    def transitions(self, done: torch.Tensor, outcome: torch.Tensor) -> Optional[dict]:
        """The n-step transitions of finished games.

        For each learner move t in a game of T plies: the position before (s),
        the move's index (a), the position after (x), and the position the
        target bootstraps from, d = position min(t + n * step, T), where step
        is 1 in self-play and 2 against a fixed opponent (the learner moves
        every other ply). m = plies from t to d. done says whether d ended the
        game: 1 its side to move was mated, 2 a draw, 0 not over (bootstrap
        from the network, including games cut off at max_plies).
        """
        T = self.ply[done]
        self.lengths.extend(T.tolist())
        steps = torch.arange(self.cfg.max_plies, device=self.device)
        valid = (steps.unsqueeze(0) < T.unsqueeze(1)) & self.learner_moved[done]
        game, t = valid.nonzero(as_tuple=True)
        if len(t) == 0:
            return None
        rows = done[game]
        stride = 1 if self.cfg.opponent == "self" else 2
        b = torch.minimum(t + self.cfg.n_step * stride, T[game])
        return {
            "s": self.traj[rows, t], "a": self.actions[rows, t], "x": self.traj[rows, t + 1],
            "d": self.traj[rows, b], "m": (b - t).to(torch.int16),
            "done": torch.where(b == T[game], outcome[game], torch.zeros_like(outcome[game])),
        }


@torch.no_grad()
def child_scores(net, boards, kids, moves, parent, index, mask, hashes=None, ply=None, hasher=None):
    """The mover's expected score (0..1) after each child move where `mask` is set (others 0).

    The rules come first: a mating move scores 2 (a marker: always played),
    a move into stalemate, insufficient material, the 50-move rule or a third
    repetition (when the games' hashes are given) scores 0.5. The network
    values the rest: afterstate nets score 1 - V(child), action-head nets
    sigmoid(Q(board, move)).
    """
    scores = torch.zeros(len(kids), device=kids.device)
    sel = mask.nonzero().squeeze(1)
    if len(sel) == 0:
        return scores
    k = kids[sel]
    _, status = gpu.count_legal(k)
    status = status.long()
    draw = (status != int(ce.Status.ONGOING)) & (status != int(ce.Status.CHECKMATE))
    if hashes is not None:
        rows = parent[sel]
        steps = torch.arange(hashes.shape[1], device=kids.device)
        seen = ((hashes[rows] == hasher(k).unsqueeze(1)) & (steps <= ply[rows].unsqueeze(1))).sum(1)
        draw |= (seen >= 2) & (status == int(ce.Status.ONGOING))
    live = (status == int(ce.Status.ONGOING)) & ~draw
    s = torch.zeros(len(sel), device=kids.device)
    if live.any():
        if isinstance(net, ActionQNet):
            parents = parent[sel][live]
            uniq, local = torch.unique(parents, return_inverse=True)
            logits = _forward(net, boards[uniq])
            s[live] = torch.sigmoid(logits[local, index[sel][live]].float())
        else:
            p = torch.softmax(_forward(net, k[live]).float(), 1)
            s[live] = p[:, LOSS] + 0.5 * p[:, DRAW]
    s[draw] = 0.5
    s[status == int(ce.Status.CHECKMATE)] = 2.0
    scores[sel] = s
    return scores


def _forward(net, boards: torch.Tensor, chunk: int = 32768) -> torch.Tensor:
    """The network's raw output for boards (inference: eval mode, mixed precision on a GPU)."""
    dtype = vt.amp_dtype(boards.device)
    was_training = net.training
    net.eval()
    outs = []
    with torch.autocast(boards.device.type, dtype=dtype or torch.float32, enabled=dtype is not None):
        for i in range(0, len(boards), chunk):
            outs.append(net(gpu.encode(boards[i:i + chunk], PLANES)).float())
    net.train(was_training)
    return torch.cat(outs) if outs else torch.zeros((0, 3), device=boards.device)


# =============================================================================
# Learning
# =============================================================================
class ReplayBuffer:
    """The most recent `capacity` transitions, on the device, sampled uniformly."""

    def __init__(self, capacity: int, device):
        self.capacity, self.size, self.ptr = capacity, 0, 0
        def z(*shape, dtype=torch.uint8):
            return torch.zeros(shape, dtype=dtype, device=device)

        self.data = {"s": z(capacity, 72), "a": z(capacity, dtype=torch.int64), "x": z(capacity, 72),
                     "d": z(capacity, 72), "m": z(capacity, dtype=torch.int16), "done": z(capacity)}

    def add(self, batch: dict) -> None:
        n = len(batch["a"])
        if n > self.capacity:
            batch = {k: v[-self.capacity:] for k, v in batch.items()}
            n = self.capacity
        idx = (self.ptr + torch.arange(n, device=batch["a"].device)) % self.capacity
        for k, v in batch.items():
            self.data[k][idx] = v
        self.ptr = (self.ptr + n) % self.capacity
        self.size = min(self.size + n, self.capacity)

    def sample(self, n: int, gen=None) -> dict:
        idx = torch.randint(self.size, (n,), device=self.data["a"].device, generator=gen)
        return {k: v[idx] for k, v in self.data.items()}


@torch.no_grad()
def bootstrap_dist(d: torch.Tensor, done: torch.Tensor, online: nn.Module, target: nn.Module,
                   double_q: bool = True) -> torch.Tensor:
    """W/D/L distribution for the side to move at each position d, by one step of Q-learning.

    Finished games use their result. Otherwise the side to move plays its best
    move: chosen by the online network's scores (Double DQN) or the target
    network's, and valued by the target network. Mates and rule draws are
    valued by the rules. An action-head value v becomes the distribution
    (v, 0, 1 - v), which has the same expected score.
    """
    out = torch.zeros((len(d), 3), device=d.device)
    out[done == 1, LOSS] = 1.0
    out[done == 2, DRAW] = 1.0
    live = (done == 0).nonzero().squeeze(1)
    if len(live) == 0:
        return out
    boards = d[live]
    kids, moves, parent, offsets = gpu.expand(boards)
    _, status = gpu.count_legal(kids)
    status = status.long()
    mate = status == int(ce.Status.CHECKMATE)
    draw = (status != int(ce.Status.ONGOING)) & ~mate
    if isinstance(online, ActionQNet):
        index = move_index(moves, boards[parent, 64] != 0)
        q_t = torch.sigmoid(_forward(target, boards)[parent, index])
        q_o = torch.sigmoid(_forward(online, boards)[parent, index]) if double_q else q_t
        dist_t = torch.stack([q_t, torch.zeros_like(q_t), 1 - q_t], 1)
        select = q_o.clone()
    else:
        p_t = torch.softmax(_forward(target, kids), 1)
        dist_t = p_t[:, FLIP]                                  # the child's side to move is the opponent
        p_o = torch.softmax(_forward(online, kids), 1) if double_q else p_t
        select = p_o[:, LOSS] + 0.5 * p_o[:, DRAW]
    dist_t[mate] = torch.tensor([1.0, 0.0, 0.0], device=d.device)
    dist_t[draw] = torch.tensor([0.0, 1.0, 0.0], device=d.device)
    select = torch.where(mate, torch.full_like(select, 2.0), torch.where(draw, torch.full_like(select, 0.5), select))
    choice = vt._children_choice(boards, select, parent)
    empty = offsets[1:] == offsets[:-1]                       # no legal move: should not happen when done == 0
    value = dist_t[choice.clamp(max=len(kids) - 1)]
    value[empty] = torch.tensor([0.0, 1.0, 0.0], device=d.device)
    out[live] = value
    return out


def mover_target(dist_d: torch.Tensor, m: torch.Tensor, gamma: float) -> torch.Tensor:
    """The target distribution for the player who moved m plies before d (flipped when m is odd),
    discounted by gamma**m towards a draw."""
    odd = (m.long() % 2 == 1).unsqueeze(1)
    dist = torch.where(odd, dist_d[:, FLIP], dist_d)
    g = gamma ** m.float().unsqueeze(1)
    draw = torch.tensor([0.0, 1.0, 0.0], device=dist.device)
    return g * dist + (1 - g) * draw


def td_loss(online: nn.Module, target: nn.Module, batch: dict, cfg: DQNConfig, dtype=None):
    """The Q-learning loss on a batch of transitions, and the mean predicted score (a health check)."""
    with torch.no_grad():
        mover = mover_target(bootstrap_dist(batch["d"], batch["done"], online, target, cfg.double_q),
                             batch["m"], cfg.gamma)
    online.train()
    with torch.autocast(batch["x"].device.type, dtype=dtype or torch.float32, enabled=dtype is not None):
        if isinstance(online, ActionQNet):
            logits = online(gpu.encode(batch["s"], PLANES))
            q = logits.float()[torch.arange(len(logits), device=logits.device), batch["a"]]
            goal = mover[:, WIN] + 0.5 * mover[:, DRAW]
            loss = F.binary_cross_entropy_with_logits(q, goal)
            predicted = torch.sigmoid(q).mean()
        else:
            logits = online(gpu.encode(batch["x"], PLANES)).float()
            goal = mover[:, FLIP]                              # x's side to move is the mover's opponent
            loss = -(goal * F.log_softmax(logits, 1)).sum(1).mean()
            p = torch.softmax(logits, 1)
            predicted = (p[:, LOSS] + 0.5 * p[:, DRAW]).mean()
    return loss, predicted.detach()


@torch.no_grad()
def polyak(target: nn.Module, online: nn.Module, tau: float) -> None:
    for t, o in zip(target.parameters(), online.parameters()):
        t.lerp_(o, tau)
    for t, o in zip(target.buffers(), online.buffers()):
        t.copy_(o)


# =============================================================================
# Evaluation
# =============================================================================
def dqn_policy(net: nn.Module) -> Callable:
    """A batched policy (for value_training.play_match) playing the network's best move, mates first."""

    @torch.no_grad()
    def policy(boards, gen):
        kids, moves, parent, _ = gpu.expand(boards)
        index = move_index(moves, boards[parent, 64] != 0)
        scores = child_scores(net, boards, kids, moves, parent, index,
                              torch.ones(len(kids), dtype=torch.bool, device=kids.device))
        scores = scores + 1e-6 * torch.rand(len(scores), device=scores.device, generator=gen)   # tie-break
        return kids[vt._children_choice(boards, scores, parent)]

    return policy


def evaluate(net: nn.Module, cfg: DQNConfig, device, opponent: Optional[nn.Module] = None, seed: int = 0) -> dict:
    """Matches against Jester (random), Greedy (material, 1 ply) and optionally the opponent model."""
    opponents = {"jester": vt.random_policy, "greedy": vt.greedy_material_policy}
    if cfg.eval_vs_cnn and opponent is not None:
        opponents["cnn (1 ply)"] = vt.network_policy(opponent, 1)
    policy = dqn_policy(net)
    results = {}
    for name, opp in opponents.items():
        m = vt.play_match(policy, opp, cfg.eval_games, cfg.eval_max_plies, cfg.random_opening_plies, seed, device)
        elo, lo, hi = vt.elo_diff(m["score"], cfg.eval_games)
        results[name] = {"score": float(m["score"]), "win": float(m["win"]), "draw": float(m["draw"]),
                         "loss": float(m["loss"]), "elo": float(elo), "elo_low": float(lo), "elo_high": float(hi),
                         "how games ended": m["how games ended"]}
    return results


def beats_greedy(results: dict) -> bool:
    """The deployment bar: a better score than Greedy with the Elo interval above zero."""
    g = results.get("greedy")
    return bool(g and g["score"] > 0.5 and g["elo_low"] > 0)


# =============================================================================
# Training
# =============================================================================
def _fingerprint(cfg: DQNConfig) -> dict:
    keep = {k: v for k, v in asdict(cfg).items()
            if k not in ("max_minutes", "total_positions", "eval_every_minutes", "eval_games", "eval_max_plies",
                         "eval_vs_cnn", "checkpoint_every_minutes")}
    return keep


def train(cfg: DQNConfig, run_dir, device=None, start_pool: Optional[np.ndarray] = None,
          log: Callable = print, on_checkpoint: Optional[Callable] = None) -> dict:
    """Train one Deep Q bot until its time or position budget is spent; resumable.

    Each loop: one move in every game; finished games' transitions go into the
    replay buffer; then training steps, `replay_ratio` samples per learner move
    played. Every `eval_every_minutes` the network plays Jester and Greedy;
    the weights with the best score against Greedy are kept as `best`.

    run_dir/last.pt holds the whole state (networks, optimiser, counters,
    history) and is rewritten every `checkpoint_every_minutes`. Calling
    train() again with the same run_dir and settings continues the run (the
    replay buffer refills from new games). on_checkpoint() is called after
    each save (Modal commits its volume there). Returns the final state dict.
    """
    device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    if device.type == "cuda":
        vt.configure_gpu()
    vt.seed_everything(cfg.seed)
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)
    dtype = vt.amp_dtype(device)

    online = build_qnet(cfg).to(device)
    target = copy.deepcopy(online).eval().requires_grad_(False)
    params = list(online.parameters())
    opt = torch.optim.AdamW([{"params": [p for p in params if p.ndim > 1], "weight_decay": cfg.weight_decay},
                             {"params": [p for p in params if p.ndim <= 1], "weight_decay": 0.0}], lr=cfg.lr)
    scaler = torch.amp.GradScaler(enabled=dtype == torch.float16)
    state = {"cfg": asdict(cfg), "fingerprint": _fingerprint(cfg), "positions": 0, "games": 0, "train_steps": 0,
             "elapsed_s": 0.0, "history": [], "best": None, "finished": False}
    last = run_dir / "last.pt"
    if last.exists():
        saved = torch.load(last, map_location=device, weights_only=False)
        if saved["fingerprint"] != state["fingerprint"]:
            raise ValueError(f"{last} was trained with other settings; use a new run_dir")
        online.load_state_dict(saved["online"])
        target.load_state_dict(saved["target"])
        opt.load_state_dict(saved["opt"])
        state.update({k: saved[k] for k in ("positions", "games", "train_steps", "elapsed_s", "history", "best")})
        log(f"resumed {run_dir.name}: {state['positions']:,} positions, {state['elapsed_s'] / 60:.1f} min")

    opponent = None
    if cfg.opponent == "cnn" or cfg.eval_vs_cnn:
        opponent = load_onnx_value_net(REPO / cfg.opponent_model if not Path(cfg.opponent_model).is_absolute()
                                       else cfg.opponent_model).to(device)
    if start_pool is None and cfg.pgn_start_frac > 0:
        start_pool = pgn_start_pool(REPO / cfg.pgn_path, cfg.pgn_max_ply)
    games = SelfPlay(cfg, online, start_pool, device, opponent, seed=cfg.seed + state["games"])
    buffer = ReplayBuffer(cfg.buffer_size, device)
    gen = torch.Generator(device=device).manual_seed(cfg.seed + state["train_steps"])

    def save(path=last):
        vt._save_atomically({**state, "online": online.state_dict(), "target": target.state_dict(),
                             "opt": opt.state_dict()}, path)
        if on_checkpoint:
            on_checkpoint()

    def run_eval():
        results = evaluate(online, cfg, device, opponent, seed=len(state["history"]))
        row = {"minutes": round(state["elapsed_s"] / 60, 2), "positions": state["positions"],
               "games": state["games"], "train_steps": state["train_steps"], **window, "results": results,
               "beats_greedy": beats_greedy(results)}
        state["history"].append(row)
        score = results["greedy"]["score"]
        if state["best"] is None or score > state["best"]["greedy_score"]:
            state["best"] = {"greedy_score": score, "minutes": row["minutes"], "positions": state["positions"],
                             "beats_greedy": row["beats_greedy"],
                             "state": {k: v.detach().cpu().clone() for k, v in online.state_dict().items()}}
        (run_dir / "history.json").write_text(json.dumps(state["history"], indent=1, default=str))
        g, j = results["greedy"], results["jester"]
        log(f"[{row['minutes']:6.1f} min] {state['positions']:>11,} positions {state['games']:>8,} games "
            f"{state['train_steps']:>7,} steps | loss {window['loss']:.4f} | vs Jester {j['score']:.0%} "
            f"| vs Greedy {g['score']:.0%} (Elo {g['elo']:+.0f}) | {window['positions_per_s']:,.0f} pos/s "
            f"| ends: {window['endings']}")

    budget_s = cfg.max_minutes * 60 if cfg.max_minutes else math.inf
    started = time.time() - state["elapsed_s"]
    last_eval, last_save = time.time(), time.time()
    credit = 0.0
    window = _new_window()
    while True:
        state["elapsed_s"] = time.time() - started
        progress = state["elapsed_s"] / budget_s
        if cfg.total_positions:
            progress = max(progress, state["positions"] / cfg.total_positions)
        if progress >= 1.0:
            break
        temperature = cfg.temperature_start + (cfg.temperature_end - cfg.temperature_start) * min(progress, 1.0)

        learner_moves = int(games.learner_to_move(games.current()).sum())
        batch = games.step(temperature, cfg.epsilon)
        state["positions"] += learner_moves
        window["new_positions"] += learner_moves
        if batch is not None:
            buffer.add(batch)
        if buffer.size < cfg.warmup:
            credit = 0.0
        else:
            credit += cfg.replay_ratio * learner_moves / cfg.batch_size
        while credit >= 1.0:
            credit -= 1.0
            for group in opt.param_groups:
                group["lr"] = cfg.lr * min(1.0, (state["train_steps"] + 1) / cfg.lr_warmup_steps)
            loss, predicted = td_loss(online, target, buffer.sample(cfg.batch_size, gen), cfg, dtype)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(online.parameters(), cfg.grad_clip)
            scaler.step(opt)
            scaler.update()
            polyak(target, online, cfg.tau)
            state["train_steps"] += 1
            window["loss_sum"] += float(loss.detach())
            window["pred_sum"] += float(predicted)
            window["steps"] += 1

        now = time.time()
        if now - last_eval >= cfg.eval_every_minutes * 60:
            _close_window(window, games, now - last_eval, buffer)
            state["games"] += window["games_finished"]
            run_eval()
            window, last_eval = _new_window(), time.time()
        if now - last_save >= cfg.checkpoint_every_minutes * 60:
            save()
            last_save = time.time()

    _close_window(window, games, time.time() - last_eval, buffer)
    state["games"] += window["games_finished"]
    run_eval()
    state["finished"] = True
    save()
    log(f"done: best vs Greedy {state['best']['greedy_score']:.0%} at {state['best']['minutes']} min "
        f"({'beats Greedy' if state['best']['beats_greedy'] else 'does not beat Greedy yet'})")
    return state


def _new_window() -> dict:
    return {"new_positions": 0, "loss_sum": 0.0, "pred_sum": 0.0, "steps": 0}


def _close_window(window: dict, games: SelfPlay, seconds: float, buffer: ReplayBuffer) -> None:
    """Summarise the period since the last evaluation into `window` (and reset the games' counters)."""
    steps = max(window["steps"], 1)
    total = max(sum(games.endings.values()), 1)
    window.update({
        "loss": window["loss_sum"] / steps if window["steps"] else float("nan"),
        "predicted_score": window["pred_sum"] / steps if window["steps"] else float("nan"),
        "positions_per_s": window.pop("new_positions") / max(seconds, 1e-9),
        "games_finished": sum(games.endings.values()),
        "mean_game_plies": float(np.mean(games.lengths)) if games.lengths else float("nan"),
        "endings": {k: round(v / total, 3) for k, v in sorted(games.endings.items(), key=lambda kv: -kv[1])},
        "buffer": buffer.size,
    })
    for k in ("loss_sum", "pred_sum", "steps"):
        window.pop(k)
    games.endings, games.lengths = {}, []


# =============================================================================
# Export and deployment
# =============================================================================
def load_run(run_dir, which: str = "best") -> tuple[nn.Module, dict]:
    """The network of a training run (its best or last weights) and the saved state."""
    state = torch.load(Path(run_dir) / "last.pt", map_location="cpu", weights_only=False)
    cfg = DQNConfig(**state["cfg"])
    net = build_qnet(cfg)
    net.load_state_dict(state["best"]["state"] if which == "best" and state["best"] else state["online"])
    return net.eval(), state


def export_dqn(net: nn.Module, cfg: DQNConfig, out_dir, extra: Optional[dict] = None) -> dict:
    """Write deep_q_<size>.onnx and its model card; check ONNX Runtime agrees with PyTorch.

    Only afterstate networks export: their input and output match the
    Convolutional models' (23 planes in, W/D/L logits out), so the web app's
    search plays them unchanged. Returns the model's web manifest entry.
    """
    if not isinstance(net, AfterstateQNet):
        raise ValueError("only afterstate networks play in the web app")
    import logging

    logging.getLogger("torch.onnx").setLevel(logging.ERROR)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"deep_q_{cfg.size}"
    net = copy.deepcopy(net).cpu().eval()
    sample = torch.from_numpy(ce.encode_boards(pgn_sample_boards(), planes=PLANES))
    onnx_path = out_dir / f"{stem}.onnx"
    batch = torch.export.Dim("batch", min=1, max=65536)
    torch.onnx.export(net, (sample,), onnx_path, input_names=["planes"], output_names=["wdl_logits"],
                      dynamic_shapes=({0: batch},), dynamo=True, external_data=False, verbose=False)
    with torch.no_grad():
        reference = torch.softmax(net(sample), 1).numpy()
    probs = player.OnnxEvaluator(str(onnx_path), providers=["CPUExecutionProvider"])(sample.numpy())
    assert np.allclose(probs, reference, atol=1e-4), f"{onnx_path.name} disagrees with PyTorch"
    size = vt.SIZES[cfg.size]
    entry = {"id": f"dqn-{cfg.size}", "family": "deep-q", "size": cfg.size, "file": onnx_path.name,
             "blocks": size.blocks, "channels": size.channels,
             "parameters": sum(p.numel() for p in net.parameters()), "input": "planes", "output": "wdl_logits",
             "encoding": ENCODING, "planes": PLANES, "label": f"Deep Q ({cfg.size})", **(extra or {})}
    card = {"model": f"PyChess Deep Q network ({cfg.size}: {size.blocks} residual blocks x {size.channels} channels)",
            "task": "P(win), P(draw), P(loss) for the side to move, learned by Q-learning from its own games",
            "input": {"name": "planes", "shape": ["batch", PLANES, 8, 8], "planes": ce.PLANE_NAMES,
                      "encoding": ENCODING, "reference": "core/encode.hpp"},
            "output": {"name": "wdl_logits", "shape": ["batch", 3], "order": ["win", "draw", "loss"]},
            "training": asdict(cfg), **(extra or {}),
            "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    (out_dir / f"{stem}_card.json").write_text(json.dumps(card, indent=2, default=str))
    return entry


def pgn_sample_boards(n: int = 16) -> np.ndarray:
    """A few varied positions (an opening line) for export checks."""
    g = ce.Game()
    boards = [g.board_array()]
    for san in ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4", "Nf6", "Nc3", "a6", "Be3", "e5", "Nb3", "Be6", "f3"]:
        g.push_san(san)
        boards.append(g.board_array())
    return np.stack(boards[:n])


def deploy(run_dir, models_dir=REPO / "web" / "public" / "models", force: bool = False) -> dict:
    """Export a run's best network into the web app (web/public/models) and list it in manifest.json.

    Refuses unless the network beat Greedy in an evaluation (beats_greedy), the
    bar for going live; force=True skips the check.
    """
    net, state = load_run(run_dir, "best")
    best = state["best"]
    if not (force or best["beats_greedy"]):
        raise RuntimeError(f"{run_dir}: the best network scored {best['greedy_score']:.0%} against Greedy, "
                           "without a significant win; not deploying (force=True to override)")
    cfg = DQNConfig(**state["cfg"])
    extra = {"opponent": cfg.opponent, "formulation": cfg.formulation, "score_vs_greedy": round(best["greedy_score"], 3),
             "trained_minutes": best["minutes"], "trained_positions": best["positions"],
             "beats_greedy": best["beats_greedy"]}
    entry = export_dqn(net, cfg, models_dir, extra)
    vt.write_web_manifest([entry], models_dir, merge=True)
    return entry
