# Plan: Deep Q-learning bots

The goal is a **Deep Q** family of bots, in small, medium and large sizes. They learn
chess **by playing against themselves**, not from the 10,000 master games the
Convolutional bots learned from. They then play in the browser like the
Convolutional bots do: same depth slider, same ONNX runtime.

This document covers:
- the main design choices, each with its options, tradeoffs and a recommendation;
- every setting a training run will expose;
- how the bots will be evaluated;
- the order to build things in.

**Decisions** (from two rounds of review):
- **Formulation:** train **both** Q-function formulations and compare them. The
  afterstate network ships to the web app.
- **Heuristics:** **4 extra input planes**: attacks by each side, and each side's
  pieces in danger. That makes a 23-plane encoding for Deep Q; the Convolutional
  models keep 19.
- **Prior:** a linear prior on heuristic features (material, pieces in danger,
  centre occupation and control), with **randomly initialised** weights learned
  with the rest of the network (section 7a).
- **Starting positions:** half the games start from positions taken from the
  first 30 plies of the master games, for variety. Only the positions are used,
  never the results.
- **Two training loops** with identical networks and settings:
  - **self:** the learner plays itself;
  - **cnn:** the learner plays the medium Convolutional bot searching 2 plies.
- **Compute:** training runs on **Modal**, about **$1.50** for the small model
  (section 10).
- **Scope:** **small first**. Medium and large come only once small works.
- **Shipping:** the small model goes into the web app as soon as it **beats
  Greedy** depth 1.

## Status: implemented

| Piece | Where |
|---|---|
| 23-plane encoding (CPU, CUDA, WASM, Python), tested against python-chess | `core/encode.hpp`, `bindings/python/tests/test_heuristic_planes.py` |
| Both networks, rolling games, n-step transitions, repetition hashing, replay buffer, Double-DQN targets, time-budgeted resumable training, evaluation, export, deployment gate | `ai/dqn_training.py`, tests in `ai/test_dqn_training.py` |
| Modal launcher: dollar budget to minutes, parallel runs, volume, resume, retries | `ai/dqn_modal.py` |
| Notebook: method, heuristic planes, local or Modal runs, charts, comparison, deployment | `ai/deep_q_network.ipynb` |
| Web app: Deep Q sizes from the manifest, 23-plane models, "Still training…" | `web/src/lib/{bots,models,evaluators,bot}.ts`, `web/src/app/play/bot/page.tsx` |

`DQNConfig` in `ai/dqn_training.py` holds the settings as built. The rest of this
document is the design discussion. Some options it describes were left out of the
first version:
- prioritised replay;
- reward shaping;
- the endgame curriculum;
- the opponent league;
- TD-Leaf (search-bootstrapped) targets;
- mirror augmentation.

Each can be added later as a setting.

---

## 1. What "Q-learning" means for chess

Q-learning learns **Q(s, a)**: the expected final result when the player to move in
position `s` plays move `a` and both sides play well afterwards. Chess is different
from the Atari games DQN was built for in three ways, and each one shapes the design.

| Chess is… | Consequence |
|---|---|
| **Two-player and zero-sum.** | "Plays well afterwards" means the *opponent* maximises their own result. The Bellman target is a **negamax**: the value of my move is one minus the best the opponent can do next. |
| **Deterministic.** We know exactly which position each move leads to. | Q(s, a) is just the value of the position *after* the move, its **afterstate** s′ = s·a. One network that scores positions can serve as the Q-function (section 2). |
| **Rewarded only at the end.** Win, draw or loss, after 40–150 moves. | Credit takes a long time to reach early moves, so randomly playing networks rarely win at all. The fixes are multi-step targets, curricula and priors (sections 4–6). |

With values on the 0–1 scale the repo already uses (1 = win for the side to move,
½ = draw, 0 = loss), the Q-learning target for a move from `s` into afterstate `s′` is:

```
target(s′) = result                        if s′ ends the game (mate, stalemate, 50-move, no material)
           = 1 − max_{a′} Q(s′, a′)        otherwise   (the opponent replies as well as it can)
```

## 2. Formulation: what the network outputs (decided: both, compared)

### Option A: Afterstate Q-network (recommended)

