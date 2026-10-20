"""Train the Deep Q bots on Modal GPUs, within a dollar budget.

From the repository root (Modal needs a payment method on the account to run GPUs):

    modal run --detach ai/dqn_modal.py                      # both loops, small, $1.50 in total
    modal run --detach ai/dqn_modal.py --loops self --budget-usd 0.75
    modal run --detach ai/dqn_modal.py --formulation both   # also train the action-head networks
    modal run ai/dqn_modal.py --max-minutes 3               # a short test run (about $0.10)

The two loops train identical networks with identical settings:

    self   the learner plays itself
    cnn    the learner plays the medium Convolutional bot searching 2 plies

They run in parallel, one GPU each, and the budget is split evenly between the
runs. The budget becomes a time limit from Modal's per-second prices (PRICES
below, from modal.com/pricing): an L4 with 4 CPU cores and 16 GiB costs about
$1.12 an hour, so $0.75 buys about 35 minutes of training plus start-up and
the final evaluation.

Runs are saved to the Modal Volume "pychess-dqn" under <size>-<formulation>-<loop>/:
last.pt (the whole training state, rewritten every few minutes), history.json
(the evaluations, for the notebook's charts), summary.json, and export/ with the
ONNX file of the best afterstate network. Starting a run again with the same
name and settings resumes it (Modal also retries a pre-empted run that way).
Download a run with

    modal volume get pychess-dqn small-afterstate-self ai/runs/

then, if it beat Greedy, put it in the web app with dqn_training.deploy("ai/runs/small-afterstate-self").

Settings, read when the app is launched:
    PYCHESS_TRAIN_GPU   Modal GPU type (default L4; T4 is cheaper and slower)
"""

import json
import os
import sys
import time
from pathlib import Path

import modal

REPO = Path(__file__).resolve().parents[1]
GPU = os.environ.get("PYCHESS_TRAIN_GPU", "L4")
CPU_CORES = 4.0
MEMORY_GIB = 16
REMOTE = "/root/pychess"                 # the repository's files the run needs, at the same relative paths
RUNS = "/runs"

# USD per hour, from modal.com/pricing (billed per second). Check them before a large run.
PRICES = {"gpu": {"T4": 0.59, "L4": 0.80, "A10G": 1.10, "A100": 2.10, "A100-80GB": 2.50, "H100": 3.95},
          "cpu_core": 0.0472, "memory_gib": 0.008}
OVERHEAD_MINUTES = 5.0                   # start-up, the final evaluation and export, per run

ENGINE_SOURCES = ["CMakeLists.txt", "pyproject.toml", "core/**", "bindings/python/**"]
RUN_FILES = ["ai/dqn_training.py", "ai/value_training.py", "ai/data/twic_otb2300.pgn",
             "web/public/models/value_net_medium.onnx"]


def hourly_cost(gpu: str = GPU) -> float:
    if gpu not in PRICES["gpu"]:
        raise ValueError(f"no price for GPU {gpu!r}; add it to PRICES (modal.com/pricing)")
    return PRICES["gpu"][gpu] + CPU_CORES * PRICES["cpu_core"] + MEMORY_GIB * PRICES["memory_gib"]


def training_minutes(budget_usd: float, gpu: str = GPU) -> float:
    """Minutes of training a run's share of the budget buys, after start-up and the final evaluation."""
    return budget_usd / hourly_cost(gpu) * 60 - OVERHEAD_MINUTES


image = (
    modal.Image.from_registry("nvidia/cuda:12.8.1-devel-ubuntu24.04", add_python="3.12")
    .apt_install("build-essential", "git")
    .pip_install("torch==2.14.0", "numpy==2.4.6", "pandas==3.0.6", "scikit-learn==1.9.1", "onnx==1.23.0",
                 "onnxscript==0.7.2", "onnxruntime==1.30.0")
    .add_local_dir(REPO, "/opt/pychess", copy=True, ignore=~modal.FilePatternMatcher(*ENGINE_SOURCES))
    # The chess engine with its CUDA kernels (nvcc from the image; no GPU needed to compile):
    # Turing (T4), Ampere (A10G, A100), Ada (L4), Hopper (H100).
    .run_commands('pip install /opt/pychess -Ccmake.define.CHESS_CUDA=ON '
                  '"-Ccmake.define.CMAKE_CUDA_ARCHITECTURES=75;80;86;89;90"')
)
for f in RUN_FILES:
    image = image.add_local_file(REPO / f, f"{REMOTE}/{f}")

