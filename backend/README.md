# Backend

The local backend supports a Go API with Rust waveform and harmonic filtering and a Python worker, plus a standalone FastAPI mode. Both modes use the same job storage, inference, and audio analysis.

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

## Project footprint validation

The local checkout fell from 2,243.4 to 2,190.1 MiB on an Apple M5 with 16 GiB of memory. Removing unused Essentia saved 47.2 MiB across the Python environments. The launcher strips debug symbols from the Go release binary, and Cargo now strips symbols from Rust release artifacts. Normal development builds remain available. The Go binary fell from 9.82 to 6.76 MiB, and the combined Rust runtime artifacts fell from 881.5 to 695.9 KiB.

Model caches and existing job data were retained. Browser builds preserved the production CSS byte for byte, and ten screenshots matched at 1440px and 1280px. The 60-, 180-, and 300-second comparisons matched WAV and MIDI bytes, as well as BPM, key, chord data, confidence values, and waveform points.

### Runtime guardrails

These measurements compare the revision immediately before the footprint changes with this revision. Each value is the median of three jobs on the same synthetic MP3, using MLX Standard and real Basic Pitch MIDI.

| Input | First run | Uncached repeat | Cache hit |
| --- | ---: | ---: | ---: |
| 60 s | 7.90 → 7.52 s | 5.30 → 5.03 s | 0.34 → 0.33 s |
| 180 s | 16.25 → 16.27 s | 16.19 → 15.30 s | 0.93 → 0.62 s |
| 300 s | 36.64 → 28.52 s | 32.16 → 26.62 s | 0.95 → 0.96 s |

With prepared binaries, the median time for the launcher to bring both services online went from 2.66 to 2.42 s. The initial 300-second comparison showed higher sampled process-tree peak RSS, from 1.10 to 1.42 GiB. An alternating-order rerun measured 1.33 → 1.36 GiB and 27.02 → 27.39 s. These runs do not establish a processing speedup or a memory improvement for the 300-second workload.

## Hybrid pipeline optimization

This benchmark is from the earlier harmonic filtering, Core ML batching, and MIDI cache changes.

The optional Rust DSP library runs the two 31-sample median filters used in harmonic/percussive separation. Librosa still handles the STFT, mask, inverse transform, and chroma calculation. The worker uses the original librosa filter when the Rust library is unavailable.

Basic Pitch 0.4.0 uses batches of up to eight audio windows when Core ML is selected. It keeps the existing window boundaries and MIDI decoder, and falls back to Basic Pitch's single-window path if batching fails. A job can reuse real MIDI from the same cached stem WAVs when its model and dependency signature and the MIDI checksums match.

### End-to-end benchmark

We ran both revisions on an Apple M5 with 16 GiB of memory using the same 60-, 180-, and 300-second synthetic MP3 inputs, MLX Standard, and real Basic Pitch MIDI (`MUSIC_FAST_UPLOAD=0`). Each value is the median of three measurements from upload to job completion. A first run uses a fresh server and model weights already on disk. The previous job is deleted before the repeat to force inference. The subsequent upload keeps the completed job to measure reuse.

| Input | First run | Uncached repeat | Cache hit |
| --- | ---: | ---: | ---: |
| 60 s | 10.85 → 7.07 s | 7.84 → 4.65 s | 2.30 → 0.27 s |
| 180 s | 21.47 → 15.96 s | 17.81 → 14.89 s | 9.03 → 0.66 s |
| 300 s | 38.93 → 29.85 s | 36.35 → 29.73 s | 18.88 → 0.94 s |

In the 300-second uncached repeat, harmonic filtering fell from 16.31 to 1.59 s, and Basic Pitch inference fell from 6.09 to 2.45 s. MIDI post-processing still took 10.76 s. At 300 seconds, combined CPU time across the three phases fell from 99.93 to 61.16 CPU-seconds. The maximum sampled process-tree RSS median for the repeat rose from 1.49 to 1.55 GiB, and peak MLX allocations remained about 3.50 GiB. The RSS and MLX allocation figures measure different things.

The comparison matched BPM, key, mode, beat and chord timing, chord confidence, and waveform points. All six 24-bit PCM stem WAVs and six MIDI files matched byte for byte across all nine repeat and cache-hit comparisons. The stems were stereo at 44.1 kHz, with 2,646,000, 7,938,000, and 13,230,000 frames per channel for the three input lengths. This test used synthetic audio and did not assess listening quality on commercial music.

## Hybrid release validation

These measurements are from the earlier transition from standalone FastAPI to the hybrid backend.

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

The earlier benchmarks did not cover FFI, listening quality on Suno tracks, full GPU/thermal measurements, Render deployment, or sustained workloads approaching the configured maximum audio length. The Python deployment remains available. FFT and music feature extraction stay in librosa, whose current labels and timing are preserved.
