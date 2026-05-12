#!/usr/bin/env bash
set -euo pipefail

INSTALL_ONLY=0
FORCE_FRONTEND_INSTALL=0

for arg in "$@"; do
  case "$arg" in
    --install-only)
      INSTALL_ONLY=1
      ;;
    --force-frontend-install)
      FORCE_FRONTEND_INSTALL=1
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$REPO_ROOT/backend"
FRONTEND_DIR="$REPO_ROOT/frontend"
BACKEND_VENV_DIR="$BACKEND_DIR/.venv"
BACKEND_PYTHON="$BACKEND_VENV_DIR/bin/python"
BACKEND_ENV_EXAMPLE="$BACKEND_DIR/.env.example"
BACKEND_ENV_FILE="$BACKEND_DIR/.env"

write_step() {
  echo
  echo "==> $1"
}

write_step "Checking prerequisites"

if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python3"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="python"
else
  echo "Python 3.11+ was not found. Install Python and re-run setup." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install Node.js 20+ and re-run setup." >&2
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "npm was not found. Install Node.js/npm and re-run setup." >&2
  exit 1
fi

echo "Python: $($PYTHON_BIN --version 2>&1)"
echo "Node:   $(node --version)"
echo "npm:    $(npm --version)"

if [[ ! -d "$BACKEND_VENV_DIR" ]]; then
  write_step "Creating backend virtual environment"
  (cd "$BACKEND_DIR" && "$PYTHON_BIN" -m venv .venv)
else
  write_step "Backend virtual environment already exists"
fi

write_step "Installing backend dependencies"
(cd "$BACKEND_DIR" && "$BACKEND_PYTHON" -m pip install --upgrade pip)
(cd "$BACKEND_DIR" && "$BACKEND_PYTHON" -m pip install -r requirements.txt)

if [[ ! -f "$BACKEND_ENV_FILE" && -f "$BACKEND_ENV_EXAMPLE" ]]; then
  write_step "Creating backend .env from .env.example"
  cp "$BACKEND_ENV_EXAMPLE" "$BACKEND_ENV_FILE"
else
  write_step "Backend .env already present"
fi

write_step "Installing frontend dependencies"
if [[ -d "$FRONTEND_DIR/node_modules" && "$FORCE_FRONTEND_INSTALL" -ne 1 ]]; then
  echo "Frontend node_modules already exists. Skipping reinstall."
  echo "Use ./setup.sh --force-frontend-install if you need a clean frontend reinstall."
else
  if [[ -f "$FRONTEND_DIR/package-lock.json" ]]; then
    (cd "$FRONTEND_DIR" && npm ci)
  else
    (cd "$FRONTEND_DIR" && npm install)
  fi
fi

if ! command -v cloudflared >/dev/null 2>&1; then
  echo
  echo "Note: cloudflared was not found in PATH."
  echo "Webhook/tunnel flows will need cloudflared installed locally."
fi

echo
echo "NubraOSS setup complete."
echo "Next step: run ./run.sh"

