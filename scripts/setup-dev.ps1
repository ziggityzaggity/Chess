# Development environment for PyChess on Windows (PowerShell).
#
#   scripts\setup-dev.ps1            # Python venv in .venv + the web app's packages
#   scripts\setup-dev.ps1 -NoWeb     # Python only
#
# Needs Python 3.11 or 3.12 (64-bit), Visual Studio Build Tools with the
# "Desktop development with C++" workload, the latest Microsoft Visual C++
# Redistributable (x64, needed by PyTorch), and for the web app Node.js 20.9+.
# Safe to re-run. If scripts are blocked: Set-ExecutionPolicy -Scope Process Bypass
param([switch]$NoWeb)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")

function Invoke-Checked { & $args[0] $args[1..($args.Count - 1)]; if ($LASTEXITCODE) { throw "failed: $args" } }

$python = $null
foreach ($version in "3.12", "3.11") {
  & py "-$version" -c "import struct, sys; sys.exit(struct.calcsize('P') != 8)" 2>$null
  if ($LASTEXITCODE -eq 0) { $python = @("py", "-$version"); break }
}
if (-not $python) { throw "Python 3.11 or 3.12 (64-bit) is required (install from python.org, with the py launcher)" }

Write-Host "==> Python environment in .venv"
if (-not (Test-Path .venv)) { Invoke-Checked $python[0] $python[1] -m venv .venv }
$py = ".venv\Scripts\python.exe"
Invoke-Checked $py -m pip install --upgrade --quiet pip
Invoke-Checked $py -m pip install --quiet -r requirements-dev.txt

Write-Host "==> Chess engine (C++), editable: Python edits apply at once; rerun this script after C++ changes"
Invoke-Checked $py -m pip install --quiet --no-deps -e .
Invoke-Checked $py -m ipykernel install --user --name pychess --display-name "PyChess (.venv)"

if (-not $NoWeb) {
  if (Get-Command npm -ErrorAction SilentlyContinue) {
    Write-Host "==> Web app packages"
    Push-Location web; try { Invoke-Checked npm ci --no-audit --no-fund --loglevel=error } finally { Pop-Location }
  } else {
    Write-Warning "npm not found: skipping the web app (install Node.js 20.9+ and rerun)"
  }
}

Invoke-Checked $py -c "import chess_engine as ce, torch; print('chess_engine', ce.__version__, '| torch', torch.__version__)"
Write-Host @"

Ready. Activate with:   .venv\Scripts\Activate.ps1
Check everything with:  pytest bindings/python/tests ai/data ai/test_value_training.py serve
                        cd web; npm run test:bots
"@
