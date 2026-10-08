"""The code behind ai/chess_value_network.ipynb: data, model, training, play, export.

The notebook tells the story and draws the charts; this module holds the
machinery so each notebook cell reads as one step. Everything runs on the
GPU when one is present: positions stay on the device as compact 72-byte
boards, and the chess engine's CUDA kernels encode, expand and judge them
(see bindings/python/chess_engine/gpu.py).

Sections:
    configuration   Config, model SIZES, PROFILES
    data            load_games, replay_and_check, clean_games, label_positions, split_by_game
    pipeline        PositionLoader, make_loaders
    baselines       material_features, evaluate_probs, fit_material_model, material_prior
    model           ResidualBlock, ValueNet, build_model
    training        train (resumable checkpoints), predict
    play            policies, play_match, elo_diff, match_table, greedy_material_move
    export          export_model (ONNX + torch.export + checkpoint + model card), write_web_manifest
"""

from __future__ import annotations

import copy
import json
import math
import os
import random
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Optional

import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.nn.functional as F
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, log_loss
from sklearn.model_selection import train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

import chess_engine as ce
from chess_engine import gpu, player

CLASSES = ["win", "draw", "loss"]          # labels, from the side to move's point of view
SPLITS = ["train", "val", "test"]


# =============================================================================
# Configuration
# =============================================================================
@dataclass(frozen=True)
class ModelSize:
    name: str
    blocks: int        # residual blocks ("layers")
    channels: int      # convolution width


SIZES = {
    "small": ModelSize("small", blocks=3, channels=32),
    "medium": ModelSize("medium", blocks=6, channels=64),
    "large": ModelSize("large", blocks=8, channels=96),
}


@dataclass
class Config:
    seed: int = 7
    sizes: tuple = ("small", "medium", "large")   # which models to train
    # data cleaning
    min_plies: int = 20            # drop games shorter than this (forfeits, opening accidents)
    min_draw_plies: int = 40       # drop draws agreed before move 20 ("grandmaster draws")
    max_games: Optional[int] = None
    val_frac: float = 0.10
    test_frac: float = 0.10
    # model head
    head_channels: int = 32
    hidden: int = 128
    dropout: float = 0.3
    # training
    epochs: int = 20
    samples_per_epoch: Optional[int] = None   # None = every training position, every epoch
    batch_size: int = 1024
    lr: float = 2e-3
    weight_decay: float = 1e-4
    patience: int = 4              # early stopping: epochs without validation improvement
    mirror_augment: bool = True
    compile: bool = False          # torch.compile the model (faster epochs after a slow first one)
    # evaluation games
    match_games: int = 200
    match_max_plies: int = 300
    opening_random_plies: int = 4
    depth2_games: int = 100        # the optional two-ply experiment (~35x the evaluations)


PROFILES = {
    "gpu": Config(),
    "cpu": Config(sizes=("small",), epochs=10, samples_per_epoch=150_000, batch_size=512,
                  patience=3, match_games=64, depth2_games=32),
    "smoke": Config(sizes=("small",), max_games=400, epochs=2, samples_per_epoch=5_000,
                    batch_size=256, match_games=8, match_max_plies=60, depth2_games=4),
}


def seed_everything(seed: int) -> None:
    random.seed(seed)
    np.random.seed(seed)
    torch.manual_seed(seed)


def amp_dtype(device: torch.device):
    """Mixed precision for the device: bfloat16 where supported, else float16; none on CPU."""
    if device.type != "cuda":
        return None
    return torch.bfloat16 if torch.cuda.is_bf16_supported() else torch.float16


def configure_gpu() -> None:
    """Fast defaults for CUDA: cuDNN autotuning and TF32 matmuls/convolutions on Ampere+."""
    torch.backends.cudnn.benchmark = True
    torch.backends.cuda.matmul.allow_tf32 = True
    torch.backends.cudnn.allow_tf32 = True


# =============================================================================
# Data: PGN -> games table -> engine replay -> labelled positions -> split
# =============================================================================
def load_games(pgn_path, max_games: Optional[int] = None) -> pd.DataFrame:
    """One row per game: the PGN tags, typed, plus the movetext and derived columns."""
    raw = ce.split_pgn(Path(pgn_path).read_text())           # parsed by the C++ engine
    if max_games:
        raw = raw[:max_games]
    games = pd.DataFrame([{**tags, "movetext": movetext} for tags, movetext in raw])
    for col in ("WhiteElo", "BlackElo"):
        games[col] = pd.to_numeric(games[col], errors="coerce")
    games["Date"] = pd.to_datetime(games["Date"].str.replace("??", "01"), format="%Y.%m.%d", errors="coerce")
    games["white_score"] = games["Result"].map({"1-0": 1.0, "1/2-1/2": 0.5, "0-1": 0.0})
    games["mean_elo"] = (games["WhiteElo"] + games["BlackElo"]) / 2
    games["elo_diff"] = games["WhiteElo"] - games["BlackElo"]
    games["plies"] = [len(ce.san_tokens(m)[0]) for m in games["movetext"]]
    return games


