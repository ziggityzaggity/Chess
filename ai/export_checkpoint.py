"""Export a trained model straight from its training checkpoint.

Use it to deploy one size while the others are still training. It needs only
the checkpoint (CPU is fine):

    python ai/export_checkpoint.py CHECKPOINTS/gpu/cnn-small/last.pt --out MODELS

It writes value_net_<size>.onnx (what the web app runs), .pt2, a checkpoint and
a model card to --out, and adds the model to --out/manifest.json, keeping the
models already listed there. To deploy, copy manifest.json and the .onnx file
into web/public/models/.
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
try:
    import chess_engine  # noqa: F401  (the C++ engine, built into this Python)
except ImportError:
    sys.exit(f"The chess engine (chess_engine) is not installed in this Python:\n  {sys.executable}\n"
             "Set up the development environment from the repository root and use its Python:\n"
             "  Windows:      scripts\\setup-dev.ps1, then .venv\\Scripts\\Activate.ps1\n"
             "  macOS/Linux:  scripts/setup-dev.sh, then source .venv/bin/activate\n"
             "(or `pip install .` from the repository root into the Python you are using).")
import value_training as vt  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("checkpoint", help="a training checkpoint: checkpoints/<profile>/cnn-<size>/last.pt")
    parser.add_argument("--out", default=str(Path(__file__).resolve().parent / "models"),
                        help="output directory (default: ai/models)")
    parser.add_argument("--size", choices=sorted(vt.SIZES), help="model size (default: inferred from the weights)")
    args = parser.parse_args()

    entry = vt.export_checkpoint(args.checkpoint, args.out, args.size)
    print(f"exported {entry['id']}: {entry['blocks']} blocks x {entry['channels']} channels, "
          f"{entry['parameters']:,} parameters, best epoch {entry['best_epoch']} of {entry['epochs_run']} "
          f"(validation log loss {entry['val_log_loss']})")
    if not entry["training_finished"]:
        print("note: training had not finished; these are the best weights so far")
    for f in sorted(Path(args.out).iterdir()):
        print(f"  {f.name:32s} {f.stat().st_size / 1e6:6.2f} MB")


if __name__ == "__main__":
    main()
