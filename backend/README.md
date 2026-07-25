# Backend

Local FastAPI service for upload, conversion, stem separation, analysis, and result assets.

## Setup

```bash
cd backend
python3.11 -m venv .venv311
source .venv311/bin/activate
pip install -r requirements.txt
```

Install system `ffmpeg` separately:

```bash
brew install ffmpeg
```

`demucs`, `librosa`, and `basic-pitch` are optional at runtime. If unavailable, jobs still complete with fallback stems, mock chord/key data, and placeholder MIDI.

```bash
pip install -r requirements-optional.txt
```

## Run

```bash
uvicorn app.main:app --reload --port 8000
```