- **What it outputs.** The network maps a position to its value for the side to
  move: `Q(s, a) = 1 − V(s·a)`. The architecture is exactly `ValueNet` from
  `ai/value_training.py`: 19 input planes, W/D/L logits out.
- **How it picks a move.** The engine already has all the pieces:
  1. `gpu.expand(boards)` lists every legal child;
  2. the network scores all of them in one batch;
  3. the bot plays the best one.

  This is `player.select_moves` with no changes.
- **Pros:**
  - **Nothing changes in the web app or move server.** The ONNX file has the same
    input and output as the Convolutional models. It drops into `manifest.json`, and
    the browser's alpha-beta search and the depth slider work as they are.
  - Learning generalises well: positions that look alike get similar values, even
    when the moves that reach them differ.
  - Legality is built in. The network only ever scores children of legal moves.
  - The two families can be compared fairly, because only the training signal
    differs, not the architecture.
- **Cons:**
  - Every decision evaluates all ~35 children, not one state. This is cheap with the
    CUDA `expand` kernel and large batches.
  - It isn't textbook DQN: there is no per-action output head, so "dueling" networks
    don't apply.

### Option B: Action-head DQN (the textbook version)

- **What it outputs.** One forward pass on `s` gives a Q-value for every possible
  move. That is the AlphaZero 8×8×73 = 4,672 move encoding, or 64×64 from→to plus
  promotions. Illegal moves are masked out before the argmax.
- **Pros:**
  - This is the DQN in papers. Dueling heads and Double DQN apply directly.
  - One forward pass per decision, so self-play is about 30× cheaper per move.
- **Cons:**
  - **Every deployment piece needs new work:**
    - a move-index encoding in C++, Python and TypeScript, kept identical;
    - a new ONNX output shape;
    - a new browser search that reads moves from the head;
    - the move server needs the same changes.
  - Learning is harder: 4,672 outputs, mostly illegal, with each move seen rarely.
    Published attempts at pure action-head DQN for chess learn slowly and stay weak.
  - Depth > 1 needs a separate value estimate anyway: `max_a Q(s, a)` stands in for
    `V(s)`, and it works but is noisier.

**Decision: both, with A shipped.**
- **A is the bot players meet.** It ships to the existing web app unchanged.
- **B is the comparison.** It is trained with the same self-play loop, buffer,
  prior, budget and opponents, and is evaluated with the same matches. The notebook
  reports A against B:
  - Elo against Greedy and the CNNs, for each position played and each GPU-hour;
  - tactics-suite score;
  - training stability.
- **What B needs that A doesn't:**
  - **A move-index encoding.** It uses the 8×8×73 AlphaZero layout, implemented
    once in `core/` so C++, CUDA and Python agree.
  - **Batched move→index on the GPU.** It is built from the `moves` tensor that
    `gpu.expand` already returns.
  - **A replay buffer that also stores the move index.**
  - **A policy-style head.** It is a 1×1 convolution to 73 planes, sharing the same
    residual tower, so the comparison is about the formulation, not the architecture.
  - **Dueling heads.** They apply only here, and are tested as an ablation.
- **Deploying B is out of scope for now.** If B wins clearly, deploying it is a
  separate piece of work: a new ONNX output and a browser search that reads the
  head.

## 3. Value head and reward

| Choice | Options | Tradeoff | Default |
|---|---|---|---|
| Output | **W/D/L logits** (3-class, like the CNN) · scalar `tanh` value | W/D/L is a 3-bin *distributional* Q-function, in the spirit of C51. It keeps "drawish" apart from "50/50", and it matches the web app's `wdl_logits` contract. A scalar is simpler, and the MSE loss is standard DQN. | W/D/L, trained with cross-entropy against target distributions |
| Reward | Final result only · plus **potential-based material shaping** | Shaping with `F = γ·Φ(s′) − Φ(s)` (Φ = material balance) gives early learning a signal without changing which policy is best (Ng et al. 1999). Too large a weight makes a material-greedy bot. | Off by default; a setting `shaping_weight` (0 → 0.1) |
| Discount γ | 1.0 · 0.99–0.999 | γ < 1 prefers faster wins and slower losses, so the bot actually delivers mate instead of drifting. It also keeps bootstrapped values bounded. γ = 1 matches the true game result. | 0.995 |
| Move cap | 200–400 plies, scored as a draw | Shorter caps give faster self-play and more decisive learning signal. Too short and the bot never learns to convert long endgames. | 300 (as in `match_max_plies`) |

