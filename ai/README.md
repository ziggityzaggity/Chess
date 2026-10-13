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

The small model is trained and deployed; the notebook trains medium and large.

| Path | What it is |
|---|---|
| [`chess_value_network.ipynb`](chess_value_network.ipynb) | **The workflow:** raw games → EDA → cleaning → features → CNNs → evaluation → move selection → export |
| [`value_training.py`](value_training.py) | The code the notebook calls: data loading, GPU data pipeline, model, resumable training, matches, export |
| [`export_checkpoint.py`](export_checkpoint.py) | Exports one model from its training checkpoint (deploy before the other sizes finish) |
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
profile trains medium and large. The notebook stops if the GPU
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

Without a GPU the notebook picks the `cpu` profile: only the medium model, on a
smaller budget. The outputs saved in the notebook were produced that way.
Set `CHESS_PROFILE=gpu|cpu|smoke` to override, or edit `cfg` in the
configuration cell (for example `sizes=("large",)`).

**How training works.** An epoch is a random sample of training positions
(250k on the GPU), since positions from one game are near-duplicates and full
passes lead to memorisation within a few epochs. The learning rate warms up over
the first epoch and is cut to 30% after every epoch without validation
improvement; training stops after 4 such epochs and keeps the best weights.
AdamW's weight decay (0.01) applies to convolution and linear weights only.
Mixed precision uses bfloat16 on Ampere and newer GPUs, float16 on older ones
such as the T4.

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

## Exporting one model early

Each model's checkpoint holds everything needed to export it, so a finished size
can be deployed while the others are still training:

```sh
python ai/export_checkpoint.py ai/checkpoints/gpu/cnn-small/last.pt --out ai/models
```

This writes the same files as the notebook's export, and adds the model to
`manifest.json` in `--out`, keeping the models already listed there. When the
notebook later finishes, its export rewrites the manifest with every trained size.

## Deploying to the web app

The web app runs the networks in the browser with `onnxruntime-web`. The same
encoding is compiled to WASM with the rest of the engine, and its search
(`web/src/lib/search.ts`) uses alpha-beta pruning. It offers exactly the models
listed in `web/public/models/manifest.json` (currently the small model); the
others show "Still training…". The notebook's `manifest.json` keeps the models
already deployed and adds the new ones. To deploy, copy it and the new
`value_net_<size>.onnx` files from `models/` into `web/public/models/`.