def replay_and_check(games: pd.DataFrame, cfg: Config):
    """Replay every game through the engine; return the replay and a table of data-quality flags."""
    rep = ce.replay_games(games["movetext"].tolist())
    games["plies"] = rep["n_plies"]
    games["replay_error"] = rep["error"]
    games["result_token"] = rep["result_token"]
    checks = pd.Series({
        "illegal or unreadable move": (games["replay_error"] != "").sum(),
        "movetext result ≠ Result tag": (games["result_token"] != games["Result"]).sum(),
        "duplicate move sequences": games.duplicated("movetext").sum(),
        f"shorter than {cfg.min_plies} plies": (games["plies"] < cfg.min_plies).sum(),
        f"draw shorter than {cfg.min_draw_plies} plies": ((games["Result"] == "1/2-1/2")
                                                         & (games["plies"] < cfg.min_draw_plies)).sum(),
    })
    return rep, checks.to_frame("games flagged")


def clean_games(games: pd.DataFrame, cfg: Config) -> pd.DataFrame:
    keep = ((games["replay_error"] == "")
            & (games["result_token"] == games["Result"])
            & ~games.duplicated("movetext")
            & (games["plies"] >= cfg.min_plies)
            & ~((games["Result"] == "1/2-1/2") & (games["plies"] < cfg.min_draw_plies)))
    return games[keep].copy()


@dataclass
class Positions:
    boards: np.ndarray     # (P, 72) uint8 compact positions
    game: np.ndarray       # (P,) game index (row of the games table)
    ply: np.ndarray        # (P,) ply within the game, 0 = start
    labels: np.ndarray     # (P,) 0 win / 1 draw / 2 loss for the side to move


def label_positions(rep: dict, games: pd.DataFrame, clean: pd.DataFrame) -> Positions:
    """Every position of every kept game, labelled with the game's result for the side to move."""
    sel = np.isin(rep["game"], clean.index.to_numpy())
    boards, game, ply = rep["boards"][sel], rep["game"][sel], rep["ply"][sel]
    side = ce.board_fields(boards)["side"]
    white_score = games["white_score"].to_numpy()[game]
    stm_score = np.where(side == ce.WHITE, white_score, 1.0 - white_score)
    labels = np.select([stm_score == 1.0, stm_score == 0.5], [0, 1], 2).astype(np.int64)
    return Positions(boards, game, ply, labels)


def split_by_game(clean: pd.DataFrame, pos: Positions, cfg: Config):
    """Train / validation / test split over games (never positions), stratified by result.

    Returns (split, games_per_split, summary): split[i] is 0/1/2 for position i.
    """
    game_ids = clean.index.to_numpy()
    held = cfg.val_frac + cfg.test_frac
    train_g, hold_g = train_test_split(game_ids, test_size=held, stratify=clean["Result"], random_state=cfg.seed)
    val_g, test_g = train_test_split(hold_g, test_size=cfg.test_frac / held,
                                     stratify=clean.loc[hold_g, "Result"], random_state=cfg.seed)
    assert not (set(train_g) & set(val_g) or set(train_g) & set(test_g) or set(val_g) & set(test_g))
    split = np.select([np.isin(pos.game, train_g), np.isin(pos.game, val_g)], [0, 1], 2)
    summary = pd.DataFrame({
        "games": [len(train_g), len(val_g), len(test_g)],
        "positions": [(split == s).sum() for s in range(3)],
        **{f"{c} %": [100 * (pos.labels[split == s] == k).mean() for s in range(3)] for k, c in enumerate(CLASSES)},
    }, index=SPLITS).round(1)
    return split, (train_g, val_g, test_g), summary


def opening_overlap(pos: Positions, split: np.ndarray):
    """Share of test positions that also occur in training games, and how many of those are in the opening."""
    keys = pos.boards.view(np.dtype((np.void, ce.BOARD_BYTES))).ravel()
    train_keys = set(keys[split == 0].tolist())
    seen = np.array([k in train_keys for k in keys[split == 2].tolist()])
    return seen.mean(), np.mean(pos.ply[split == 2][seen] < 20)


