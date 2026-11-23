#!/bin/zsh
set -e
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
BACKEND_PORT=8000
FRONTEND_PORT=8282
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

confirm() {
  local answer
  [[ -t 0 ]] || return 1
  read "answer?$1 [y/N] " || return 1
  [[ "$answer" == [yY] || "$answer" == [yY][eE][sS] ]]
}

demucs_is_ready() {
  "$BACKEND_VENV/bin/python" -m demucs --help >/dev/null 2>&1
}

check_model() {
  HF_HUB_OFFLINE=1 "$BACKEND_VENV/bin/python" - <<'PY_CHECK'
import os
from pathlib import Path

import torch

repo = os.getenv("MUSIC_DEMUCS_REPO")
if repo:
    from demucs.pretrained import get_model
    model = get_model("htdemucs_6s", Path(repo).expanduser())
else:
    try:
        from demucs.hf import get_hf_model
        model = get_hf_model("htdemucs_6s")
    except (ImportError, OSError, ValueError):
        checkpoint = Path(torch.hub.get_dir()) / "checkpoints" / "5c90dfd2-34c22ccb.th"
        if not checkpoint.is_file():
            raise
        from demucs.pretrained import get_model
        model = get_model("htdemucs_6s")

assert set(model.sources) == {"vocals", "drums", "bass", "guitar", "piano", "other"}
PY_CHECK
}

echo "Local Music Analysis MVP"
echo "Project: $ROOT_DIR"
echo ""

if port_is_open "$BACKEND_PORT" && ! backend_is_current_app; then
  echo "Port $BACKEND_PORT is already in use. Stop that service before launching."
  exit 1
fi

if [ ! -x "$BACKEND_VENV/bin/python" ] && ! command -v "$PYTHON_COMMAND" >/dev/null 2>&1; then
  echo "Install Python 3.11 first (brew install python@3.11)."
  exit 1
fi

if [ ! -d "$BACKEND_VENV" ]; then
  echo "Creating backend Python 3.11 virtualenv..."
  "$PYTHON_COMMAND" -m venv "$BACKEND_VENV"
fi

if ! "$BACKEND_VENV/bin/python" -c "import fastapi, uvicorn, python_multipart, soundfile" >/dev/null 2>&1; then
  if ! confirm "Install the required backend packages in $BACKEND_VENV?"; then
    echo "The server needs the packages in backend/requirements.txt."
    exit 1
  fi
  "$BACKEND_VENV/bin/python" -m pip install -r "$BACKEND_DIR/requirements.txt"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1 && confirm "Install ffmpeg with Homebrew?"; then
    brew install ffmpeg
  else
    echo "ffmpeg is missing. Install it for MP3 upload and mix/format exports (brew install ffmpeg)."
  fi
fi

case "${MUSIC_ENABLE_DEMUCS:-1}" in
  0|false|no|off) echo "Demucs is disabled in this environment." ;;
  *)
    if ! demucs_is_ready; then
      echo "Demucs/PyTorch is missing or cannot run in $BACKEND_VENV."
      if confirm "Install the optional Demucs, analysis, and MIDI packages?"; then
        "$BACKEND_VENV/bin/python" -m pip install -r "$BACKEND_DIR/requirements-optional.txt" || true
      fi
    fi
    if demucs_is_ready; then
      "$BACKEND_VENV/bin/python" -c 'import platform, torch; print(f"Demucs uses PyTorch {torch.__version__} on {platform.machine()}.")'
      if check_model >/dev/null 2>&1; then
        echo "The htdemucs_6s model is ready."
      elif [ -n "${MUSIC_DEMUCS_REPO:-}" ]; then
        echo "Cannot load htdemucs_6s from MUSIC_DEMUCS_REPO. Check the local model files."
      elif confirm "Download and validate the htdemucs_6s model now?"; then
        "$BACKEND_VENV/bin/python" -c 'from demucs.pretrained import get_model; print(get_model("htdemucs_6s").sources)' \
          || echo "Model preparation failed. Check the network and the error above."
      else
        echo "The model will be requested on the first separation job."
      fi
    else
      echo "PyTorch separation is unavailable. Run backend/.venv311/bin/python -m demucs --help to see details."
    fi
    ;;
esac

MLX_PYTHON="${MUSIC_MLX_PYTHON:-$BACKEND_DIR/.venv-mlx/bin/python}"
if [ -z "${MUSIC_MLX_PYTHON:-}" ] && [ ! -x "$MLX_PYTHON" ]; then
  MLX_PYTHON="$BACKEND_VENV/bin/python"
