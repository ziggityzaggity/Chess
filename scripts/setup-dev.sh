#!/usr/bin/env bash
# Development environment for PyChess on macOS/Linux.
#
#   scripts/setup-dev.sh            # Python venv in .venv + the web app's packages
#   scripts/setup-dev.sh --no-web   # Python only
#
# Needs Python 3.11 or 3.12, a C++17 compiler (Xcode command-line tools, or
# build-essential) and, for the web app, Node.js 20.9+. Safe to re-run: it
# reuses .venv and reinstalls what changed.
set -euo pipefail
cd "$(dirname "$0")/.."

web=1
[[ "${1:-}" == "--no-web" ]] && web=0

python=""
for candidate in python3.12 python3.11 python3; do
  if command -v "$candidate" >/dev/null &&
     "$candidate" -c 'import sys; sys.exit(not ((3, 11) <= sys.version_info[:2] <= (3, 12)))'; then
    python="$candidate"; break
  fi
done
[[ -n "$python" ]] || { echo "Python 3.11 or 3.12 is required" >&2; exit 1; }

echo "==> Python environment in .venv ($("$python" --version))"
[[ -d .venv ]] || "$python" -m venv .venv
.venv/bin/python -m pip install --upgrade --quiet pip
.venv/bin/python -m pip install --quiet -r requirements-dev.txt

echo "==> Chess engine (C++), editable: Python edits apply at once; rerun this script after C++ changes"
.venv/bin/python -m pip install --quiet --no-deps -e .
.venv/bin/python -m ipykernel install --user --name pychess --display-name "PyChess (.venv)" >/dev/null

if [[ $web == 1 ]]; then
  if command -v npm >/dev/null; then
    echo "==> Web app packages"
    (cd web && npm ci --no-audit --no-fund --loglevel=error)
  else
    echo "!!  npm not found: skipping the web app (install Node.js 20.9+ and rerun)" >&2
  fi
fi

.venv/bin/python -c "import chess_engine as ce, torch; print('chess_engine', ce.__version__, '| torch', torch.__version__)"
cat <<'MSG'

Ready. Activate with:   source .venv/bin/activate
Check everything with:  pytest bindings/python/tests ai/data ai/test_value_training.py serve
                        (cd web && npm run test:bots)
MSG