# =============================================================================
# The GPU data pipeline
# =============================================================================
class PositionLoader:
    """Mini-batches (x, y) produced on `device` from compact 72-byte boards.

    The boards live on the device for the whole run (tens of MB instead of the
    gigabytes the float planes would take). Each batch is encoded there by the
    engine's CUDA kernel, and mirrored left-right at random when neither side
    can castle (the rules are mirror-symmetric then).
    """

    def __init__(self, boards, labels, batch_size, device, shuffle=False, augment=False,
                 samples=None, seed=0):
        self.boards = torch.from_numpy(np.ascontiguousarray(boards)).to(device)
        self.labels = torch.from_numpy(labels).to(device)
        self.batch_size, self.shuffle, self.augment, self.samples = batch_size, shuffle, augment, samples
        self.gen = torch.Generator(device=device).manual_seed(seed)

    def __len__(self):
        n = min(self.samples or len(self.labels), len(self.labels))
        return math.ceil(n / self.batch_size)

    def __iter__(self):
        n = len(self.labels)
        dev = self.labels.device
        order = (torch.randperm(n, device=dev, generator=self.gen) if self.shuffle
                 else torch.arange(n, device=dev))[: self.samples or n]
        for i in range(0, len(order), self.batch_size):
            idx = order[i : i + self.batch_size]
            b = self.boards[idx]
            x = gpu.encode(b)                                   # CUDA kernel (or C++ on CPU)
            if self.augment:
                can_mirror = b[:, 65] == 0                      # no castling rights left
                flip = can_mirror & (torch.rand(len(idx), device=dev, generator=self.gen) < 0.5)
                x = torch.where(flip[:, None, None, None], x.flip(-1), x)
            yield x, self.labels[idx]


def make_loaders(pos: Positions, split: np.ndarray, cfg: Config, device) -> dict:
    return {
        "train": PositionLoader(pos.boards[split == 0], pos.labels[split == 0], cfg.batch_size, device,
                                shuffle=True, augment=cfg.mirror_augment, samples=cfg.samples_per_epoch,
                                seed=cfg.seed),
        "val": PositionLoader(pos.boards[split == 1], pos.labels[split == 1], 4 * cfg.batch_size, device),
        "test": PositionLoader(pos.boards[split == 2], pos.labels[split == 2], 4 * cfg.batch_size, device),
    }


def encoder_throughput(boards: np.ndarray, device, n: int = 200_000) -> pd.DataFrame:
    """Positions encoded per second: the multithreaded C++ encoder vs the CUDA kernel."""
    sample = np.resize(boards, (n, ce.BOARD_BYTES))
    rows = {}
    t0 = time.perf_counter()
    ce.encode_boards(sample)
    rows["CPU (C++, all cores)"] = n / (time.perf_counter() - t0)
    if torch.device(device).type == "cuda":
        b = torch.from_numpy(sample).to(device)
        gpu.encode(b[:1000])
        torch.cuda.synchronize()
        t0 = time.perf_counter()
        for _ in range(5):
            gpu.encode(b)
        torch.cuda.synchronize()
        rows["GPU (CUDA kernel)"] = 5 * n / (time.perf_counter() - t0)
    return pd.DataFrame({"positions / second": rows}).round(0)


# =============================================================================
# Baselines and the material model
# =============================================================================
def material_features(boards: np.ndarray) -> np.ndarray:
    """Counts of each piece type (no kings), ours then theirs, from the side to move's view."""
    f = ce.board_fields(boards)
    sq, white = f["sq"], f["side"] == ce.WHITE
    w = np.stack([(sq == t).sum(1) for t in range(1, 6)], 1)          # white P N B R Q
    bl = np.stack([(sq == 8 + t).sum(1) for t in range(1, 6)], 1)     # black P N B R Q
    return np.where(white[:, None], np.hstack([w, bl]), np.hstack([bl, w])).astype(np.float32)


def evaluate_probs(probs: np.ndarray, y: np.ndarray) -> dict:
    onehot = np.eye(3)[y]
    return {"log loss": log_loss(y, probs, labels=[0, 1, 2]),
            "Brier": np.mean(np.sum((probs - onehot) ** 2, 1)),
            "accuracy": accuracy_score(y, probs.argmax(1)),
            "macro F1": f1_score(y, probs.argmax(1), average="macro")}