## 4. The Q-learning target

These are the knobs that distinguish DQN variants. Each one is a setting.

- **Target network.**
  - **Options.** A frozen copy of the network computes targets. It is updated either
    every `C` gradient steps (hard copy) or as Polyak averaging, `θ⁻ ← τθ + (1−τ)θ⁻`.
  - **Tradeoff.** Too frequent an update means the targets chase themselves and
    values diverge. Too rare an update makes learning slow.
  - **Default.** Polyak with τ = 0.005.
- **Double DQN.**
  - **What it does.** The online network picks the opponent's best reply in s′, and
    the target network scores that reply. This removes the "max of noisy estimates"
    overestimation bias.
  - **Cost and default.** Nearly free (the children are expanded anyway). On by
    default.
- **n-step returns or TD(λ).**
  - **The problem.** With rewards only at the end, 1-step targets move credit back one
    ply per update cycle, which is slow.
  - **The options.**
    - n-step targets bootstrap from the position n plies later.
    - Monte Carlo uses the final game result (pure supervised self-play, like the
      CNN but on self-play games).
    - TD(λ) blends the two.
  - **Tradeoff.** Larger n lowers bias and propagates faster. It also adds more
    variance, and it is off-policy for ε-greedy moves.
  - **Default.** n = 5. A `lambda` setting mixes in the Monte Carlo result.
- **Search-bootstrapped targets (TD-Leaf, as used by KnightCap and Giraffe).**
  - **What it does.** The target is computed by a depth-2 negamax with the target
    network, not a 1-ply max. Targets are sharper, especially tactically.
  - **Cost.** About 35× the evaluations per target.
  - **Default.** Depth 1 at first; `target_depth = 2` is a setting.

## 5. Self-play and exploration

`play_match` in `ai/value_training.py` already plays thousands of games in
parallel on the GPU. Self-play reuses that loop, and writes transitions into the
replay buffer as it goes.

| Choice | Options | Tradeoff | Default |
|---|---|---|---|
| Exploration | **ε-greedy** · **Boltzmann/softmax** on Q (the Gumbel trick in `select_moves`) · noisy nets | ε-greedy is simple but explores uniformly, so it plays blunders that teach little. Softmax prefers near-best moves. ε needs a schedule, and temperature needs one too. | Softmax, temperature annealed 1.0 → 0.1, plus ε = 0.02 floor |
| Opening variety | Random first k plies · start from **positions sampled from the PGN data** | Without variety, self-play collapses onto a few openings. Sampling PGN positions uses no labels, only the positions, so it stays "learning by itself". | 4 random plies; PGN starts are a setting (see the "From scratch" open question) |
| Parallel games | 512 – 8,192 | More games give bigger, cheaper batches and more decorrelated data. They also give staler data relative to the network. | 4,096 on a GPU, 256 on a CPU |
| Self-play search depth | 1 · 2 | Depth 2 plays better games (better data) at about 35× the cost per move. | 1 |
| Opponents | Pure self-play · **league**: past checkpoints, Greedy, Jester mixed in | Pure self-play can cycle (A beats B beats C beats A) and forget. A league is more stable, and it shows progress against fixed bots. | 80% self, 15% past checkpoints, 5% Greedy |
| Repetitions | Ignore (current batched code) · track Zobrist hashes per game | Boards carry no history, so draws by repetition aren't seen. A learning bot can shuffle pieces until the move cap, which is wasted data. A per-game hash list in a tensor (hash on the GPU or in Python via `Game.key()`) fixes it. | Implement: hash kernel or Python fallback (phase 1) |

## 6. Replay buffer

- **Storage.** A transition stores the afterstate's 72-byte board, the
  n-step-later board, the accumulated reward, and a done flag. That is about 150
  bytes, so **10 M transitions take about 1.5 GB**. That fits in pinned CPU
  memory, or GPU memory on an L4 or A100.
