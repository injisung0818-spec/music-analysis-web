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

Install the optional stack for six-stem separation, music analysis, and MIDI extraction. If Demucs or its model fails, the job reports a separation error and still attempts tempo, key, and chord analysis.

```bash
pip install -r requirements-optional.txt
```

The first separation uses the Demucs model cache or downloads `htdemucs_6s`. Set `MUSIC_DEMUCS_REPO` to use a prepared local Demucs repository. FFmpeg is required for MP3 upload, mix generation, and FLAC/AAC conversion. Successful separation preserves the six original 24-bit WAV files.

The default Docker/Render deployment runs music analysis only. To build a Docker image with the full stack, use `docker build --build-arg INSTALL_AUDIO_MODELS=1 backend` from the project root and set `MUSIC_ENABLE_DEMUCS=1` when running it.

## Run

```bash
uvicorn app.main:app --reload --port 8000
```