def fit_material_model(boards: np.ndarray, y: np.ndarray):
    """Logistic regression on standardised piece counts."""
    model = make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000))
    return model.fit(material_features(boards), y)


def material_prior(material_lr):
    """The material model re-expressed on raw piece counts, as (weight (3, 12), bias (3,)).

    Columns follow the network's piece planes: our P N B R Q K, their P N B R Q K
    (kings get no weight).
    """
    scaler, logreg = material_lr[0], material_lr[-1]
    coef = logreg.coef_ / scaler.scale_
    bias = logreg.intercept_ - coef @ scaler.mean_
    weight = np.zeros((3, 12), np.float32)
    weight[:, 0:5], weight[:, 6:11] = coef[:, :5], coef[:, 5:]
    return weight, bias.astype(np.float32)


def piece_values(material_lr) -> pd.DataFrame:
    """What the material model learned: log-odds of winning vs losing per extra piece."""
    weight, _ = material_prior(material_lr)
    edge = (weight[0] - weight[2])[:5]
    return pd.DataFrame({"log-odds per extra piece": edge, "in pawns": edge / edge[0]},
                        index=["pawn", "knight", "bishop", "rook", "queen"]).round(2).T


# =============================================================================
# The model
# =============================================================================
class ResidualBlock(nn.Module):
    def __init__(self, channels):
        super().__init__()
        self.conv1 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn1 = nn.BatchNorm2d(channels)
        self.conv2 = nn.Conv2d(channels, channels, 3, padding=1, bias=False)
        self.bn2 = nn.BatchNorm2d(channels)

    def forward(self, x):
        y = F.relu(self.bn1(self.conv1(x)))
        return F.relu(x + self.bn2(self.conv2(y)))


class ValueNet(nn.Module):
    """(N, 19, 8, 8) side-to-move planes -> (N, 3) logits over [win, draw, loss].

    With a material prior, a fixed linear layer on the 12 piece counts adds the
    material model's logits and the CNN learns the residual (its last layer
    starts at zero, so an untrained network *is* the material model).
    """

    def __init__(self, planes=19, channels=64, blocks=6, head_channels=32, hidden=128, dropout=0.3,
                 material_prior=None):
        super().__init__()
        self.stem = nn.Sequential(nn.Conv2d(planes, channels, 3, padding=1, bias=False),
                                  nn.BatchNorm2d(channels), nn.ReLU(inplace=True))
        self.tower = nn.Sequential(*[ResidualBlock(channels) for _ in range(blocks)])
        self.head = nn.Sequential(
            nn.Conv2d(channels, head_channels, 1, bias=False), nn.BatchNorm2d(head_channels), nn.ReLU(inplace=True),
            nn.Flatten(), nn.Linear(head_channels * 64, hidden), nn.ReLU(inplace=True),
            nn.Dropout(dropout), nn.Linear(hidden, 3))
        self.material = None
        if material_prior is not None:
            weight, bias = material_prior
            self.material = nn.Linear(12, 3)
            with torch.no_grad():
                self.material.weight.copy_(torch.as_tensor(weight, dtype=torch.float32))
                self.material.bias.copy_(torch.as_tensor(bias, dtype=torch.float32))
            self.material.requires_grad_(False)
            nn.init.zeros_(self.head[-1].weight)
            nn.init.zeros_(self.head[-1].bias)

    def forward(self, x):
        logits = self.head(self.tower(self.stem(x)))
        if self.material is not None:
            logits = logits + self.material(x[:, :12].sum(dim=(2, 3)))
        return logits


def build_model(size: ModelSize, cfg: Config, prior=None) -> ValueNet:
    return ValueNet(ce.NUM_PLANES, size.channels, size.blocks, cfg.head_channels, cfg.hidden, cfg.dropout, prior)


def trainable_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


def check_prior(model: ValueNet, boards: np.ndarray, material_lr, device) -> None:
    """An untrained network built on the prior must reproduce the material model exactly."""
    with torch.no_grad():
        x = torch.from_numpy(ce.encode_boards(boards)).to(device)
        p_net = torch.softmax(model.eval()(x), 1).cpu().numpy()
    assert np.allclose(p_net, material_lr.predict_proba(material_features(boards)), atol=1e-4)


# =============================================================================
# Training, with resumable checkpoints
# =============================================================================
@torch.no_grad()
def predict(model, loader, device) -> np.ndarray:
    """Softmax probabilities (numpy) for every position of a loader, in order."""
    model.eval()
    dtype = amp_dtype(torch.device(device))
    out = []
    for x, _ in loader:
        with torch.autocast(torch.device(device).type, dtype=dtype, enabled=dtype is not None):
            out.append(torch.softmax(model(x).float(), 1))
    return torch.cat(out).cpu().numpy()


