"""The move server on Modal: the large value network on a GPU, behind HTTPS.

Deploy from the repository root (see serve/README.md for the one-time setup):

    modal deploy serve/modal_app.py
    modal run serve/modal_app.py        # benchmark: move times on the GPU, nothing deployed

Settings, read at deploy time:
    PYCHESS_MODEL            the ONNX file to serve (default web/public/models/value_net_large.onnx)
    PYCHESS_GPU              Modal GPU type (default L4)
    PYCHESS_MIN_CONTAINERS   containers kept warm (default 0; 1 avoids cold starts, billed while idle)
    PYCHESS_ALLOWED_ORIGINS  comma-separated web origins allowed to call it
"""

import os
import sys
from pathlib import Path

import modal

sys.path.insert(0, str(Path(__file__).resolve().parent))   # move_service, for add_local_python_source
REPO = Path(__file__).resolve().parents[1]
MODEL = Path(os.environ.get("PYCHESS_MODEL", REPO / "web" / "public" / "models" / "value_net_large.onnx"))
GPU = os.environ.get("PYCHESS_GPU", "L4")
MIN_CONTAINERS = int(os.environ.get("PYCHESS_MIN_CONTAINERS", "0"))
ALLOWED_ORIGINS = os.environ.get("PYCHESS_ALLOWED_ORIGINS",
                                 "https://www.pychess.app,https://pychess.app,http://localhost:3000")
REMOTE_MODEL = "/models/value_net.onnx"

# Only what building the chess engine needs.
ENGINE_SOURCES = ["CMakeLists.txt", "pyproject.toml", "core/**", "bindings/python/**"]

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("build-essential")
    .pip_install(
        "onnxruntime-gpu[cuda,cudnn]==1.26.0",   # CUDA 12 + cuDNN 9 wheels, loaded by preload_dlls()
        "onnx==1.23.0",
        "onnxconverter-common==1.16.0",
        "numpy==2.3.3",
        "fastapi[standard]==0.142.2",
        "httpx==0.28.1",
    )
    .add_local_dir(REPO, "/opt/pychess", copy=True, ignore=~modal.FilePatternMatcher(*ENGINE_SOURCES))
    .run_commands("pip install /opt/pychess")      # the C++ engine (CPU build; the GPU runs the network)
    .env({"PYCHESS_ALLOWED_ORIGINS": ALLOWED_ORIGINS})
    .add_local_python_source("move_service")
    .add_local_file(MODEL, REMOTE_MODEL)
)

app = modal.App("pychess-move-server", image=image)


@app.cls(
    gpu=GPU,
    cpu=4,                       # tree expansion and encoding run on the CPU, multithreaded
    memory=8192,
    secrets=[modal.Secret.from_name("pychess-supabase")],   # SUPABASE_URL, SUPABASE_ANON_KEY
    min_containers=MIN_CONTAINERS,
    scaledown_window=600,        # stay warm for 10 minutes after the last move
    timeout=120,
)
@modal.concurrent(max_inputs=16)
class MoveServer:
    @modal.enter()
    def load(self):
        import logging

        import onnxruntime

        onnxruntime.preload_dlls()   # the CUDA and cuDNN libraries from the pip wheels
        logging.basicConfig(level=logging.INFO)
        from move_service import OnnxModel, SupabaseQuota, create_app

        model = OnnxModel(REMOTE_MODEL)
        model.warm_up()
        quota = SupabaseQuota(os.environ["SUPABASE_URL"], os.environ["SUPABASE_ANON_KEY"])
        self.web_app = create_app(model, quota, os.environ["PYCHESS_ALLOWED_ORIGINS"].split(","))

    @modal.asgi_app()
    def web(self):
        return self.web_app


@app.function(gpu=GPU, cpu=4, memory=8192, timeout=900)
def benchmark() -> dict:
    """Move times on the GPU for depths 1-3 (`modal run serve/modal_app.py`)."""
    import time

    import onnxruntime

    onnxruntime.preload_dlls()
    from move_service import OnnxModel, benchmark as run

    t0 = time.perf_counter()
    model = OnnxModel(REMOTE_MODEL)
    model.warm_up()
    return {"provider": model.session.get_providers()[0], "precision": model.precision,
            "startup_s": round(time.perf_counter() - t0, 1), "moves": run(model)}


@app.local_entrypoint()
def main():
    result = benchmark.remote()
    print(f"{result['provider']}, {result['precision']}, model loaded and warmed up in {result['startup_s']} s")
    print(f"{'position':12s} {'depth':>5s} {'move':>7s} {'positions':>10s} {'ms':>8s}")
    for row in result["moves"]:
        print(f"{row['position']:12s} {row['depth']:5d} {row['san']:>7s} {row['positions']:10,d} {row['elapsed_ms']:8.0f}")
