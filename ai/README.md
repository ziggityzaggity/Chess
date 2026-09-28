# PyChess AI — a neural-network opponent

This directory holds the machine-learning workflow for PyChess's neural-network
opponent. A convolutional network learns, from master games, how likely the side
to move is to **win, draw or lose** a position. To play, the bot tries every legal
move and picks the one whose resulting position the network rates best for its
colour.

| Path | What it is |
|---|---|
| [`chess_value_network.ipynb`](chess_value_network.ipynb) | **The workflow:** raw games → EDA → cleaning → features → CNN → evaluation → move selection → export |
| [`data/download_games.py`](data/download_games.py) | Downloads and curates the training games (standard library only) |
| [`data/twic_otb2300.pgn`](data/twic_otb2300.pgn) | The 10,000 curated games |
| [`data/twic_otb2300.manifest.json`](data/twic_otb2300.manifest.json) | Source, filters, counts and checksum for the PGN |
| `models/` | Created by the notebook: `value_net.onnx`, `value_net.pt2`, checkpoint, model card (git-ignored) |

The chess logic (rules, PGN replay, network-input encoding, batched move
generation on CPU and CUDA) is the repository's C++ engine, called from Python
through pybind11. See [`bindings/python/README.md`](../bindings/python/README.md).

## The data

The games are 10,000 over-the-board classical games from *The Week in Chess*
(issues 1635–1649, spring 2026), both players FIDE 2300+. Results are 30.6% White
wins, 48.0% draws and 21.4% Black wins, over 875k positions. The selection keeps
games whose results reflect the board:

- online and rapid/blitz/Armageddon events are removed;
- engine and exhibition games are removed;
- only standard starts with proper results are kept;
- duplicates are removed.

To get more or different games:

```sh
python ai/data/download_games.py --target 50000             # more games (reads older issues)
python ai/data/download_games.py --min-elo 2400 --out ai/data/twic_otb2400.pgn
python ai/data/download_games.py --source twic               # official TWIC zips instead of the mirror
```

## Running the notebook

**Google Colab (recommended).**

1. Upload or open `ai/chess_value_network.ipynb`.
2. Choose *Runtime → Change runtime type → T4 GPU* (or better).
3. Choose *Run all*.

The first cell clones this repository and runs `pip install`. That compiles the
C++ engine and its CUDA kernels for the attached GPU. If the repository is
private, add a GitHub token as the Colab secret `GITHUB_TOKEN` first. The `gpu`
profile trains a 6-block, 64-channel residual CNN on all positions. The notebook
starts with a GPU self-test (perft plus GPU-vs-CPU comparisons), so a broken GPU
build is caught before training.

**Locally.**

```sh
pip install ".[torch]" matplotlib pandas scikit-learn jupyter onnxruntime   # from the repo root
jupyter notebook ai/chess_value_network.ipynb
```

Without a GPU the notebook picks the `cpu` profile, a smaller network on
sub-sampled epochs. The outputs saved in the notebook were produced that way.
Set `CHESS_PROFILE=gpu|cpu|smoke` to override.

## Playing against a trained model

```sh
python -m chess_engine.player ai/models/value_net.onnx --color white
```

Programmatically:

```python
import chess_engine as ce
from chess_engine import player

evaluate = player.load_evaluator("ai/models/value_net.onnx")    # or value_net.pt2
game = ce.Game()
game.push_san("e4")
move = player.choose_move(game, evaluate)                        # ScoredMove: .san, .score, .wdl
game.push(move.move)
```

`model_card.json` documents the input contract: plane order, side-to-move
perspective, and output order. The same encoding compiles to WASM with the rest of
the engine, which is the path to serving the model in the web app with
`onnxruntime-web`.