fi
if "$MLX_PYTHON" -c 'from importlib.metadata import version; assert version("demucs-mlx") == "1.6.1"' >/dev/null 2>&1; then
  echo "Fast (MLX) is available in $MLX_PYTHON."
elif [[ "$(uname -m)" == "arm64" ]]; then
  echo "Fast (MLX) is optional. See the Apple Silicon instructions in README.md to enable it."
fi

"$BACKEND_VENV/bin/python" -c 'from importlib.util import find_spec; print("Optional packages: " + ", ".join(f"{name}={bool(find_spec(name))}" for name in ("librosa", "basic_pitch")))'

if ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js with npm to run the frontend."
  exit 1
fi
if [ ! -d "$FRONTEND_DIR/node_modules" ]; then
  if ! confirm "Install frontend dependencies from package-lock.json?"; then
    exit 1
  fi
  npm --prefix "$FRONTEND_DIR" ci
fi

BACKEND_MODE="${MUSIC_BACKEND:-auto}"
HYBRID_BIN="$BACKEND_DIR/.hybrid-bin"
case "$BACKEND_MODE" in
  auto|python|hybrid) ;;
  *) echo "Use MUSIC_BACKEND=auto, python, or hybrid."; exit 1 ;;
esac

build_hybrid() {
  command -v go >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1 || return 1
  mkdir -p "$HYBRID_BIN" || return 1
  local stage dsp_library
  case "$(uname -s)" in
    Darwin) dsp_library=libmusic_dsp.dylib ;;
    *) dsp_library=libmusic_dsp.so ;;
  esac
  stage="$(mktemp -d "$HYBRID_BIN/build.XXXXXX")" || return 1
  if (cd "$BACKEND_DIR/go" && go build -o "$stage/music-api" .) \
      && cargo build --release --locked --manifest-path "$BACKEND_DIR/rust/Cargo.toml" \
      && cp "$BACKEND_DIR/rust/target/release/music-dsp" \
        "$BACKEND_DIR/rust/target/release/$dsp_library" "$stage/"; then
    mv "$stage/music-api" "$stage/music-dsp" "$stage/$dsp_library" "$HYBRID_BIN/"
    rmdir "$stage"
    return 0
  fi
  rm -rf "$stage"
  return 1
}

USE_HYBRID=0
if ! port_is_open "$BACKEND_PORT" && [ "$BACKEND_MODE" != python ]; then
  if command -v go >/dev/null 2>&1 && command -v cargo >/dev/null 2>&1; then
    if build_hybrid; then USE_HYBRID=1; fi
  elif [ -x "$HYBRID_BIN/music-api" ] && [ -x "$HYBRID_BIN/music-dsp" ]; then
    USE_HYBRID=1
  fi
  if [ "$USE_HYBRID" -eq 0 ]; then
    echo "To build the hybrid backend, install Go 1.24+ and Rust (brew install go rust)."
    if [ "$BACKEND_MODE" = hybrid ]; then exit 1; fi
  fi
fi

if port_is_open "$BACKEND_PORT" && [ "$BACKEND_MODE" != auto ]; then
  running_mode=python
  if curl -fsS -D - -o /dev/null "http://127.0.0.1:$BACKEND_PORT/api/health" | grep -qi '^X-Music-Backend: go'; then
    running_mode=hybrid
  fi
  if [ "$running_mode" != "$BACKEND_MODE" ]; then
    echo "The $running_mode backend is already running. Stop it before selecting $BACKEND_MODE."
    exit 1
  fi
fi

STARTED_PIDS=()
cleanup() {
  for pid in "${STARTED_PIDS[@]}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if ! port_is_open "$BACKEND_PORT"; then
  echo "Starting backend on http://127.0.0.1:$BACKEND_PORT"
  cd "$BACKEND_DIR"
  if [ "$USE_HYBRID" -eq 1 ]; then
    echo "Using Go API, Rust DSP, and Python AI worker"
    MUSIC_RUST_DSP="$HYBRID_BIN/music-dsp" MUSIC_PARALLEL_ANALYSIS="${MUSIC_PARALLEL_ANALYSIS:-long}" \
      "$HYBRID_BIN/music-api" -backend "$BACKEND_DIR" -python "$BACKEND_VENV/bin/python" \
      -listen "127.0.0.1:$BACKEND_PORT" > "$BACKEND_LOG" 2>&1 &
  else
    "$BACKEND_VENV/bin/uvicorn" app.main:app --reload --port "$BACKEND_PORT" > "$BACKEND_LOG" 2>&1 &
  fi
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
  npm run dev -- --strictPort > "$FRONTEND_LOG" 2>&1 &
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

if [ ${#STARTED_PIDS[@]} -gt 0 ]; then
  wait
else
  read "?Press Enter to close this window."
fi