- **Size.**
  - **Large (5–10 M):** more diverse data, less overfitting to recent games. The data
    comes from older, weaker policies.
  - **Small (0.5–1 M):** fresher data, faster to adapt, at more risk of
    forgetting.
  - **Default:** 2 M.
- **Replay ratio.**
  - **What it is.** Gradient updates per new position played.
  - **Tradeoff.** A higher ratio is more sample-efficient but overfits the buffer,
    and it is slower in wall-clock time when self-play is the bottleneck.
  - **Default:** 4 samples trained per position generated.
- **Prioritised replay (PER).** It samples transitions in proportion to their TD
  error. Usually it helps, especially with rare decisive endings. It costs a sum-tree
  and importance-sampling weights. **Default:** off, available as a setting in
  phase 3.
- **Augmentation.** Mirror the board left-to-right when the side has no castling
  rights. This is the `mirror_augment` already used for the CNN.

## 7. Network and initialisation

- **Sizes.** Reuse `SIZES`: small, medium and large are 3/6/8 residual blocks with
  32/64/96 channels. Same parameter counts, so comparisons are clean and the web app
  needs no new size options.
- **Initialisation (decided): a fresh network with a heuristic prior.** The CNN's
  material prior is a frozen linear layer on 12 piece counts. With its last layer
  at zero, an untrained net *is* the material model. Deep Q extends this to a
  **heuristic prior**: a small linear layer on hand-made features, added to the
  network's logits. Games are sensible from the first step: captures, mates and
  centre play happen, so rewards appear early. The web description ("Learns by
  playing against itself instead of studying master games") stays true, because
  the network itself starts untrained.

### 7a. The heuristic features

All features are counted from the side to move's point of view, "us" against
"them", like the input planes.

| Feature | Definition | Values |
|---|---|---|
| Material | Piece counts, 6 types × 2 sides (the current prior) | 12 counts |
| Our pieces in danger | Our pieces attacked by them and either undefended or attacked by a cheaper piece. Summed in pawn units, so a hanging queen counts 9. | 1 number, plus a count |
| Their pieces in danger | The same, for their pieces we attack | 1 number, plus a count |
| Centre occupation | Our pieces and their pieces on d4, e4, d5 and e5 | 2 counts |
| Centre control | Number of our attacks and their attacks on those four squares | 2 counts |
| Optional: extended centre | The same, on the 16 squares c3–f6 | 4 counts |

**Where they are computed.** In C++, in `core/encode.hpp`, from the
`isAttacked` logic in `core/chess.hpp`.
- An `attackers(square, colour)` count and a cheapest-attacker lookup are needed
  for "in danger" and "centre control".
- That one header is compiled into all three engines: the Python CPU module, the
  CUDA kernels and the browser's WASM. The features are therefore computed
  identically in training, self-play, the move server and the browser.

**How they reach the network** (decided: option 1). Two options:
1. **Extra input planes.** Add 4 planes to the encoding:
   - squares we attack;
   - squares they attack;
   - our pieces in danger;
   - their pieces in danger.

   The prior's scalar features are sums over these planes and the piece planes. The
   CNN also gets the attack maps directly, which helps it learn tactics.
   - **Cost.** A new encoding id (`pychess-23plane-stm-v1`). The WASM encoder must be
     rebuilt, and the web app must pick the encoding from each manifest entry. The
     Convolutional models keep 19 planes.
2. **Features computed only inside the prior.** Leave the 19 planes alone and
   compute the scalars in Python/CUDA beside the encoder.
   - **Problem.** The ONNX model would then need a second input, and the browser
     would need a second encoder call.
   - **Verdict.** It is simpler in training but awkward to deploy.

**Weights** (decided: random). The prior's weights must not be fitted to
master-game results, or "self-taught" would no longer be true.
- **What was built.** The prior's weights start **random** (PyTorch's default
  initialisation) and train at the full learning rate. The network learns from its
  own games how much material, danger and the centre are worth.
- **Settings.** The prior reads 21 features (`dq.FEATURE_NAMES`). `prior=False`
  turns it off, so its effect can be measured as an ablation.
- **The alternative considered.** Hand-set classical values, fine-tuned at a lower
  learning rate.