_NOT_TRAINING = {"sizes", "compile", "match_games", "match_max_plies", "opening_random_plies", "depth2_games"}


def _save_atomically(obj, path: Path) -> None:
    tmp = path.with_suffix(".tmp")
    torch.save(obj, tmp)
    os.replace(tmp, path)


def train(model, loaders, y_val, cfg: Config, device, checkpoint_dir=None, label="", lr=None,
          epochs=None, patience=None) -> pd.DataFrame:
    """Train with AdamW + one-cycle LR + mixed precision + early stopping on validation log loss.

    After every epoch the full training state (weights, optimiser, schedule,
    loss scaler, data-order RNG, history, best weights so far) is written to
    `checkpoint_dir/last.pt`. Calling train() again with the same directory
    resumes where it stopped, and a finished run is simply reloaded, so a
    disconnected Colab session loses at most one epoch. The best weights are
    loaded into `model` at the end. Returns the per-epoch history.
    """
    device = torch.device(device)
    lr, epochs, patience = lr or cfg.lr, epochs or cfg.epochs, patience or cfg.patience
    dtype = amp_dtype(device)
    params = [p for p in model.parameters() if p.requires_grad]
    opt = torch.optim.AdamW(params, lr=lr, weight_decay=cfg.weight_decay)
    steps = len(loaders["train"])
    sched = torch.optim.lr_scheduler.OneCycleLR(opt, max_lr=lr, total_steps=epochs * steps, pct_start=0.15)
    scaler = torch.amp.GradScaler(enabled=dtype == torch.float16)
    step_model = torch.compile(model) if cfg.compile else model

    settings = {k: v for k, v in asdict(cfg).items() if k not in _NOT_TRAINING}
    fingerprint = {"label": label, **settings, "lr": lr, "epochs": epochs, "patience": patience,
                   "steps_per_epoch": steps, "parameters": trainable_parameters(model)}
    start, history, best = 1, [], {"loss": float("inf"), "state": None, "epoch": 0}
    ckpt = Path(checkpoint_dir) / "last.pt" if checkpoint_dir else None
    if ckpt and ckpt.exists():
        state = torch.load(ckpt, map_location="cpu", weights_only=False)   # RNG states must stay on the CPU
        if state["fingerprint"] != fingerprint:
            print(f"{label}checkpoint at {ckpt} is for a different run; starting fresh")
        elif state["finished"]:
            model.load_state_dict(state["best"]["state"])
            print(f"{label}already trained (best epoch {state['best']['epoch']}); loaded from {ckpt}")
            return pd.DataFrame(state["history"])
        else:
            model.load_state_dict(state["model"])
            opt.load_state_dict(state["optimizer"])
            sched.load_state_dict(state["scheduler"])
            scaler.load_state_dict(state["scaler"])
            loaders["train"].gen.set_state(state["data_rng"])
            torch.set_rng_state(state["torch_rng"])
            if device.type == "cuda" and state.get("cuda_rng") is not None:
                torch.cuda.set_rng_state_all(state["cuda_rng"])
            start, history, best = state["epoch"] + 1, state["history"], state["best"]
            print(f"{label}resuming from epoch {start} (checkpoint {ckpt})")
    if start == 1:   # a fresh run depends only on the model's initial weights and the config
        torch.manual_seed(cfg.seed)
        loaders["train"].gen.manual_seed(cfg.seed)
    if ckpt:
        ckpt.parent.mkdir(parents=True, exist_ok=True)

    finished = False
    for epoch in range(start, epochs + 1):
        model.train()
        t0 = time.time()
        total, seen = torch.zeros((), device=device), 0
        for x, y in loaders["train"]:
            with torch.autocast(device.type, dtype=dtype, enabled=dtype is not None):
                loss = F.cross_entropy(step_model(x), y)
            opt.zero_grad(set_to_none=True)
            scaler.scale(loss).backward()
            scaler.unscale_(opt)
            nn.utils.clip_grad_norm_(params, 1.0)
            scaler.step(opt)
            scaler.update()
            sched.step()
            total += loss.detach().float() * len(y)
            seen += len(y)
        train_loss = total.item() / seen
        val = evaluate_probs(predict(model, loaders["val"], device), y_val)
        speed = seen / (time.time() - t0)
        history.append({"epoch": epoch, "train log loss": train_loss, "val log loss": val["log loss"],
                        "val accuracy": val["accuracy"], "positions/s": speed})
        improved = val["log loss"] < best["loss"] - 1e-4
        if improved:
            best = {"loss": val["log loss"], "state": copy.deepcopy(model.state_dict()), "epoch": epoch}
        print(f"{label}epoch {epoch:2d}  train {train_loss:.4f}  val {val['log loss']:.4f}  "
              f"acc {val['accuracy']:.3f}  {speed:8,.0f} pos/s {'*' if improved else ''}")
        stop = epoch - best["epoch"] >= patience
        finished = stop or epoch == epochs
        if ckpt:
            _save_atomically({
                "fingerprint": fingerprint, "epoch": epoch, "finished": finished, "history": history,
                "best": best, "model": model.state_dict(), "optimizer": opt.state_dict(),
                "scheduler": sched.state_dict(), "scaler": scaler.state_dict(),
                "data_rng": loaders["train"].gen.get_state(), "torch_rng": torch.get_rng_state(),
                "cuda_rng": torch.cuda.get_rng_state_all() if device.type == "cuda" else None,
            }, ckpt)
        if stop:
            print(f"{label}early stop: no improvement for {patience} epochs")
            break
    model.load_state_dict(best["state"])
    return pd.DataFrame(history)


