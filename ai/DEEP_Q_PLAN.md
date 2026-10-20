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

The choices marked **open question** need an answer before work starts (see
the end).

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

## 2. Formulation: what the network outputs **(open question)**

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

**Recommendation: A.** It ships to the existing web app unchanged, and it fits the
engine's batched expand-and-evaluate design. B can be a later experiment, trained
with the same buffer and loop.

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
- **Initialisation (open question).**
  - **From scratch with the material prior.** The prior is the frozen linear layer
    already in `ValueNet`: an untrained net then *is* the material model.
    - Games aren't random from day one, so mates and captures happen and rewards
      appear.
    - It is still "learning by itself": the prior is a 12-number piece-value table.
  - **Pure scratch, no prior.** The most honest version of "self-taught". Early
    games are nearly random and end by the move cap, so the reward signal is very
    sparse. It needs a curriculum (below) and much more compute.
  - **Warm start from the trained CNN.** Fastest by far, and almost certainly the
    strongest. But the bot then isn't really "learning by itself", and early on it
    mostly inherits the CNN's play.
  - **Recommendation:** material prior, no CNN warm start. The web description
    ("Learns by playing against itself instead of studying master games") stays true.
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

| Group | Setting | Default (gpu) | Notes |
|---|---|---|---|
| Model | `size` | `medium` | small / medium / large |
|  | `head` | `wdl` | `wdl` or `scalar` |
|  | `material_prior` | `True` |  |
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

## 10. Compute budget **(open question)**

These are order-of-magnitude figures; phase 0 measures them properly.

- **Cost per move.** With Option A at depth 1, each self-play move evaluates about
  35 children.
- **Expected throughput.** A medium net on a T4 in float16 evaluates on the order of
  10⁵ positions per second. That is roughly 3,000 self-play moves per second, about
  10⁷ per hour.
- **Budget.** Learning from scratch needs **tens of millions of positions played**
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
| `ai/dqn_training.py` | The module: `DQNConfig` and profiles, `ReplayBuffer`, `SelfPlay`, the Q-learning loss and targets, the training loop with checkpoints, evaluation. It imports `ValueNet`, `SIZES`, the match helpers and the export from `value_training.py`, without copying them. |
| `ai/deep_q_network.ipynb` | The notebook: concepts, then setup, training, charts and export. Same readable style as `chess_value_network.ipynb`, with code kept in the module. |
| `ai/test_dqn_training.py` | Fast CPU tests:<br>• the target sign and negamax;<br>• terminal handling;<br>• n-step accumulation;<br>• buffer wraparound;<br>• Double DQN selection;<br>• a smoke run that learns mate-in-one on a tiny net. |
| `core/` + bindings | A batched Zobrist hash (CPU and CUDA) for repetition detection, if the Python fallback is too slow. |
| `web/src/lib/bots.ts` | Make `dqn` playable: sizes from the manifest (`dqn-small`, …), "Still training…" for sizes not yet deployed, same depth slider. |
| `web/public/models/manifest.json` | `family: "deep-q"` entries; the ONNX files reuse `export_model`. |

## 12. Milestones

0. **Harness (½ day).**
   - Build the self-play loop, writing to a buffer, using a random or material
     policy.
   - Measure throughput on a CPU and on a GPU.
   - Add repetition detection.
   - Tests pass.
1. **Sanity: endgames (1 day).**
   - Train the small net only on KQK/KRK starts.
   - Pass condition: it mates reliably against random defence within 50 moves, and
     the tactics suite reaches 100% on mate-in-1.
   - This shows the target, sign and terminal logic are right before spending GPU
     hours.
2. **Full self-play, small (1–2 days of runs).**
   - Train the small net with the curriculum.
   - Targets: beat Jester at about 100%, then Greedy depth 1.
   - Tune n-step, the replay ratio and the temperature here.
3. **Ablations.** Short runs, each comparing one choice:
   - Double DQN on and off;
   - n = 1, 5 and Monte Carlo;
   - shaping on and off;
   - PER;
   - target depth 1 and 2.

   Report them in the notebook.
4. **Medium and large.** Train them with the best settings, on Colab or Modal.
5. **Ship.**
   - Export to ONNX and add the models to the manifest.
   - Enable Deep Q in the web app, with "Still training…" for sizes not yet
     deployed.
   - Write a short report comparing Deep Q with the Convolutional bots, like the CNN
     report.

## 13. Main risks

| Risk | Mitigation |
|---|---|
| Few decisive games early, so there is no learning signal | Material prior, endgame curriculum, shaping as a fallback, γ < 1 |
| Q-values diverge or collapse (the "deadly triad": bootstrapping + off-policy + function approximation) | Target network, Double DQN, gradient clipping, a divergence alarm, n-step |
| Strategy cycling and forgetting | League with past checkpoints; a big enough buffer; self-Elo ladder |
| Shuffling to the move cap | Repetition detection, γ < 1 |
| Too little compute to beat the CNN | Expected. The goal is a distinct, reasonably strong self-taught bot. Elo against Greedy and the CNNs is reported honestly either way. |

## Open questions

1. **Formulation.** Afterstate Q-network (recommended: it ships to the web app
   unchanged) or the textbook action-head DQN?
2. **From scratch?** Material prior only (recommended), pure scratch with no prior,
   or a warm start from the trained CNN? And may self-play *start* from positions
   taken from the PGN games? That uses no results, only positions.
3. **Compute.** Where will this train (free Colab T4, Colab Pro, your GPU, Modal),
   and for roughly how many GPU-hours per model?
4. **Scope.** All three sizes, or small first and the others only if it works? And
   should the web app ship Deep Q as soon as one size beats Greedy?