app = modal.App("pychess-dqn", image=image)
volume = modal.Volume.from_name("pychess-dqn", create_if_missing=True)


@app.function(gpu=GPU, cpu=CPU_CORES, memory=MEMORY_GIB * 1024, volumes={RUNS: volume},
              timeout=6 * 3600, retries=modal.Retries(max_retries=2, initial_delay=10.0))
def train_run(name: str, overrides: dict, minutes: float) -> dict:
    """One training run on the GPU; resumes from the volume if this run was started before."""
    sys.path.insert(0, f"{REMOTE}/ai")
    import chess_engine as ce
    import dqn_training as dq

    print(f"{name}: {minutes:.1f} min on {GPU}; CUDA kernels: {ce.cuda_available()} ({ce.cuda_build_info()})",
          flush=True)
    volume.reload()
    cfg = dq.config_for("gpu", **overrides, max_minutes=minutes)
    run_dir = Path(RUNS) / name
    state = dq.train(cfg, run_dir, "cuda", log=lambda msg: print(f"{name} {msg}", flush=True),
                     on_checkpoint=volume.commit)
    best = state["best"]
    summary = {"run": name, "gpu": GPU, "minutes": round(state["elapsed_s"] / 60, 1),
               "positions": state["positions"], "games": state["games"], "train_steps": state["train_steps"],
               "best_score_vs_greedy": best["greedy_score"], "best_at_minutes": best["minutes"],
               "beats_greedy": best["beats_greedy"], "last": state["history"][-1]["results"]}
    if cfg.formulation == "afterstate":
        net, _ = dq.load_run(run_dir, "best")
        entry = dq.export_dqn(net, cfg, run_dir / "export", {"opponent": cfg.opponent,
                                                              "score_vs_greedy": best["greedy_score"],
                                                              "beats_greedy": best["beats_greedy"]})
        summary["export"] = entry["file"]
    (run_dir / "summary.json").write_text(json.dumps(summary, indent=2, default=str))
    volume.commit()
    return summary


@app.local_entrypoint()
def main(loops: str = "both", formulation: str = "afterstate", size: str = "small", budget_usd: float = 1.50,
         max_minutes: float = 0.0, tag: str = ""):
    """Start the runs in parallel and wait for their summaries.

    loops: self, cnn or both. formulation: afterstate, action_head or both.
    budget_usd is the total for everything started here, split evenly between the
    runs; max_minutes, if given, replaces it (a fixed training time per run).
    """
    opponents = {"both": ["self", "cnn"], "self": ["self"], "cnn": ["cnn"]}[loops]
    forms = ["afterstate", "action_head"] if formulation == "both" else [formulation]
    runs = [(f, o) for f in forms for o in opponents]
    minutes = max_minutes or training_minutes(budget_usd / len(runs))
    if minutes < 2:
        raise SystemExit(f"${budget_usd:.2f} for {len(runs)} runs leaves {minutes:.1f} min each: raise the budget")
    cost = len(runs) * (minutes + OVERHEAD_MINUTES) / 60 * hourly_cost()
    print(f"{len(runs)} run(s) on {GPU} at ${hourly_cost():.2f}/h: {minutes:.0f} min of training each, "
          f"about ${cost:.2f} in total")
    calls = []
    for form, opponent in runs:
        name = f"{size}-{form}-{opponent}" + (f"-{tag}" if tag else "")
        calls.append((name, train_run.spawn(name, {"size": size, "formulation": form, "opponent": opponent},
                                            minutes)))
        print(f"started {name}")
    started = time.time()
    for name, call in calls:
        summary = call.get()
        print(json.dumps(summary, indent=2, default=str))
        print(f"download: modal volume get pychess-dqn {name} ai/runs/")
    print(f"all runs finished after {(time.time() - started) / 60:.0f} min")