**Shaping.** The same features give the potential Φ for the optional reward
shaping (section 3). Then one definition of "a good position" is used everywhere.
- **Curriculum.** Optionally start a share of games from endgame positions:
  - random KQK, KRK and KPK positions, which are easy to generate;
  - endgames sampled from the PGNs.

  These teach the network that mate is worth something and which material converts,
  and that value then propagates back to middlegames. The share decays from 50% to
  0% over training.
- **BatchNorm during self-play.** The self-play network runs in `eval()` mode.
  Training batches come from the buffer, so BN statistics are fine. The target
  network uses its own BN running statistics.
- **Optimiser.** AdamW, with the same decay param groups and gradient clipping
  (norm 1.0) as the CNN. Use a constant LR with a short warmup: plateau schedules
  don't apply because the data keeps changing.

## 8. All settings (the `DQNConfig` dataclass)

These follow the pattern of `Config`/`PROFILES` in `value_training.py`. There are
`gpu`, `cpu` and `smoke` profiles.

> This table is the design proposal. The settings as built, with their defaults,
> are `DQNConfig` in `ai/dqn_training.py`. Differences from the table:
> - n = 3;
> - 2,048 parallel games;
> - a 1 M buffer;
> - batch 1,024;
> - temperature 0.05 → 0.005 on the expected-score scale;
> - `pgn_start_frac` 0.5;
> - a time budget (`max_minutes`) and time-based evaluations;
> - `opponent = "self" | "cnn"`.

| Group | Setting | Default (gpu) | Notes |
|---|---|---|---|
| Model | `size` | `small` | small / medium / large |
|  | `formulation` | `afterstate` | `afterstate` or `action_head` |
|  | `head` | `wdl` | `wdl` or `scalar` |
|  | `prior` | `heuristic` | `heuristic`, `material` or `none` |
|  | `prior_lr_scale` | 0.1 | 0 = frozen hand-set weights |
|  | `planes` | 23 | 19 = the CNN encoding, 23 = with the heuristic planes |
|  | `dueling` | `False` | action-head only |
|  | `init_from` | `None` | path to a checkpoint for warm start |
| Target | `gamma` | 0.995 |  |
|  | `n_step` | 5 |  |
|  | `td_lambda` | 0.0 | 0 = pure n-step bootstrap, 1 = Monte Carlo |
|  | `double_q` | `True` |  |
|  | `target_update` | `polyak` τ = 0.005 | or `hard` every C steps |
|  | `target_depth` | 1 | 2 = TD-Leaf style |
| Reward | `shaping_weight` | 0.0 | potential-based material shaping |
|  | `max_plies` | 300 |  |
| Self-play | `parallel_games` | 4,096 |  |
|  | `temperature` | 1.0 → 0.1 | linear over `explore_steps` |
|  | `epsilon_floor` | 0.02 |  |
|  | `random_opening_plies` | 4 |  |
|  | `pgn_start_frac` | 0.0 | share of games started from PGN positions |
|  | `endgame_curriculum` | 0.5 → 0.0 |  |
|  | `league` | self 0.8 / past 0.15 / greedy 0.05 |  |
|  | `detect_repetition` | `True` |  |
| Buffer | `buffer_size` | 2,000,000 |  |
|  | `replay_ratio` | 4 |  |
|  | `prioritized` | `False` | α = 0.6, β 0.4 → 1.0 |
|  | `mirror_augment` | `True` |  |
| Optimiser | `lr` | 1e-3 |  |
|  | `batch_size` | 2,048 |  |
|  | `weight_decay` | 1e-2 |  |
|  | `grad_clip` | 1.0 |  |
| Run | `total_positions` | 50 M | the training budget, in positions played |
|  | `eval_every` | 1 M positions |  |
|  | `checkpoint_every` | 15 min | resumable, like the CNN runs |

## 9. Evaluation

None of the following uses master-game labels for training. They are used only
to measure.

1. **Matches against fixed opponents**, every `eval_every`. Run 200–400 games
   against Jester, Greedy depth 1 and each deployed CNN size, with `play_match` and
   `elo_diff`. The main chart is Elo over training time.