# =============================================================================
# Playing: single games and batched matches on the GPU
# =============================================================================
PIECE_VALUES = (1.0, 3.0, 3.0, 5.0, 9.0, 0.0)


def white_black(game: ce.Game, evaluate) -> dict:
    """The network's W/D/L for the side to move, relabelled as White / draw / Black."""
    p = evaluate(game.encode()[None])[0]
    w, d, l = (p if game.turn == ce.WHITE else p[::-1])
    return {"P(White wins)": w, "P(draw)": d, "P(Black wins)": l}


def show_moves(game: ce.Game, evaluate, top: int = 6, depth: int = 1) -> pd.DataFrame:
    """The best-scoring legal moves with their expected score and the mover's W/D/L."""
    scored = sorted(player.score_moves(game, evaluate, depth), key=lambda s: -s.score)[:top]
    return pd.DataFrame([{
        "move": s.san, "expected score": s.score,
        "W/D/L for the mover": ("decided: " + s.terminal if s.terminal
                                else "{:.2f} / {:.2f} / {:.2f}".format(*s.wdl) if s.wdl else f"{depth}-ply search"),
    } for s in scored])


def greedy_material_move(game: ce.Game, rng: random.Random):
    """The web app's greedy idea, one game at a time: take mate, else maximise material; ties at random."""
    values = {"p": 1, "n": 3, "b": 3, "r": 5, "q": 9, "k": 0}
    best, best_score = [], -math.inf
    for move in game.legal_moves():
        game.push(move)
        if game.is_checkmate():
            score = 1e9
        elif game.is_game_over():
            score = 0.0
        else:
            board = str(game).split()
            mine = sum(values[c.lower()] for c in board if c != "." and (c.isupper() == (game.turn == ce.BLACK)))
            theirs = sum(values[c.lower()] for c in board if c != "." and (c.isupper() == (game.turn == ce.WHITE)))
            score = mine - theirs
        game.undo()
        if score > best_score:
            best, best_score = [move], score
        elif score == best_score:
            best.append(move)
    return rng.choice(best)


def _children_choice(boards, key, parent):
    """For each board, the index of its child with the largest key (first on ties)."""
    best = torch.full((len(boards),), -math.inf, device=key.device).scatter_reduce(0, parent, key, "amax")
    idx = torch.arange(len(key), device=key.device)
    return torch.full((len(boards),), len(key), device=key.device).scatter_reduce(
        0, parent, torch.where(key == best[parent], idx, len(key)), "amin")


def random_policy(boards, gen):
    children, _, _, offsets = gpu.expand(boards)
    counts = offsets[1:] - offsets[:-1]
    pick = offsets[:-1] + (torch.rand(len(boards), device=boards.device, generator=gen) * counts).long()
    return children[pick]


def greedy_material_policy(boards, gen):
    children, _, parent, offsets = gpu.expand(boards)
    _, status = gpu.count_legal(children)
    pieces = gpu.encode(children)[:, :12].sum((2, 3))        # child's view: planes 6-11 are the mover's
    values = torch.tensor(PIECE_VALUES, device=boards.device)
    material = pieces[:, 6:12] @ values - pieces[:, 0:6] @ values
    st = status.long()
    key = torch.where(st == int(ce.Status.CHECKMATE), torch.full_like(material, 1e9),
                      torch.where(st != int(ce.Status.ONGOING), torch.zeros_like(material), material))
    key = key + 0.01 * torch.rand(len(key), device=key.device, generator=gen)   # random tie-break
    return children[_children_choice(boards, key, parent)]


