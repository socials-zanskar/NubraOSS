#!/usr/bin/env bash
set -euo pipefail

NO_OPEN=0
SKIP_SETUP=0

for arg in "$@"; do
  case "$arg" in
    --no-open)
      NO_OPEN=1
      ;;
    --skip-setup)
      SKIP_SETUP=1
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
BACKEND_PYTHON="$BACKEND_DIR/.venv/bin/python"
BACKEND_LOG="$BACKEND_DIR/backend.launch.log"
BACKEND_ERR_LOG="$BACKEND_DIR/backend.launch.err.log"
FRONTEND_LOG="$FRONTEND_DIR/frontend.launch.log"
FRONTEND_ERR_LOG="$FRONTEND_DIR/frontend.launch.err.log"
FRONTEND_URL="http://127.0.0.1:5173"
BACKEND_HEALTH_URL="http://127.0.0.1:8000/health"

write_step() {
  echo
  echo "==> $1"
}

test_url_ready() {
  python3 - "$1" <<'PY'
import sys, urllib.request
url = sys.argv[1]
try:
    with urllib.request.urlopen(url, timeout=3) as response:
        status = getattr(response, "status", 200)
        sys.exit(0 if 200 <= status < 500 else 1)
except Exception:
    sys.exit(1)
PY
}

wait_url_ready() {
  local url="$1"
  local timeout_seconds="$2"
  local elapsed=0
  while [[ "$elapsed" -lt "$timeout_seconds" ]]; do
    if test_url_ready "$url"; then
      return 0
    fi
    sleep 1
    elapsed=$((elapsed + 1))
  done
  return 1
}

if [[ "$SKIP_SETUP" -ne 1 ]]; then
  write_step "Running setup"
  bash "$REPO_ROOT/setup.sh" --install-only
fi

if [[ ! -x "$BACKEND_PYTHON" ]]; then
  echo "Backend virtual environment is missing. Run ./setup.sh first." >&2
  exit 1
fi

if test_url_ready "$BACKEND_HEALTH_URL"; then
  write_step "Backend already running"
else
  write_step "Starting backend on 127.0.0.1:8000"
  (
    cd "$BACKEND_DIR"
    nohup "$BACKEND_PYTHON" -m uvicorn app.main:app --host 127.0.0.1 --port 8000 >"$BACKEND_LOG" 2>"$BACKEND_ERR_LOG" &
  )
fi

if test_url_ready "$FRONTEND_URL"; then
  write_step "Frontend already running"
else
  write_step "Starting frontend on 127.0.0.1:5173"
  (
    cd "$FRONTEND_DIR"
    nohup npm run dev -- --host 127.0.0.1 --port 5173 --strictPort >"$FRONTEND_LOG" 2>"$FRONTEND_ERR_LOG" &
  )
fi

write_step "Waiting for services"
if ! wait_url_ready "$BACKEND_HEALTH_URL" 60; then
  echo "Backend did not become ready. Check $BACKEND_ERR_LOG" >&2
  exit 1
fi
if ! wait_url_ready "$FRONTEND_URL" 60; then
  echo "Frontend did not become ready. Check $FRONTEND_ERR_LOG" >&2
  exit 1
fi

echo
echo "NubraOSS is running."
echo "Frontend: $FRONTEND_URL"
echo "Backend:  $BACKEND_HEALTH_URL"

if [[ "$NO_OPEN" -ne 1 ]]; then
  if command -v open >/dev/null 2>&1; then
    open "$FRONTEND_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$FRONTEND_URL" >/dev/null 2>&1 || true
  fi
fi

