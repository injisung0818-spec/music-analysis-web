# Backend

Local FastAPI service for upload, conversion, stem separation, analysis, and result assets.

Stem audio is saved as lossless FLAC when `ffmpeg` is available. If `ffmpeg`
is missing, generated WAV stems are kept. Uploaded source files, `source.wav`,
Demucs intermediate folders, and effectively silent stems are removed or skipped
to reduce storage without lossy audio compression.

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