2. **Self-Elo ladder.** Each checkpoint plays the previous ones. This catches
   cycling and forgetting.
3. **Tactics suite.** About 200 FENs with a forced mate in 1 or 2, or a free
   capture. It reports the share solved at depth 1. Mate in 1 should reach 100%
   early.
4. **Calibration against master results.** Log loss and accuracy on the CNN's held-out
   test positions. It isn't the training objective, but it shows whether self-play
   values mean what real games mean.
5. **Training health:**
   - TD loss and the mean and max predicted Q;
   - a divergence alarm if Q drifts towards 0 or 1 everywhere;
   - how self-play games end (mate, move cap, 50-move, repetition);
   - average game length;
   - buffer age;
   - self-play and training throughput.
6. **Same graphics as the CNN notebook**, where they apply. The notebook's charts
   stay in the same style.

## 10. Compute budget (decided: Modal)

**How training runs on Modal.** A new entry point, `ai/dqn_modal.py`, runs it the
way `serve/modal_app.py` runs the move server:

- **Command.** `modal run --detach ai/dqn_modal.py --budget-usd 1.50` trains both
  loops in parallel on two Modal GPUs, each with half the budget. `--detach` keeps
  the runs going after your terminal closes.
- **Image.** Torch with CUDA, plus the engine built *with* its CUDA kernels, so
  self-play runs on the GPU.
- **Storage.** A **Modal Volume** (`pychess-dqn`) holds the checkpoints and the
  metrics. A run that hits the function timeout (up to 24 h) or is pre-empted
  resumes from the volume with the same command. The replay buffer is not saved;
  it refills from new games.
- **Results.**
  - `modal volume get pychess-dqn …` downloads checkpoints and metrics.
  - The notebook reads the metrics for its charts and evaluates checkpoints
    locally or on Modal.
- **GPU choice.**
  - **Small:** an L4 or A10G is plenty.
  - **Medium/large:** an A100 cuts wall-clock time by about 3×.
  - Set it with `PYCHESS_TRAIN_GPU`, like `PYCHESS_GPU` for the move server.
- **Cost guard.** `--budget-usd` is converted to minutes of training. It uses
  Modal's per-second prices (`PRICES` in `ai/dqn_modal.py`: an L4 with 4 cores and
  16 GiB is about $1.12/h), minus 5 minutes per run for start-up and the final
  evaluation. A run stops cleanly with a checkpoint when its time is up.
  - $1.50 for both loops is about 35 minutes of training each.
  - `--max-minutes` sets the time directly, for example 3 for a test run.
- **Billing.** Modal needs a payment method on the account before it runs **any**
  GPU function. That is the same message the L4 move server showed, and there is no
  CPU workaround for training at a useful speed. A CPU profile on Modal or locally
  is only for smoke tests.

These are order-of-magnitude figures; phase 0 measures them properly.

- **Cost per move.** With Option A at depth 1, each self-play move evaluates about
  35 children.
- **Expected throughput.** A medium net on a T4 in float16 evaluates on the order of
  10⁵ positions per second. That is roughly 3,000 self-play moves per second, about
  10⁷ per hour.
- **Budget.** With $1.50 split over two loops, beating Greedy is not guaranteed.
  Measure it first: the notebook charts the score against Greedy over time, and the
  next run can be longer if the curve is still rising. In general, learning from
  scratch needs **tens of millions of positions played**
  before beating Greedy convincingly, and more to approach the CNN. That means hours
  on a free Colab T4, or less than an hour on an A100. A CPU is fine for the smoke
  test only.
- **Per size.**
  - **Small** trains fastest and is the right first target.
  - **Large** costs about 3× per position, and on the CNN results gained little over
    medium.

## 11. Code layout