def network_policy(net, depth: int = 1):
    """A batched policy playing the network with `depth`-ply lookahead (chess_engine.player)."""
    return lambda boards, gen: player.select_moves(boards, net, depth=depth)["child"]


@torch.no_grad()
def play_match(policy, opponent, n_games, max_plies, random_plies, seed, device) -> dict:
    """`policy` vs `opponent` over n_games played in parallel, colours alternating.

    Each ply, every running game is advanced at once with the CUDA kernels.
    The first `random_plies` plies are random for variety. Games still running
    after max_plies are draws. Repetitions are not detected (boards carry no
    history).
    """
    gen = torch.Generator(device=device).manual_seed(seed)
    boards = torch.from_numpy(ce.startpos()).to(device).repeat(n_games, 1)
    policy_white = torch.arange(n_games, device=device) % 2 == 0
    white_score = torch.full((n_games,), 0.5, device=device)
    done = torch.zeros(n_games, dtype=torch.bool, device=device)
    ended_by = torch.full((n_games,), -1, dtype=torch.long, device=device)   # Status code; -1 = move limit
    for ply in range(max_plies):
        active = ~done
        if not active.any():
            break
        white_to_move = boards[:, 64] == 0
        for fn, mask in ((policy, active & (white_to_move == policy_white)),
                         (opponent, active & (white_to_move != policy_white))):
            if mask.any():
                fn = random_policy if ply < random_plies else fn
                boards[mask] = fn(boards[mask], gen)
        _, status = gpu.count_legal(boards)
        ended = active & (status != int(ce.Status.ONGOING))
        mated = ended & (status == int(ce.Status.CHECKMATE))
        white_score[mated] = (boards[mated, 64] == 1).float()   # side to move is mated
        ended_by[ended] = status[ended].long()
        done |= ended
    score = torch.where(policy_white, white_score, 1 - white_score).cpu().numpy()
    endings = {"mate": ce.Status.CHECKMATE, "stalemate": ce.Status.STALEMATE, "50-move rule": ce.Status.FIFTY_MOVE,
               "no mating material": ce.Status.INSUFFICIENT_MATERIAL}
    shares = {name: (ended_by == int(code)).float().mean().item() for name, code in endings.items()}
    shares["move limit"] = (ended_by == -1).float().mean().item()
    how = ", ".join(f"{k} {v:.0%}" for k, v in sorted(shares.items(), key=lambda kv: -kv[1]) if v > 0)
    return {"win": np.mean(score == 1), "draw": np.mean(score == 0.5), "loss": np.mean(score == 0),
            "score": score.mean(), "games": n_games, "how games ended": how}


def elo_diff(score: float, n: int):
    """Elo difference implied by a match score, with a 95% interval."""
    s = np.clip(score, 1e-3, 1 - 1e-3)
    se = np.sqrt(s * (1 - s) / n)
    to_elo = lambda p: -400 * np.log10(1 / np.clip(p, 1e-3, 1 - 1e-3) - 1)
    return to_elo(s), to_elo(s - 1.96 * se), to_elo(s + 1.96 * se)


def run_match(policy, opponent, n_games, cfg: Config, device) -> dict:
    """play_match plus the Elo estimate and timing."""
    t0 = time.time()
    m = play_match(policy, opponent, n_games, cfg.match_max_plies, cfg.opening_random_plies, cfg.seed, device)
    elo, lo, hi = elo_diff(m["score"], n_games)
    m.update({"Elo difference": elo, "95% CI": f"{lo:+.0f} … {hi:+.0f}", "seconds": time.time() - t0})
    return m


def match_table(matches: dict) -> pd.DataFrame:
    return pd.DataFrame({
        name: {"games": m["games"], "win %": round(100 * m["win"], 1), "draw %": round(100 * m["draw"], 1),
               "loss %": round(100 * m["loss"], 1), "score %": round(100 * m["score"], 1),
               "Elo difference": round(m["Elo difference"]), "95% CI": m["95% CI"],
               "how games ended": m["how games ended"], "seconds": round(m["seconds"], 1)}
        for name, m in matches.items()}).T


