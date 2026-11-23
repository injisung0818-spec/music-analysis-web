# Backend

The local backend supports a Go API with Rust waveform processing and a Python worker, plus a standalone FastAPI mode. Both modes use the same job storage, inference, and audio analysis.

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

## Hybrid release validation

The public Go service is in [go](go), the path-based waveform executable is in [rust](rust), and the private Unix-socket Python service is in [app/hybrid_worker.py](app/hybrid_worker.py). See the [project README](../README.md#하이브리드-백엔드-실행) for the launcher and cancellation endpoint.

The measured host was an Apple M5 with 16 GiB memory running arm64 binaries (Go 1.26.5 and Rust 1.100). The inputs were identical 60-second and 180-second synthetic MP3s in all three configurations. They used MLX Standard and actual Basic Pitch MIDI (`MUSIC_FAST_UPLOAD=0`). Model files were already on disk. Timings cover upload through terminal job status, including polling with a 75 ms interval. For each length the first job was deleted before the second upload to force fresh separation. The third upload kept the second job to test reuse.

| Input | Phase | A · Original FastAPI + MLX | B · FastAPI + Rust + MLX | C · Go + Rust + Python/MLX |
| --- | --- | ---: | ---: | ---: |
| 60 sec | First | 11.20 s | 11.14 s | 11.36 s |
| 60 sec | Repeat, uncached | 8.97 s | 6.96 s | 6.79 s |
| 60 sec | Cache hit | 4.42 s | 2.15 s | 2.32 s |
| 180 sec | First for that length | 23.05 s | 16.54 s | 16.51 s |
| 180 sec | Repeat, uncached | 23.94 s | 16.43 s | 16.84 s |
| 180 sec | Cache hit | 16.85 s | 9.55 s | 8.88 s |

| C repeat stage | 60 sec | 180 sec |
| --- | ---: | ---: |
| MP3 decode | 0.058 s | 0.118 s |
| Model and child process startup | 0.132 s | 0.155 s |
| MLX separation before writing WAVs | 2.710 s | 6.732 s |
| Complete stem stage | 3.066 s | 7.483 s |
| Waveforms | 0.135 s | 0.392 s |
| Tempo and beat tracking | 0.039 s | 0.104 s |
| Harmonic filtering and chroma | 1.556 s | 5.542 s |
| Key scoring | <0.001 s | 0.001 s |
| Chord scoring and timeline | 0.004 s | 0.014 s |
| Basic Pitch MIDI | 1.951 s | 8.814 s |
| Instrumental WAV request | 0.134 s | 0.295 s |

The 180-second music-analysis and separation stages overlap. The per-stage timings use elapsed wall time and therefore overlap too. The model-startup timing includes starting the Python child. MLX checkpoints stay on disk between tasks, with one inference subprocess per uncached separation. Basic Pitch loads its model once per job and uses it for all six stems.

- Standalone waveform calculation over six files took 0.185 s in Python and 0.125 s in Rust for 60 seconds, then 0.525 s and 0.363 s for 180 seconds. Each result is a median of five runs and includes starting the Rust executable and decoding its JSON. Every peak after the existing Python rounding matched.
- The two runs retained identical BPM, key, mode, chord intervals and confidences, and stereo 44.1 kHz 24-bit stem metadata across A, B and C. Stem file length was 2,646,000 and 7,938,000 frames per channel, respectively. Integration verified byte-identical WAV packaging and sample-identical FLAC conversion on a short fixture.
- The median of three warm, loopback runs with 16 concurrent native HTTP clients was 16,828 completed status requests per second for FastAPI and 68,879 for Go, with zero failed requests. Building and downloading a six-stem 60-second WAV ZIP took 2.90 s in FastAPI and 1.45 s in Go. Both archives were about 65 MB.
- The peak sum of sampled RSS across each service process tree was 1,087 MiB for A, 966 MiB for B, and 936 MiB for C. Host CPU time (user + system) over the six jobs, requests, and server lifetime was 74.73 s, 64.29 s, and 63.99 s, respectively. The RSS sample does not account for all Metal allocations.
- The new configuration keeps short jobs sequential and overlaps the independent original-audio analysis for jobs of at least 120 seconds. A pilot that also overlapped the short track was slower. The cutoff is conservative and based on the two tested lengths.

FFI, real Suno listening quality, full GPU/thermal measurements, Render deployment, and sustained workloads approaching the configured maximum audio length were outside these measurements. The Python deployment remains available. FFT and music feature extraction stay in librosa, whose current labels and timing are preserved.
