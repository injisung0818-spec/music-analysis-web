# Local Music Analysis MVP

무료 로컬 실행용 Moises Studio 스타일 음악 분석 MVP입니다. 업로드한 MP3/WAV를 로컬 FastAPI job queue에서 처리하고, React DAW 스타일 UI에서 stems, waveform, BPM, key, chord timeline, MIDI 결과를 확인합니다.

## Features

- Upload `.mp3` / `.wav`
- `ffmpeg` WAV conversion when installed
- Demucs `htdemucs_6s` 6-stem separation when installed
- `librosa` BPM, beat grid, key, chroma chord timeline analysis when installed
- `basic-pitch` MIDI extraction when installed
- Faster default upload mode skips heavy Basic Pitch MIDI inference and writes placeholder MIDI; set `MUSIC_FAST_UPLOAD=0` for full MIDI extraction
- Graceful fallback mode: missing `ffmpeg`, `demucs`, `librosa`, or `basic-pitch` will not crash a job
- Outputs per job: `stems/*.wav`, `midi/*.mid`, `analysis.json`
- React/Vite/TypeScript UI with transport, stem mute/solo/volume, waveform lanes, progress and warnings

## Project Structure

```text
backend/
  app/
    main.py          FastAPI API, upload handling, in-process worker
    processor.py     ffmpeg/demucs/librosa/basic-pitch pipeline with fallbacks
  storage/           generated at runtime
frontend/
  src/
    App.tsx          DAW-style work surface
    api.ts           API client
    styles.css       dark Logic-inspired UI
```

## Backend Setup

```bash
cd backend
python3.11 -m venv .venv311
source .venv311/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Full Basic Pitch MIDI mode:

```bash
MUSIC_FAST_UPLOAD=0 uvicorn app.main:app --reload --port 8000
```

Recommended local tools:

```bash
brew install ffmpeg
pip install -r backend/requirements-optional.txt
```

`essentia` is listed as optional for supported Python versions, but the MVP currently uses a local `librosa` chroma-based key/chord analyzer.

## Frontend Setup

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). The Vite dev server proxies `/api` to `http://localhost:8000`.

## Output Location

Each upload creates:

```text
backend/storage/jobs/<job_id>/
  source.wav
  analysis.json
  stems/
    vocals.wav
    drums.wav
    bass.wav
    guitar.wav
    piano.wav
    other.wav
  midi/
    vocals.mid
    drums.mid
    bass.mid
    guitar.mid
    piano.mid
    other.mid
```

## Notes

- The first Demucs or Basic Pitch run may be slow and may require model downloads, depending on local installation.
- By default, `MUSIC_FAST_UPLOAD=1` keeps uploads faster by skipping Basic Pitch inference. Stem separation, waveform, BPM, key, and chord analysis still run locally.
- If `ffmpeg` is missing and an MP3 is uploaded, the backend generates silent fallback WAVs and still returns a completed job with warnings.
- This app does not call external paid APIs.