# =============================================================================
# Export for deployment
# =============================================================================
ENCODING = "pychess-19plane-stm-v1"      # bump if core/encode.hpp changes


def export_model(model: ValueNet, size: ModelSize, sample: torch.Tensor, out_dir, cfg: Config,
                 extra: Optional[dict] = None) -> dict:
    """Write value_net_<size>.onnx / .pt2 / _checkpoint.pt and a model card; verify each file.

    Returns the model's entry for the web manifest.
    """
    import logging

    logging.getLogger("torch.onnx").setLevel(logging.ERROR)     # exporter chatter
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    stem = f"value_net_{size.name}"
    net = copy.deepcopy(model).cpu().eval()
    sample = sample.cpu()

    torch.save({"state_dict": net.state_dict(), "size": asdict(size), "config": asdict(cfg), **(extra or {})},
               out_dir / f"{stem}_checkpoint.pt")
    batch = torch.export.Dim("batch", min=1, max=65536)
    torch.export.save(torch.export.export(net, (sample,), dynamic_shapes=({0: batch},)), out_dir / f"{stem}.pt2")
    onnx_path = out_dir / f"{stem}.onnx"
    try:   # the torch.export-based exporter (PyTorch >= 2.5); weights embedded in one file
        torch.onnx.export(net, (sample,), onnx_path, input_names=["planes"], output_names=["wdl_logits"],
                          dynamic_shapes=({0: batch},), dynamo=True, external_data=False, verbose=False)
    except Exception as err:  # older PyTorch: the TorchScript-based exporter
        print("dynamo ONNX export unavailable, using the legacy exporter:", type(err).__name__)
        torch.onnx.export(net, (sample,), onnx_path, input_names=["planes"], output_names=["wdl_logits"],
                          dynamic_axes={"planes": {0: "batch"}, "wdl_logits": {0: "batch"}}, opset_version=17,
                          dynamo=False)

    with torch.no_grad():
        reference = torch.softmax(net(sample), 1).numpy()
    checks = {"pt2": player.load_evaluator(str(out_dir / f"{stem}.pt2"))(sample.numpy())}
    try:
        checks["onnx"] = player.load_evaluator(str(onnx_path))(sample.numpy())
    except ImportError:
        print("onnxruntime not installed: skipping the ONNX check (pip install onnxruntime)")
    for name, probs in checks.items():
        assert np.allclose(probs, reference, atol=1e-4), f"{stem}.{name} disagrees with PyTorch"

    entry = {"id": f"cnn-{size.name}", "family": "convolutional", "size": size.name, "file": onnx_path.name,
             "blocks": size.blocks, "channels": size.channels, "parameters": trainable_parameters(net),
             "input": "planes", "output": "wdl_logits", "encoding": ENCODING, **(extra or {})}
    card = {
        "model": f"PyChess value network ({size.name}: {size.blocks} residual blocks x {size.channels} channels)",
        "task": "P(win), P(draw), P(loss) for the side to move",
        "input": {"name": "planes", "shape": ["batch", ce.NUM_PLANES, 8, 8], "dtype": "float32",
                  "planes": ce.PLANE_NAMES, "encoding": ENCODING,
                  "perspective": "side to move; board flipped vertically and colours swapped when black is to move",
                  "reference": "core/encode.hpp (C++/CUDA/WASM), chess_engine.gpu.encode_torch (PyTorch)"},
        "output": {"name": "wdl_logits", "shape": ["batch", 3], "order": ["win", "draw", "loss"],
                   "activation": "softmax"},
        "move_selection": "negamax over legal moves to depth 1-3; horizon positions valued P(win) + 0.5 P(draw); "
                          "mate in one first (chess_engine.player)",
        "architecture": {"blocks": size.blocks, "channels": size.channels, "head_channels": cfg.head_channels,
                         "hidden": cfg.hidden, "dropout": cfg.dropout,
                         "material_prior": model.material is not None, "trainable_parameters": entry["parameters"]},
        "files": {"onnx": onnx_path.name, "pt2": f"{stem}.pt2", "checkpoint": f"{stem}_checkpoint.pt"},
        **(extra or {}),
        "created": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
    }
    (out_dir / f"{stem}_card.json").write_text(json.dumps(card, indent=2, default=str))
    return entry


def write_web_manifest(entries: list, out_dir) -> Path:
    """manifest.json for web/public/models/: the web app offers exactly the models listed here."""
    path = Path(out_dir) / "manifest.json"
    path.write_text(json.dumps({"version": 1, "encoding": ENCODING, "models": entries}, indent=2, default=str))
    return path