| File | What |
|---|---|
| `ai/dqn_modal.py` | Modal entry point: GPU image, volume, detached resumable runs, `--max-hours` |
| `ai/dqn_training.py` | The module: `DQNConfig` and profiles, `ReplayBuffer`, `SelfPlay`, the Q-learning loss and targets, the training loop with checkpoints, evaluation. It imports `ValueNet`, `SIZES`, the match helpers and the export from `value_training.py`, without copying them. |
| `ai/deep_q_network.ipynb` | The notebook: concepts, then setup, training, charts and export. Same readable style as `chess_value_network.ipynb`, with code kept in the module. |
| `ai/test_dqn_training.py` | Fast CPU tests:<br>• the target sign and negamax;<br>• terminal handling;<br>• n-step accumulation;<br>• buffer wraparound;<br>• Double DQN selection;<br>• a smoke run that learns mate-in-one on a tiny net. |
| `core/` + bindings | <ul><li>Attack counts and the 23-plane heuristic encoding, available on the CPU, in CUDA and in WASM.</li><li>The 8×8×73 move index, for the action-head network.</li><li>A batched Zobrist hash, for repetition detection.</li></ul> |
| `web/src/lib/bots.ts` | Make `dqn` playable: sizes from the manifest (`dqn-small`, …), "Still training…" for sizes not yet deployed, same depth slider. |
| `web/public/models/manifest.json` | `family: "deep-q"` entries; the ONNX files reuse `export_model`. |

## 12. Milestones

0. **Engine features.**
   - Add attack counts, the heuristic planes and the move index in `core/`.
   - Check them against a slow Python reference on random positions, on the CPU, in
     CUDA (emulated) and in WASM.
   - Add repetition hashing.
1. **Harness.**
   - Build `dqn_training.py` for both formulations: the self-play loop, writing to a
     buffer, with a random or heuristic-prior policy.
   - Add `dqn_modal.py`.
   - Measure throughput on Modal.
   - CPU tests pass.
2. **Sanity: endgames.**
   - Train the small nets, both formulations, only on KQK/KRK starts.
   - Pass condition: they mate reliably against random defence within 50 moves, and
     the tactics suite reaches 100% on mate-in-1.
   - This shows the target, sign and terminal logic are right before spending real
     GPU hours.
3. **Full self-play, small: the first deliverable.**
   - Train both small nets with the curriculum.
   - Targets: beat Jester at about 100%, then Greedy depth 1.
   - Tune n-step, the replay ratio and the temperature here.
   - Write up the afterstate-against-action-head comparison in the notebook.
4. **Ablations.** Short small-net runs, each comparing one choice:
   - prior: none, material or heuristic;
   - Double DQN on and off;
   - n = 1, 5 and Monte Carlo;
   - shaping on and off;
   - PER;
   - target depth 1 and 2;
   - dueling (action-head only).
5. **Ship small.**
   - Export the afterstate network to ONNX and add it to the manifest.
   - Enable Deep Q in the web app, with "Still training…" for medium and large.
   - The web app reads each model's encoding (19 or 23 planes) from the manifest.
6. **Medium and large**, with the best settings, only once small works. After
   that, write a short report comparing Deep Q with the Convolutional bots.

## 13. Main risks

| Risk | Mitigation |
|---|---|
| Few decisive games early, so there is no learning signal | Material prior, endgame curriculum, shaping as a fallback, γ < 1 |
| Q-values diverge or collapse (the "deadly triad": bootstrapping + off-policy + function approximation) | Target network, Double DQN, gradient clipping, a divergence alarm, n-step |
| Strategy cycling and forgetting | League with past checkpoints; a big enough buffer; self-Elo ladder |
| Shuffling to the move cap | Repetition detection, γ < 1 |
| Too little compute to beat the CNN | Expected. The goal is a distinct, reasonably strong self-taught bot. Elo against Greedy and the CNNs is reported honestly either way. |

## Open questions

1. **Heuristic planes in the input.** Adding the 4 heuristic planes to the input is
   recommended. It means a 23-plane encoding for Deep Q, while the CNN models keep
   19 planes. The alternative is to keep the input at 19 planes and use the features
   only in the prior. Which?
2. **Prior weights.** Hand-set values that are trainable at a low learning rate is
   the recommendation. Or should the hand-set values stay frozen?
3. **PGN starting positions.** May self-play *start* from positions taken from the
   PGN games (positions only, never their results)?
4. **GPU budget on Modal.** Roughly how many GPU-hours (or dollars) per small run?
   That sets `total_positions` and `--max-hours`.
5. **Shipping.** Ship small to the web app as soon as it beats Greedy depth 1, or
   wait until the comparison and ablations are done?
