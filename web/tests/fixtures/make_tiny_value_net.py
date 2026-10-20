"""Writes the test fixtures tiny_value_net.onnx and tiny_value_net.expected.json.

The network is untrained (random weights, 1 residual block x 8 channels) and
exists only so tests/bots.test.ts can check that the browser path (WASM
encoding + onnxruntime-web) matches PyTorch. Run from the repository root
after `pip install ".[torch]" onnxruntime`:

    python web/tests/fixtures/make_tiny_value_net.py
"""
import dataclasses
import json
import sys
import tempfile
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "ai"))
import chess_engine as ce  # noqa: E402
import value_training as vt  # noqa: E402

OUT = Path(__file__).resolve().parent
FENS = [
    "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
    "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
    "rn1q1rk1/1p2bppp/p2pbn2/4p3/4P3/1NN1BP2/PPPQ2PP/2KR1B1R b - - 4 10",
    "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1",
    "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1",
]

torch.manual_seed(0)
cfg = dataclasses.replace(vt.Config(), head_channels=4, hidden=16)
size = vt.ModelSize("tiny", blocks=1, channels=8)
net = vt.build_model(size, cfg).eval()
for p in net.parameters():          # spread the outputs so positions differ visibly
    p.data.mul_(1.6)
boards = np.stack([ce.board_from_fen(f) for f in FENS])
planes = ce.encode_boards(boards)
with tempfile.TemporaryDirectory() as tmp:
    vt.export_model(net, size, torch.from_numpy(planes), tmp, cfg)
    (OUT / "tiny_value_net.onnx").write_bytes((Path(tmp) / "value_net_tiny.onnx").read_bytes())
with torch.no_grad():
    probs = torch.softmax(net(torch.from_numpy(planes)), 1).numpy()
flat = planes.reshape(len(FENS), -1)
(OUT / "tiny_value_net.expected.json").write_text(json.dumps({
    "fens": FENS,
    "probs": probs.round(6).tolist(),
    "planes_nonzero": [[[int(i), float(flat[k, i])] for i in np.flatnonzero(flat[k])] for k in range(len(FENS))],
}))
print(probs)

# A tiny Deep Q network: the 23-plane heuristic encoding in, W/D/L logits out,
# exported like the real ones (dqn_training.export_dqn).
import dqn_training as dq  # noqa: E402

torch.manual_seed(1)
qcfg = dq.DQNConfig(size="small", head_channels=4, hidden=16)
qnet = dq.AfterstateQNet(channels=8, blocks=1, head_channels=4, hidden=16).eval()
for p in qnet.parameters():
    p.data.mul_(1.6)
qplanes = ce.encode_boards(boards, planes=ce.HEURISTIC_PLANES)
with tempfile.TemporaryDirectory() as tmp:
    dq.export_dqn(qnet, qcfg, tmp)
    (OUT / "tiny_deep_q_net.onnx").write_bytes((Path(tmp) / "deep_q_small.onnx").read_bytes())
with torch.no_grad():
    qprobs = torch.softmax(qnet(torch.from_numpy(qplanes)), 1).numpy()
qflat = qplanes.reshape(len(FENS), -1)
(OUT / "tiny_deep_q_net.expected.json").write_text(json.dumps({
    "fens": FENS,
    "probs": qprobs.round(6).tolist(),
    "planes_nonzero": [[[int(i), float(qflat[k, i])] for i in np.flatnonzero(qflat[k])] for k in range(len(FENS))],
}))
print(qprobs)
