# chess_engine — Python / PyTorch bindings

The header-only C++ chess core (`core/`) exposed to Python with
[pybind11](https://pybind11.readthedocs.io), for training and playing neural
network models. It adds three things on top of the rules engine the web app
uses:

- **Per-turn neural network hooks.** `Game.encode()` returns the current
  position as network input. `Game.children()` returns every position one
  legal move away.
- **Vectorised batch operations on numpy arrays.** These are multithreaded C++
  with the GIL released: encode, count legal moves, and expand N positions.
  PGN parsing and game replay for building training sets are also batched.
- **CUDA kernels for the same batch operations.** `chess_engine.gpu` exposes
  them to PyTorch tensors, running on the current CUDA stream with no host
  round trips.

The kernels run the same `__host__ __device__` code as the CPU engine
(`core/chess.hpp`, `core/encode.hpp`), so CPU and GPU results are bit-identical.

## Install

From the repository root:

```sh
pip install .                  # builds the C++ module; CUDA kernels too if nvcc is found
pip install ".[torch,test]"    # + PyTorch helpers and the test suite
```

The build uses CMake through scikit-build-core. CUDA is auto-detected: CMake
looks for `nvcc` on `PATH` or in `$CUDACXX`. Kernels are compiled for the GPUs
`nvidia-smi` reports; if none is visible, they're compiled for sm_75 through
sm_90 plus PTX. Useful overrides:

```sh
pip install . -Ccmake.define.CHESS_CUDA=ON                     # fail if CUDA is missing
pip install . -Ccmake.define.CHESS_CUDA=OFF                    # CPU only
pip install . -Ccmake.define.CMAKE_CUDA_ARCHITECTURES="75;80"  # choose GPU archs
```

On Google Colab (GPU runtime) `pip install .` builds the kernels for the
attached GPU in about a minute. Check with:

```python
import chess_engine as ce
ce.CUDA_COMPILED, ce.cuda_available(), ce.cuda_build_info()
```

For development, a plain CMake build assembles an importable package in the
build tree:

```sh
cmake -S . -B build -DCHESS_BUILD_PYTHON=ON -Dpybind11_DIR=$(python -m pybind11 --cmakedir)
cmake --build build && (cd build && ctest)
PYTHONPATH=build/python pytest bindings/python/tests
```

## Positions as arrays

A position is a 72-byte `chess::Board` record, so a batch of positions is a
`uint8` array of shape `(N, 72)`. This compact form is what gets stored,
moved to the GPU and expanded. `board_fields()` gives named access:

| bytes | field | meaning |
|---|---|---|
| 0–63 | `sq` | squares, row-major, row 0 = rank 8. 0 is empty; otherwise `colour*8 + type` (P=1 N=2 B=3 R=4 Q=5 K=6, white=0, black=1) |
| 64 | `side` | 0 = white to move, 1 = black |
| 65 | `castling` | bits: 1 white O-O, 2 white O-O-O, 4 black O-O, 8 black O-O-O |
| 66 | `ep` | en-passant target square, or -1 |
| 67 | — | reserved, always 0 |
| 68–69 | `halfmove` | 50-move-rule clock |
| 70–71 | `fullmove` | move number |

## Network input

`encode_boards` / `Game.encode()` / `gpu.encode` produce `float32` planes of
shape `(N, 19, 8, 8)`. Everything is **from the side to move's perspective**:
when black is to move the board is flipped vertically and colours swapped. The
planes are:

| planes | content |
|---|---|
| 0–5 | our pawns, knights, bishops, rooks, queens, king (one-hot) |
| 6–11 | their pieces, same order |
| 12–15 | castling rights: our O-O, our O-O-O, their O-O, their O-O-O (constant planes) |
| 16 | en-passant target square (one-hot) |
| 17 | half-move clock / 100 (constant, clipped to 1) |
| 18 | ones (marks the board inside zero padding) |

`PLANE_NAMES` lists them. The single definition lives in `core/encode.hpp`,
and `gpu.encode_torch` is the same encoding written in plain PyTorch.

## API sketch

```python
import numpy as np, torch
import chess_engine as ce
from chess_engine import gpu, player

# One game, one turn at a time
g = ce.Game()                       # or ce.Game(fen)
g.push_san("e4"); g.push_uci("c7c5")
x = g.encode()                      # (19, 8, 8) float32 — the state for the network
boards, moves = g.children()        # (M, 72) positions after each legal move
g.is_game_over(), g.result(), g.pgn()

# Training data from PGN
games = ce.split_pgn(open("ai/data/twic_otb2300.pgn").read())      # [(tags, movetext)]
data = ce.replay_games([movetext for _, movetext in games])        # all positions, validated
X = ce.encode_boards(data["boards"])                               # (P, 19, 8, 8)

# Batch move generation (numpy or torch, CPU or GPU)
children, moves, parent, offsets = ce.expand_boards(data["boards"][:1000])
b = torch.from_numpy(data["boards"]).cuda()
x = gpu.encode(b)                   # CUDA kernel, on the current stream
counts, status = gpu.count_legal(b)
gpu.self_test("cuda")               # GPU vs CPU check + perft suite

# Choosing moves with a trained value network (see ai/)
best = player.choose_move(g, player.TorchEvaluator(model))            # one ply
best = player.choose_move(g, player.TorchEvaluator(model), depth=3)   # negamax, 3 plies
best.san, best.score                # expected score for the side to move
```

`python -m chess_engine.player model.onnx --depth 2` plays against an exported
model in the terminal (`--depth` 1–3).

## Tests

```sh
pytest bindings/python/tests        # needs the module built/installed
```

The suite covers:

- rules, SAN/PGN, and the encoding;
- CPU/torch/fake-GPU agreement;
- a python-chess cross-check over the training data;
- a real-GPU self-test, skipped without a GPU.

The C++ side runs through `ctest`: perft, rules, and `ml_test`. Its
`gpu_emulation_test` runs the actual CUDA kernel code on the CPU through
`core/gpu/cuda_emulation.hpp`, so the kernels are checked even on machines
without a GPU.
