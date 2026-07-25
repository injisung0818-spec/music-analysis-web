#!/bin/zsh
set -e

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=5173
BACKEND_LOG="$BACKEND_DIR/backend.log"
FRONTEND_LOG="$FRONTEND_DIR/frontend.log"
BACKEND_VENV="$BACKEND_DIR/.venv311"
PYTHON_COMMAND="python3.11"

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

backend_is_current_app() {
  curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/health" 2>/dev/null | grep -q "local-music-analysis" \
    && curl -fsS "http://127.0.0.1:$BACKEND_PORT/api/jobs" >/dev/null 2>&1
}

stop_port_listeners() {
  local port="$1"
  local pids
  pids=("${(@f)$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)}")
  for pid in "${pids[@]}"; do
    if [ -n "$pid" ]; then
      kill "$pid" >/dev/null 2>&1 || true
    fi
  done
  sleep 1
}

echo "Local Music Analysis MVP"
echo "Project: $ROOT_DIR"
echo ""

if ! command -v "$PYTHON_COMMAND" >/dev/null 2>&1; then
  PYTHON_COMMAND="python3"
  BACKEND_VENV="$BACKEND_DIR/.venv"
fi

if [ ! -d "$BACKEND_VENV" ]; then
  echo "Creating backend virtualenv..."
  "$PYTHON_COMMAND" -m venv "$BACKEND_VENV"
fi

if ! "$BACKEND_VENV/bin/python" -c "import fastapi, uvicorn" >/dev/null 2>&1; then
  echo "Installing backend core dependencies..."
  "$BACKEND_VENV/bin/pip" install -r "$BACKEND_DIR/requirements.txt"
fi

if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  echo "Installing frontend dependencies..."
  cd "$FRONTEND_DIR"
  npm install
  cd "$ROOT_DIR"
fi

STARTED_PIDS=()

if port_is_open "$BACKEND_PORT"; then
  if backend_is_current_app; then
    echo "Backend already running on http://127.0.0.1:$BACKEND_PORT"
  else
    echo "Stopping stale server on http://127.0.0.1:$BACKEND_PORT"
    stop_port_listeners "$BACKEND_PORT"
  fi
fi

if ! port_is_open "$BACKEND_PORT"; then
  echo "Starting backend on http://127.0.0.1:$BACKEND_PORT"
  cd "$BACKEND_DIR"
  "$BACKEND_VENV/bin/uvicorn" app.main:app --reload --port "$BACKEND_PORT" > "$BACKEND_LOG" 2>&1 &
  STARTED_PIDS+=($!)
  cd "$ROOT_DIR"
else
  echo "Using backend on http://127.0.0.1:$BACKEND_PORT"
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
