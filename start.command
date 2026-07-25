#!/bin/zsh
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="$BACKEND_DIR/backend.log"
FRONTEND_LOG="$FRONTEND_DIR/frontend.log"

cd "$ROOT_DIR"

port_is_open() {
  lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
}

wait_for_url() {
  local url="$1"
  local tries=60
  while [ $tries -gt 0 ]; do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    tries=$((tries - 1))
    sleep 1
  done
  return 1
}

echo "Local Music Analysis MVP"
echo "Project: $ROOT_DIR"
echo ""

if [ ! -d "$BACKEND_DIR/.venv" ]; then
  echo "Creating backend virtualenv..."
  python3 -m venv "$BACKEND_DIR/.venv"
fi

if ! "$BACKEND_DIR/.venv/bin/python" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "Installing backend core dependencies..."
  "$BACKEND_DIR/.venv/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  npm install
  cd "$ROOT_DIR"
fi

STARTED_PIDS=()

if port_is_open "$BACKEND_PORT"; then
  echo "Backend already running on http://127.0.0.1:$BACKEND_PORT"
else
  echo "Starting backend on http://127.0.0.1:$BACKEND_PORT"
  cd "$BACKEND_DIR"
  "$BACKEND_DIR/.venv/bin/uvicorn" app.main:app --reload --port "$BACKEND_PORT" > "$BACKEND_LOG" 2>&1 &
  STARTED_PIDS+=($!)
  cd "$ROOT_DIR"
fi

if port_is_open "$FRONTEND_PORT"; then
  echo "Frontend already running on http://localhost:$FRONTEND_PORT"
else
  echo "Starting frontend on http://localhost:$FRONTEND_PORT"
  cd "$FRONTEND_DIR"
  npm run dev > "$FRONTEND_LOG" 2>&1 &
  STARTED_PIDS+=($!)
  cd "$ROOT_DIR"
fi

echo "Waiting for app..."
if wait_for_url "http://127.0.0.1:$BACKEND_PORT/api/health" && wait_for_url "http://127.0.0.1:$FRONTEND_PORT"; then
  open "http://localhost:$FRONTEND_PORT"
  echo ""
  echo "App is open: http://localhost:$FRONTEND_PORT"
else
  echo ""
  echo "The app did not become ready in time."
  echo "Backend log: $BACKEND_LOG"
  echo "Frontend log: $FRONTEND_LOG"
fi

echo ""
echo "Keep this window open while using the app."
echo "Press Ctrl+C here to stop servers started by this launcher."

cleanup() {
  for pid in "${STARTED_PIDS[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup INT TERM EXIT

if [ ${#STARTED_PIDS[@]} -gt 0 ]; then
  wait
else
  read "?Press Enter to close this window."
fi
