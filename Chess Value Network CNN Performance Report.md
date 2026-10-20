# Chess Value Network: CNN Performance Report

Oct 13, 2026 · @Ali Zaki Rashid

## Summary

The medium and large CNNs both beat every baseline. On the test set, the medium model's log loss is 0.998 and the large model's 0.994, against 1.041 for the material-count model. Searching one move ahead, they score 60% and 58% against a material-greedy opponent; searching two moves ahead, the medium model wins all 100 games.

- **Run:** Colab T4, `gpu` profile, 690,786 training positions from 7,370 master games. Medium trained at 34,000 positions/s, large at 13,900; each finished in under 4 minutes.
- **Size:** the large model is no better than the medium one. It is 0.004 better in log loss and 3 points worse in play, both within noise, while running at 2.5 times the cost.
- **Material model:** building on it is what makes the CNN play well. The CNN without it scores a better log loss (0.983) but loses to the greedy player.
- **Blocker:** the export step failed (`onnx` is not installed on Colab), so this run produced no deployable files yet.

## Training

Both models reached their best validation loss at epoch 7 of 11 (medium 0.988, large 0.989), then stopped early.

&#91;image: Learning curves and validation accuracy of the medium model\]

- **Epoch 5 spike:** validation loss jumped from 0.994 to 1.010 at the peak learning rate. The schedule then cut the rate to 30% per stalled epoch, and validation recovered to its best at epoch 7.
- **Memorisation:** after epoch 7, training loss kept falling (to 0.917) while validation stayed flat at 0.992. The 0.07 gap is the model memorising the 7,370 training games; more games would help more than more epochs.
- **Speed:** the float16 fix worked. Medium trained at 34,000 positions/s against 2,000 in the earlier bfloat16 run, so each model took minutes.

## Accuracy on the test set

On 86,148 positions from 922 held-out games, the CNNs cut log loss by about 7% against always predicting the base rates. They also cut it 4% below the material-count model.

| Model | Log loss | Brier | Accuracy |
| --- | --- | --- | --- |
| Prior (base rates) | 1.075 | 0.650 | 43.9% |
| Material count (logistic regression) | 1.041 | 0.628 | 46.0% |
| Linear on the 19 input planes | 1.026 | 0.619 | 47.7% |
| Medium CNN on the material model | 0.998 | 0.602 | 49.8% |
| Large CNN on the material model | 0.994 | 0.600 | 49.8% |
| Medium CNN alone (ablation) | 0.983 | 0.595 | 50.3% |

Log loss is the main measure, because move selection uses the probabilities. Accuracy stays near 50% because most positions in master games are balanced.

&#91;image: Confusion matrix and calibration of the medium model\]

- **Confusion matrix:** the model predicts "draw" for 52% of positions from games that were eventually won or lost. That is correct behaviour: those positions were mostly balanced when they occurred.
- **Calibration:** the expected scores can be taken at face value (calibration error 0.021). The only drift is at the extremes, where the model is slightly overconfident. When it says 0.06, the side to move actually scores 0.15; when it says 0.93, it scores 0.88.

## Where the model helps

The CNN's advantage grows as the game goes on. In the first 30 plies no model beats the base rates. After ply 100, the medium model's log loss is 0.82, against 1.04 for the base rates.

&#91;image: Test log loss by game phase for each model\]

- **Openings:** masters rarely decide a game in the opening, so any position before ply 30 is close to a coin flip for every model.
- **Middlegame and endgame:** from ply 50 the CNNs pull away from material counting and the linear model. That gap is the positional understanding the convolutions add.
- **Without the material model:** the plain CNN is ahead in late, simplified positions. The next section shows why that doesn't translate into better play.

## Playing strength

Searching one move ahead, the medium model beats a material-greedy player by an estimated 72 Elo, with a 95% interval of +24 to +123. Searching two moves ahead, it wins all 100 games against the same player.

&#91;image: Match results against a random mover and a material-greedy player\]

- **Medium vs large:** the large model scores 57.5% against the greedy player, the medium model 60.3%. The intervals overlap (+53 vs +72 Elo), so size buys nothing in play here.
- **The material model is what makes it play well.** Without it, the medium CNN scores only 36.8% (an estimated −94 Elo) despite its better log loss. It rates "White up a queen in the opening" as an even game (P(White wins) 0.24), where the material-based model says 0.61. Human opponents hang pieces, so this is the case that matters.
- **One move of lookahead is not enough.** 56% of the medium model's games against the greedy player end with no mating material left, because a one-move search can't see recaptures. In the demo game it gave away a bishop on move 2 and lost. Two moves of lookahead fix exactly this.

## Limitations and recommendations

Deploy the medium model, with two moves of lookahead as the default (one for the large model). It plays as well as the large one at less than half the cost.

1. **Export the trained models from their checkpoints.** The run ended with `Module onnx is not installed`: the Colab setup installs `onnxruntime` but not `onnx` or `onnxscript`. The weights are safe in `MyDrive/pychess/checkpoints/gpu/`, so no retraining is needed. Export them with `ai/export_checkpoint.py`, then add the two packages to the setup cell.
2. **Prefer medium over large.** Large costs 2.2 times the parameters and about 2.5 times the compute per position, for no measurable gain in play.
3. **Default the small and medium bots to depth 2, the large bot to depth 1.** One move of lookahead gives away material to simple recaptures. Depth 2 won 100 of 100 games against the greedy player. The large model starts at depth 1 because each of its searches costs about 2.5 times as much.
4. **Get more games.** The 0.07 gap between training and validation loss shows the networks are limited by 7,370 training games, not by size. `ai/data/download_games.py --target 50000` needs no other change.
5. **Watch the endgames.** The medium model rates king and rook against king, a won ending, at only 0.44 to win and 0.55 to draw. Its most confident test errors (0.96–0.99) are mostly endgames that were held to a draw. Deeper search and more endgame data are the remedies.
