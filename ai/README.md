# PyChess AI — neural-network opponents

This directory holds the machine-learning workflow behind PyChess's
*Convolutional* bots. A convolutional network learns, from master games, how
likely the side to move is to **win, draw or lose** a position. To play, the bot
searches the legal moves 1–3 plies deep and picks the move whose outcome the
network rates best for its colour.

There are three model sizes, so players can choose their opponent:

| size | residual blocks ("layers") | channels | trainable parameters |
|---|---|---|---|
| small | 3 | 32 | 325k |
| medium | 6 | 64 | 720k |
| large | 8 | 96 | 1.6M |

| Path | What it is |
|---|---|
| [`chess_value_network.ipynb`](chess_value_network.ipynb) | **The workflow:** raw games → EDA → cleaning → features → CNNs → evaluation → move selection → export |
| [`value_training.py`](value_training.py) | The code the notebook calls: data loading, GPU data pipeline, model, resumable training, matches, export |
| [`data/download_games.py`](data/download_games.py) | Downloads and curates the training games (standard library only) |
| [`data/twic_otb2300.pgn`](data/twic_otb2300.pgn) | The 10,000 curated games |
| [`data/twic_otb2300.manifest.json`](data/twic_otb2300.manifest.json) | Source, filters, counts and checksum for the PGN |
| `checkpoints/` | Created by the notebook: training state after every epoch (git-ignored) |
| `models/` | Created by the notebook: `value_net_<size>.onnx` / `.pt2` / checkpoint / model card, and `manifest.json` (git-ignored) |

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
3. Choose *Run all*, and allow access to Google Drive when asked.

The first cell clones this repository and runs `pip install`. That compiles the
C++ engine and its CUDA kernels for the attached GPU. If the repository is
private, add a GitHub token as the Colab secret `GITHUB_TOKEN` first. The `gpu`
profile trains all three sizes on all positions. The notebook stops if the GPU
kernels did not build, and runs a GPU self-test (perft plus GPU-vs-CPU
comparisons) before training.

**Checkpoints.** Training state is saved after every epoch to
`MyDrive/pychess/checkpoints` (locally: `ai/checkpoints`). If Colab disconnects,
reconnect and *Run all* again: finished models load from their checkpoints, and an
interrupted one resumes from its last completed epoch, ending with exactly the
same weights as an uninterrupted run. The exported models land in
`MyDrive/pychess/models`. Set `SAVE_TO_DRIVE = False` in the first cell to keep
everything in the Colab session instead.

The notebook imports `value_training.py` from the cloned repository. A copy
uploaded next to the notebook takes precedence, and the notebook prints which
file it imported.

**Locally.**

```sh
pip install ".[torch]" matplotlib pandas scikit-learn jupyter onnxruntime   # from the repo root
jupyter notebook ai/chess_value_network.ipynb
```

Without a GPU the notebook picks the `cpu` profile: only the small model, on
sub-sampled epochs. The outputs saved in the notebook were produced that way.
Set `CHESS_PROFILE=gpu|cpu|smoke` to override, or edit `cfg` in the
configuration cell (for example `sizes=("small",)`).

## Playing against a trained model

```sh
python -m chess_engine.player ai/models/value_net_small.onnx --color white             # one ply
python -m chess_engine.player ai/models/value_net_small.onnx --color white --depth 3   # three plies
```

Programmatically:

```python
import chess_engine as ce
from chess_engine import player

evaluate = player.load_evaluator("ai/models/value_net_small.onnx")    # or .pt2
game = ce.Game()
game.push_san("e4")
move = player.choose_move(game, evaluate)                        # ScoredMove: .san, .score, .wdl
game.push(move.move)
```

`depth=1` (the default) plays the legal move whose resulting position the
network rates best for its colour. `depth=2` scores each move by the position
after the opponent's best reply, and `depth=3` adds the bot's own answer. Each
extra ply costs about 35 times the network evaluations, still batched. Already
at depth 2 the bot no longer walks into simple recaptures; the notebook measures
it.

Each `value_net_<size>_card.json` documents the input contract (plane order,
side-to-move perspective, output order) and the model's metrics.

## Deploying to the web app

The web app runs the networks in the browser with `onnxruntime-web`. The same
encoding is compiled to WASM with the rest of the engine, and its search
(`web/src/lib/search.ts`) uses alpha-beta pruning. It offers exactly the models
listed in `web/public/models/manifest.json`, which ships empty. To deploy, copy
`manifest.json` and the chosen `value_net_<size>.onnx` files from `models/` into
`web/public/models/`. Remove any entries from the manifest whose `.onnx` file you
did not copy.
