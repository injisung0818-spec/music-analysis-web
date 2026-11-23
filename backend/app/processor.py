from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import struct
import re
import signal
import sys
from collections import deque
from collections.abc import Awaitable, Callable
from contextlib import suppress
from datetime import datetime, timezone
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from time import perf_counter
from typing import Literal, TypeVar

import soundfile

from .coreml_midi import write_coreml_midi
from .harmonic import harmonic_filter
from .midi_cache import cache_signature, mark_midi, reuse_midi
from .separation import Engine, SeparationPlan

from pydantic import BaseModel


STEMS = ["vocals", "drums", "bass", "guitar", "piano", "other"]
STEM_COLORS = {
    "vocals": "#69caec",
    "drums": "#72d1dc",
    "bass": "#80dce4",
    "guitar": "#97edf2",
    "piano": "#c7fbfd",
    "other": "#e8fbfc",
}
KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
ANALYSIS_SAMPLE_RATE = 22050
CHROMA_HOP_LENGTH = 2048
SeparationQuality = Literal["standard", "high"]
SeparationStatus = Literal["pending", "running", "succeeded", "failed", "unverified"]
QUALITY_OPTIONS = {"standard": (1, "0.25"), "high": (3, "0.50")}
MAX_DURATION = int(os.getenv("MUSIC_MAX_DURATION_SECONDS", "1200"))
DEMUCS_TIMEOUT = int(os.getenv("MUSIC_DEMUCS_TIMEOUT_SECONDS", "3600"))
T = TypeVar("T")


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_flag(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", ""}


class JobState(BaseModel):
    id: str
    status: str
    progress: float
    message: str
    created_at: str
    updated_at: str
    original_filename: str
    source_path: str
    job_dir: str
    warnings: list[str] = []
    error: str | None = None
    separation_quality: SeparationQuality = "standard"
    separation_status: SeparationStatus = "unverified"
    separation_error: str | None = None
    separation_engine: Engine = "torch"
    actual_separation_engine: Engine | None = None
    separation_cache_hit: bool = False
    audio_digest: str | None = None
    separation_cache_key: str | None = None
    music_cache_key: str | None = None
    music_cache_hit: bool = False
    music_analysis: bool = True
    midi: bool = True
    timings: dict[str, float] = {}


class MusicProcessor:
    def __init__(
        self,
        update_job: Callable[[JobState], Awaitable[None]],
        link_cached_stems: Callable[[str, Path], Awaitable[Path | None]] | None = None,
        load_cached_music: Callable[[str], Awaitable[dict | None]] | None = None,
    ) -> None:
        self.update_job = update_job
        self.link_cached_stems = link_cached_stems
        self.load_cached_music = load_cached_music

    async def process(self, state: JobState) -> None:
        job_dir = Path(state.job_dir)
        source = Path(state.source_path)
        music_task = None
        try:
            await self._set(state, "running", 0.03, "오디오 준비 중")
            audio_wav = job_dir / "source.wav"
            stems_dir = job_dir / "stems"
            midi_dir = job_dir / "midi"
            stems_dir.mkdir(exist_ok=True)

            started = perf_counter()
            converted = await self._prepare_audio(source, audio_wav)
            state.timings["decode"] = perf_counter() - started
            digest = state.audio_digest
            if digest and converted != source and (self.link_cached_stems or self.load_cached_music):
                digest = await asyncio.to_thread(file_digest, converted)
            if converted != source:
                remove_upload_source(source)

            state.separation_status = "running"
            await self._set(state, "running", 0.16, "Demucs 및 htdemucs_6s 모델 준비 중")
            stem_paths: dict[str, Path] = {}
            stem_audio = None
            cached_stem_job = None
            music_key = music_cache_key(digest) if state.music_analysis and digest and self.load_cached_music else None
            cached_music = await self.load_cached_music(music_key) if music_key and self.load_cached_music else None
            parallel = os.getenv("MUSIC_PARALLEL_ANALYSIS") == "long" and soundfile.info(converted).duration >= 120
            if state.music_analysis and cached_music is None and (parallel or (
                os.getenv("MUSIC_PARALLEL_ANALYSIS") != "long" and env_flag("MUSIC_PARALLEL_ANALYSIS")
            )):
                music_task = asyncio.create_task(finish_thread_on_cancel(self._analyze_music, converted))
            started = perf_counter()
            try:
                stem_paths, stem_audio, cached_stem_job = await self._separate_stems(converted, stems_dir, state, digest)
            except (RuntimeError, OSError) as exc:
                state.separation_status = "failed"
                state.separation_error = str(exc)
                shutil.rmtree(stems_dir, ignore_errors=True)
                if not state.music_analysis:
                    raise
            else:
                state.separation_status = "succeeded"
            state.timings["separation"] = perf_counter() - started
            message = "템포, 키, 코드 분석 중" if state.music_analysis else "스템 파형 생성 중"
            await self._set(state, "running", 0.55, message)

            if state.music_analysis and music_task is None and cached_music is None:
                music_task = asyncio.create_task(finish_thread_on_cancel(self._analyze_music, converted))
            started = perf_counter()
            waveforms = await self._waveforms(stem_paths, state)
            state.timings["waveforms"] = perf_counter() - started
            if cached_music is not None:
                analysis = cached_music
                state.music_cache_hit = True
                state.music_cache_key = music_key
            elif music_task is not None:
                analysis, timings, warning = await music_task
                state.timings.update(timings)
                if warning:
                    state.warnings.append(warning)
                else:
                    state.music_cache_key = music_key
            else:
                analysis = {"duration": round(soundfile.info(converted).duration, 3),
                            "bpm": 0, "key": "", "mode": "", "beats": [], "chords": []}
            midi_paths = {}
            if stem_paths and state.midi:
                midi_dir.mkdir(exist_ok=True)
                await self._set(state, "running", 0.76, "MIDI 추출 중")
                started = perf_counter()
                midi_paths = await self._extract_midi(stem_paths, midi_dir, state, cached_stem_job)
                state.timings["midi"] = perf_counter() - started
            await self._set(state, "running", 0.92, "결과 저장 중")

            started = perf_counter()
            stem_assets = []
            for stem in STEMS:
                stem_path = stem_paths.get(stem)
                midi_path = midi_paths.get(stem)
                stem_assets.append(
                    {
                        "name": stem,
                        "color": STEM_COLORS[stem],
                        "audio_url": f"/api/jobs/{state.id}/assets/{stem_path.relative_to(job_dir)}" if stem_path else None,
                        "midi_url": f"/api/jobs/{state.id}/assets/{midi_path.relative_to(job_dir)}" if midi_path else None,
                        "waveform": waveforms.get(stem, []),
                    }
                )

            result = {
                "job_id": state.id,
                "original_filename": state.original_filename,
                "duration": analysis["duration"],
                "bpm": analysis["bpm"],
                "key": analysis["key"],
                "mode": analysis["mode"],
                "beats": analysis["beats"],
                "chords": analysis["chords"],
                "stems": stem_assets,
                "stem_audio": stem_audio,
                "separation_quality": state.separation_quality,
                "separation_engine": state.separation_engine,
                "actual_separation_engine": state.actual_separation_engine,
                "separation_cache_hit": state.separation_cache_hit,
                "music_analysis": state.music_analysis,
                "music_cache_hit": state.music_cache_hit,
                "midi_requested": state.midi,
                "separation_status": state.separation_status,
                "separation_error": state.separation_error,
                "warnings": state.warnings,
                "generated_at": now_iso(),
                "timings": state.timings,
            }
            audio_wav.unlink(missing_ok=True)
            remove_upload_source(source)
            temporary = job_dir / "analysis.json.tmp"
            temporary.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
            temporary.replace(job_dir / "analysis.json")
            state.timings["result_write"] = perf_counter() - started
            if stem_paths:
                message = "6개 스템 분리 완료"
            elif state.music_analysis:
                message = "음악 분석 완료 · 스템 분리 실패"
            else:
                message = "스템 분리 실패"
            await self._set(state, "done", 1.0, message)
        except asyncio.CancelledError:
            await stop_analysis(music_task)
            cleanup_failed_artifacts(job_dir, source)
            raise
        except Exception as exc:
            await stop_analysis(music_task)
            cleanup_failed_artifacts(job_dir, source)
            state.error = str(exc)
            if state.separation_status in {"pending", "running", "succeeded"}:
                state.separation_status = "failed"
                state.separation_error = state.error
            await self._set(state, "error", state.progress, "처리 실패")

    async def _set(self, state: JobState, status: str, progress: float, message: str) -> None:
        state.status = status
        state.progress = round(max(0.0, min(progress, 1.0)), 3)
        state.message = message
        await self.update_job(state)

    async def _prepare_audio(self, source: Path, target: Path) -> Path:
        if source.suffix.lower() == ".wav":
            target = source
        else:
            ffmpeg = find_executable("ffmpeg")
            if not ffmpeg:
                raise RuntimeError("MP3 변환에 ffmpeg가 필요합니다.")
            cmd = [
                ffmpeg, "-y", "-nostdin", "-hide_banner", "-loglevel", "error",
                "-i", str(source), "-map", "0:a:0", "-t", str(MAX_DURATION + 1),
                "-c:a", "pcm_s24le", str(target),
            ]
            await self._run_command(cmd, "MP3 변환 실패", timeout=180)
        try:
            info = soundfile.info(target)
        except (RuntimeError, OSError) as exc:
            raise RuntimeError("유효한 WAV 오디오를 읽을 수 없습니다.") from exc
        if info.frames <= 0 or info.samplerate <= 0:
            raise RuntimeError("재생할 오디오 샘플이 없습니다.")
        if info.duration > MAX_DURATION:
            raise RuntimeError(f"지원하는 최대 오디오 길이는 {MAX_DURATION}초입니다.")
        return target

    async def _separate_stems(
        self, audio_wav: Path, stems_dir: Path, state: JobState, input_digest: str | None = None
    ) -> tuple[dict[str, Path], dict[str, int], Path | None]:
        if not env_flag("MUSIC_ENABLE_DEMUCS", True):
            raise RuntimeError("이 서버에서는 Demucs 스템 분리가 비활성화되어 있습니다.")
        requested = state.separation_engine
        try:
            plan = SeparationPlan.build(requested)
        except RuntimeError as exc:
            if requested == "torch":
                raise
            reason = str(exc)
        else:
            try:
                return await self._run_separation(plan, audio_wav, stems_dir, state, input_digest)
            except (RuntimeError, OSError) as exc:
                if not plan.accelerated:
                    raise
                reason = f"{plan.device} · {exc}"

        state.warnings.append(f"가속 분리 실패. 동일한 품질 설정으로 PyTorch CPU 재시도 · {reason}")
        await self._set(state, "running", 0.16, "PyTorch CPU에서 스템 분리 재시도 중")
        try:
            plan = SeparationPlan.build("torch", cpu_retry=True)
            return await self._run_separation(plan, audio_wav, stems_dir, state, input_digest)
        except (RuntimeError, OSError) as exc:
            raise RuntimeError(f"가속 분리 실패 · {reason} / PyTorch CPU 재시도 실패 · {exc}") from exc

    async def _run_separation(
        self, plan: SeparationPlan, audio_wav: Path, stems_dir: Path, state: JobState, input_digest: str | None
    ) -> tuple[dict[str, Path], dict[str, int], Path | None]:
        if plan.engine != "mlx" and not demucs_installed():
            raise RuntimeError("이 서버의 Python 환경에 Demucs가 없습니다. start.command 또는 requirements-optional.txt로 설치하세요.")

        out_dir = stems_dir / "_demucs"
        shutil.rmtree(out_dir, ignore_errors=True)
        shifts, overlap = QUALITY_OPTIONS[state.separation_quality]

        async def cache_key() -> str | None:
            if not input_digest:
                return None
            return await asyncio.to_thread(plan.cache_key, input_digest, shifts, overlap)

        key = await cache_key()
        cached_job = await self.link_cached_stems(key, out_dir) if key and self.link_cached_stems else None
        if cached_job is not None:
            cached_paths = {name: out_dir / f"{name}.wav" for name in STEMS}
            try:
                metadata = await finish_thread_on_cancel(validate_stem_wavs, cached_paths, audio_wav)
            except (RuntimeError, OSError):
                shutil.rmtree(out_dir, ignore_errors=True)
            else:
                published = publish_stem_wavs(cached_paths, out_dir, stems_dir)
                state.separation_cache_hit = True
                state.separation_cache_key = key
                state.actual_separation_engine = plan.engine
                await self._set(state, "running", 0.52, "저장된 6개 스템 재사용")
                return published, metadata, cached_job

        cmd, model_dir, env = plan.command(audio_wav, out_dir, shifts, overlap)
        inference_start = None
        launch = perf_counter()
        started = False
        completed_passes = 0
        previous_percent = 0

        async def report(line: str) -> None:
            nonlocal started, completed_passes, previous_percent, inference_start
            if line.startswith("Separating track"):
                started = True
                inference_start = perf_counter()
                state.timings["model_startup"] = inference_start - launch
                await self._set(state, "running", 0.18, "htdemucs_6s 스템 분리 중")
            elif line == "Writing stems":
                if inference_start is not None:
                    state.timings["inference"] = perf_counter() - inference_start
                await self._set(state, "running", 0.51, "스템 WAV 저장 중")
            elif started and (match := re.search(r"(\d+)%\|", line)):
                percent = int(match[1])
                if percent < previous_percent:
                    completed_passes += 1
                previous_percent = percent
                fraction = (completed_passes + percent / 100) / shifts
                progress = min(0.51, 0.18 + 0.33 * fraction)
                if progress - state.progress >= 0.02:
                    await self._set(state, "running", progress, "htdemucs_6s 스템 분리 중")

        try:
            await self._run_command(cmd, "Demucs 실행 실패", DEMUCS_TIMEOUT, report, env=env)
        except (RuntimeError, OSError) as exc:
            stage = "스템 처리" if started else "Demucs 시작 또는 htdemucs_6s 모델 로드"
            raise RuntimeError(f"{stage} 실패 · {exc}") from exc

        await self._set(state, "running", 0.52, "6개 스템 WAV 검증 중")
        paths = {name: model_dir / f"{name}.wav" for name in STEMS}
        metadata = await finish_thread_on_cancel(validate_stem_wavs, paths, audio_wav)
        state.actual_separation_engine = plan.engine
        state.separation_cache_key = await cache_key()
        return publish_stem_wavs(paths, out_dir, stems_dir), metadata, None

    async def _run_command(
        self,
        cmd: list[str],
        error_message: str,
        timeout: int,
        report: Callable[[str], Awaitable[None]] | None = None,
        *,
        env: dict[str, str] | None = None,
    ) -> None:
        process = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            start_new_session=True, env=env,
        )
        assert process.stdout is not None
        details: deque[str] = deque(maxlen=6)
        pending = ""
        try:
            async with asyncio.timeout(timeout):
                while chunk := await process.stdout.read(4096):
                    lines = re.split(r"[\r\n]", pending + chunk.decode("utf-8", errors="replace"))
                    pending = lines.pop()[-4096:]
                    for line in lines:
                        if report:
                            await report(line)
                        if line.strip() and not re.search(r"\d+%\|", line):
                            details.append(line.strip())
                if pending.strip():
                    details.append(pending.strip())
                await process.wait()
        except TimeoutError as exc:
            raise RuntimeError(f"{error_message} · {timeout}초 실행 시간 제한을 초과했습니다.") from exc
        finally:
            if process.returncode is None:
                try:
                    os.killpg(process.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
                await process.wait()

        if process.returncode:
            detail = "\n".join(details)[-1200:] or f"종료 코드 {process.returncode}"
            raise RuntimeError(f"{error_message} · {detail}")

    async def _waveforms(self, paths: dict[str, Path], state: JobState) -> dict:
        binary = os.getenv("MUSIC_RUST_DSP")
        if binary and paths:
            try:
                # The child sees only paths. Its stdout is bounded by six 2400-point envelopes.
                process = await asyncio.create_subprocess_exec(
                    binary, *(str(path) for path in paths.values()),
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                )
                try:
                    stdout, stderr = await asyncio.wait_for(process.communicate(), timeout=60)
                finally:
                    if process.returncode is None:
                        with suppress(ProcessLookupError):
                            process.kill()
                        await process.wait()
                if process.returncode:
                    raise RuntimeError(stderr.decode(errors="replace").strip()[:300])
                envelopes = json.loads(stdout)
                if len(envelopes) != len(paths) or any(not 0 < len(peaks) <= 2400 for peaks in envelopes):
                    raise ValueError("잘못된 파형 길이")
                return {stem: [round(peak, 4) for peak in peaks] for stem, peaks in zip(paths, envelopes)}
            except (OSError, RuntimeError, ValueError, TimeoutError) as exc:
                state.warnings.append(f"Rust 파형 처리 실패 · Python으로 재시도 · {exc}")
        return await finish_thread_on_cancel(lambda: {stem: waveform_peaks(path) for stem, path in paths.items()})

    def _analyze_music(self, audio_wav: Path) -> tuple[dict, dict, str | None]:
        timings = {}
        started = perf_counter()
        try:
            import librosa
            import numpy as np

            y, sr = librosa.load(audio_wav, sr=ANALYSIS_SAMPLE_RATE, mono=True)
            duration = float(librosa.get_duration(y=y, sr=sr))
            timings["analysis_decode"] = perf_counter() - started
            started = perf_counter()
            tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
            tempo_value = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else 120.0
            beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
            timings["bpm"] = perf_counter() - started
            started = perf_counter()
            try:
                harmonic = harmonic_filter(librosa, y, os.getenv("MUSIC_RUST_DSP"))
                chroma = librosa.feature.chroma_cqt(
                    y=harmonic,
                    sr=sr,
                    hop_length=CHROMA_HOP_LENGTH,
                    bins_per_octave=36,
                )
            except Exception:
                chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=CHROMA_HOP_LENGTH, n_fft=4096)
            chroma = normalize_chroma(chroma)
            timings["chroma"] = perf_counter() - started
            started = perf_counter()
            key, mode = estimate_key(chroma)
            timings["key"] = perf_counter() - started
            started = perf_counter()
            chords = estimate_chords(chroma, sr, librosa, duration, CHROMA_HOP_LENGTH, beat_times)
            timings["chords"] = perf_counter() - started
            return {
                "duration": round(duration, 3),
                "bpm": round(tempo_value, 2),
                "key": key,
                "mode": mode,
                "beats": [{"time": round(float(t), 3), "index": i + 1} for i, t in enumerate(beat_times[:500])],
                "chords": chords,
            }, timings, None
        except Exception as exc:
            warning = f"librosa가 설치되어 있지 않거나 분석에 실패해 임시 BPM/key/chord 분석 결과를 생성했습니다. 상세: {exc}"
            duration = soundfile.info(audio_wav).duration
            bpm = 120.0
            beat_step = 60.0 / bpm
            beats = [{"time": round(i * beat_step, 3), "index": i + 1} for i in range(int(duration / beat_step))]
            chords = mock_chords(duration)
            return {
                "duration": round(duration, 3),
                "bpm": bpm,
                "key": "C",
                "mode": "major",
                "beats": beats,
                "chords": chords,
            }, timings, warning

    async def _extract_midi(
        self, stem_paths: dict[str, Path], midi_dir: Path, state: JobState, cached_job: Path | None,
    ) -> dict[str, Path]:
        if env_flag("MUSIC_FAST_UPLOAD", True):
            state.warnings.append("빠른 업로드 모드로 basic-pitch MIDI 추출을 건너뛰고 placeholder MIDI 파일을 생성했습니다.")
            return write_placeholder_midis(midi_dir)

        signature = await finish_thread_on_cancel(cache_signature) if state.separation_cache_key else None
        if cached_job is not None and signature:
            reused = await finish_thread_on_cancel(
                reuse_midi, cached_job / "midi", midi_dir, tuple(stem_paths), signature,
            )
            if reused:
                await finish_thread_on_cancel(mark_midi, midi_dir, reused, signature)
                return reused

        try:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import Model, predict_and_save

            model = await finish_thread_on_cancel(Model, ICASSP_2022_MODEL_PATH)
            use_coreml_batch = False
            if model.model_type == Model.MODEL_TYPES.COREML:
                with suppress(PackageNotFoundError):
                    use_coreml_batch = version("basic-pitch") == "0.4.0"
            midi_paths = {}
            all_generated = True
            for stem, path in stem_paths.items():
                target = midi_dir / f"{stem}.mid"
                generated = midi_dir / f"{path.stem}_basic_pitch.mid"
                if use_coreml_batch:
                    try:
                        await finish_thread_on_cancel(write_coreml_midi, path, generated, model)
                    except Exception:
                        # Retry this stem and subsequent stems via Basic Pitch's supported single-window path.
                        use_coreml_batch = False
                        generated.unlink(missing_ok=True)
                    else:
                        generated.replace(target)
                        midi_paths[stem] = target
                        continue
                await finish_thread_on_cancel(
                    predict_and_save,
                    [str(path)],
                    str(midi_dir),
                    True,
                    False,
                    False,
                    False,
                    model,
                )
                if generated.exists():
                    generated.replace(target)
                else:
                    all_generated = False
                    write_minimal_midi(target, stem)
                midi_paths[stem] = target
            if signature and all_generated:
                await finish_thread_on_cancel(mark_midi, midi_dir, midi_paths, signature)
            return midi_paths
        except Exception as exc:
            state.warnings.append(f"basic-pitch가 설치되어 있지 않거나 MIDI 추출에 실패해 placeholder MIDI 파일을 생성했습니다. 상세: {exc}")
            return write_placeholder_midis(midi_dir)


async def stop_analysis(task: asyncio.Task | None) -> None:
    if task is not None:
        if not task.done():
            task.cancel()
        with suppress(asyncio.CancelledError, Exception):
            await task


def music_cache_key(digest: str) -> str | None:
    try:
        versions = tuple(version(name) for name in ("librosa", "numpy", "scipy", "soxr", "soundfile"))
    except PackageNotFoundError:
        return None
    return hashlib.sha256(json.dumps(("music-analysis-v1", digest, versions)).encode()).hexdigest()


def read_cached_music(path: Path) -> dict | None:
    try:
        analysis = json.loads((path / "analysis.json").read_text())
        fields = ("duration", "bpm", "key", "mode", "beats", "chords")
        return {field: analysis[field] for field in fields}
    except (OSError, ValueError, KeyError, TypeError):
        return None


def file_digest(path: Path) -> str:
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def publish_stem_wavs(paths: dict[str, Path], staging: Path, destination: Path) -> dict[str, Path]:
    published = {name: path.replace(destination / path.name) for name, path in paths.items()}
    shutil.rmtree(staging, ignore_errors=True)
    return published


async def finish_thread_on_cancel(function: Callable[..., T], *args) -> T:
    # Threads cannot be cancelled safely while reading or writing job files.
    task = asyncio.create_task(asyncio.to_thread(function, *args))
    try:
        return await asyncio.shield(task)
    except asyncio.CancelledError:
        with suppress(Exception):
            await task
        raise


def demucs_installed() -> bool:
    from importlib.util import find_spec

    return find_spec("demucs") is not None


def find_executable(name: str) -> str | None:
    from_path = shutil.which(name)
    if from_path:
        return from_path
    venv_bin = Path(sys.executable).parent / name
    if venv_bin.is_file() and os.access(venv_bin, os.X_OK):
        return str(venv_bin)
    return None


def validate_stem_wavs(paths: dict[str, Path], source: Path) -> dict[str, int]:
    source_duration = soundfile.info(source).duration
    expected = None
    for name, path in paths.items():
        if not path.is_file():
            raise RuntimeError(f"Demucs가 {name}.wav 파일을 생성하지 않았습니다.")
        try:
            with soundfile.SoundFile(path) as audio:
                metadata = (audio.frames, audio.samplerate, audio.channels)
                valid_format = audio.format in {"WAV", "WAVEX"} and audio.subtype == "PCM_24"
                if not valid_format or audio.frames <= 0 or audio.channels not in {1, 2}:
                    raise RuntimeError("비어 있거나 지원하지 않는 PCM WAV입니다.")
                if abs(audio.frames / audio.samplerate - source_duration) > 0.01:
                    raise RuntimeError("원본과 재생 길이가 일치하지 않습니다.")
                audio.seek(audio.frames - 1)
                if len(audio.buffer_read(1, dtype="int32")) != audio.channels * 4:
                    raise RuntimeError("마지막 오디오 프레임을 읽을 수 없습니다.")
        except (RuntimeError, OSError) as exc:
            raise RuntimeError(f"Demucs 결과 {name}.wav 검증 실패 · {exc}") from exc
        if expected is not None and metadata != expected:
            raise RuntimeError(f"{name}.wav의 프레임 수, 샘플레이트 또는 채널이 다른 스템과 다릅니다.")
        expected = metadata
    assert expected is not None
    frames, sample_rate, channels = expected
    return {"frames": frames, "sample_rate": sample_rate, "channels": channels, "bit_depth": 24}


def waveform_peaks(path: Path, points: int = 2400) -> list[float]:
    import numpy as np

    with soundfile.SoundFile(path) as audio:
        bucket_size = (audio.frames + points - 1) // points
        peaks = []
        while len(samples := audio.read(bucket_size * 32, dtype="float32", always_2d=True)):
            envelope = np.abs(samples).mean(axis=1)
            starts = np.arange(0, len(envelope), bucket_size)
            peaks.extend(round(float(peak), 4) for peak in np.maximum.reduceat(envelope, starts))
    return peaks


def estimate_key(chroma) -> tuple[str, str]:
    import numpy as np

    profile = np.mean(chroma, axis=1)
    scores: list[tuple[float, str, str]] = []
    for i, name in enumerate(KEY_NAMES):
        scores.append((float(np.corrcoef(profile, np.roll(MAJOR_PROFILE, i))[0, 1]), name, "major"))
        scores.append((float(np.corrcoef(profile, np.roll(MINOR_PROFILE, i))[0, 1]), name, "minor"))
    _, key, mode = max(scores, key=lambda item: item[0])
    return key, mode


def normalize_chroma(chroma):
    import numpy as np

    chroma = np.asarray(chroma, dtype=float)
    column_max = np.max(chroma, axis=0, keepdims=True)
    return chroma / np.maximum(column_max, 1e-9)


def estimate_chords(chroma, sr: int, librosa, duration: float, hop_length: int, beat_times: list[float] | None = None) -> list[dict]:
    import numpy as np

    frames = chroma.shape[1]
    if frames == 0:
        return []
    times = librosa.frames_to_time(np.arange(frames), sr=sr, hop_length=hop_length)
    boundaries = chord_boundaries(duration, beat_times)
    chords = []
    for start_time, end_time in zip(boundaries, boundaries[1:]):
        start = int(np.searchsorted(times, start_time, side="left"))
        end = int(np.searchsorted(times, end_time, side="right"))
        segment = np.mean(chroma[:, start:max(start + 1, end)], axis=1)
        label, confidence = estimate_chord_label(segment)
        chords.append(
            {
                "start": round(min(float(duration), start_time), 3),
                "end": round(max(start_time, end_time), 3),
                "label": label,
                "confidence": round(confidence, 3),
            }
        )
    return normalize_chords(merge_adjacent_chords(smooth_chords(chords)), duration)


def chord_boundaries(duration: float, beat_times: list[float] | None) -> list[float]:
    if duration <= 0:
        return [0.0]
    beats = sorted({round(float(t), 3) for t in beat_times or [] if 0 < float(t) < duration})
    if len(beats) >= 4:
        return [0.0, *beats, round(duration, 3)]

    step = 1.0
    boundaries = [0.0]
    current = step
    while current < duration:
        boundaries.append(round(current, 3))
        current += step
    boundaries.append(round(duration, 3))
    return boundaries


@lru_cache(maxsize=1)
def chord_templates() -> list[tuple[str, object, float]]:
    import numpy as np

    templates = {
        "": [1, 0, 0, 0, 0.82, 0, 0, 0.9, 0, 0, 0, 0],
        "m": [1, 0, 0, 0.82, 0, 0, 0, 0.9, 0, 0, 0, 0],
        "7": [1, 0, 0, 0, 0.78, 0, 0, 0.84, 0, 0, 0.62, 0],
        "m7": [1, 0, 0, 0.78, 0, 0, 0, 0.84, 0, 0, 0.62, 0],
        "maj7": [1, 0, 0, 0, 0.78, 0, 0, 0.84, 0, 0, 0, 0.62],
        "sus4": [1, 0, 0, 0, 0, 0.72, 0, 0.84, 0, 0, 0, 0],
        "dim": [1, 0, 0, 0.76, 0, 0, 0.72, 0, 0, 0, 0, 0],
    }
    result = []
    extension_penalty = {"7": 0.07, "m7": 0.07, "maj7": 0.07, "sus4": 0.035, "dim": 0.035}
    for i, name in enumerate(KEY_NAMES):
        for suffix, template in templates.items():
            template_vector = np.roll(np.array(template, dtype=float), i)
            template_vector = template_vector / np.linalg.norm(template_vector)
            label = f"{name}{suffix}"
            result.append((label, template_vector, extension_penalty.get(suffix, 0.0)))
    return result


def estimate_chord_label(chroma_vector) -> tuple[str, float]:
    import numpy as np

    vector = np.asarray(chroma_vector, dtype=float)
    norm = np.linalg.norm(vector)
    if norm <= 1e-9:
        return "N", 0.0
    vector = vector / norm
    best = (-1.0, "N")
    for label, template, penalty in chord_templates():
        score = float(np.dot(vector, template)) - penalty
        best = max(best, (score, label), key=lambda item: item[0])
    confidence = min(1.0, max(0.0, best[0]))
    if confidence < 0.5:
        return "N", confidence
    return best[1], confidence


def smooth_chords(chords: list[dict]) -> list[dict]:
    if len(chords) < 3:
        return chords
    smoothed = [dict(chord) for chord in chords]
    for index in range(1, len(chords) - 1):
        previous_label = smoothed[index - 1]["label"]
        next_label = chords[index + 1]["label"]
        current = smoothed[index]
        duration = float(current["end"]) - float(current["start"])
        if previous_label == next_label and current["label"] != previous_label and (duration < 0.9 or current["confidence"] < 0.62):
            current["label"] = previous_label
            current["confidence"] = round((current["confidence"] + smoothed[index - 1]["confidence"]) / 2, 3)
    return smoothed


def merge_adjacent_chords(chords: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for chord in chords:
        if merged and merged[-1]["label"] == chord["label"]:
            merged[-1]["end"] = chord["end"]
            merged[-1]["confidence"] = round((merged[-1]["confidence"] + chord["confidence"]) / 2, 3)
        else:
            merged.append(chord)
    return merged[:120]


def normalize_chords(chords: list[dict], duration: float) -> list[dict]:
    if duration <= 0:
        return chords
    if not chords:
        return [{"start": 0.0, "end": round(duration, 3), "label": "N", "confidence": 0.0}]

    normalized: list[dict] = []
    previous_end = 0.0
    for chord in chords:
        start = max(0.0, min(float(chord["start"]), duration))
        end = max(start, min(float(chord["end"]), duration))
        if normalized and start > previous_end:
            normalized[-1]["end"] = round(start, 3)
        normalized.append({**chord, "start": round(start, 3), "end": round(end, 3)})
        previous_end = end

    normalized[0]["start"] = 0.0
    normalized[-1]["end"] = round(duration, 3)
    return normalized


def mock_chords(duration: float) -> list[dict]:
    progression = ["C", "G", "Am", "F"]
    chords = []
    step = 4.0
    t = 0.0
    i = 0
    while t < duration:
        chords.append({"start": round(t, 3), "end": round(min(duration, t + step), 3), "label": progression[i % 4], "confidence": 0.5})
        t += step
        i += 1
    return chords


def write_minimal_midi(path: Path, track_name: str) -> None:
    name = track_name.encode("ascii", errors="ignore")[:40]
    events = bytearray()
    events.extend(b"\x00\xff\x03")
    events.extend(write_var_len(len(name)))
    events.extend(name)
    events.extend(b"\x00\xc0\x00")
    events.extend(b"\x00\x90\x3c\x40")
    events.extend(write_var_len(480))
    events.extend(b"\x80\x3c\x00")
    events.extend(b"\x00\xff\x2f\x00")
    header = b"MThd" + struct.pack(">IHHH", 6, 0, 1, 480)
    track = b"MTrk" + struct.pack(">I", len(events)) + bytes(events)
    path.write_bytes(header + track)


def write_placeholder_midis(midi_dir: Path) -> dict[str, Path]:
    midi_paths = {}
    for stem in STEMS:
        target = midi_dir / f"{stem}.mid"
        write_minimal_midi(target, stem)
        midi_paths[stem] = target
    return midi_paths


def remove_upload_source(source: Path) -> None:
    source.unlink(missing_ok=True)
    if source.parent.exists() and not any(source.parent.iterdir()):
        source.parent.rmdir()


def cleanup_failed_artifacts(job_dir: Path, source: Path) -> None:
    remove_upload_source(source)
    if (job_dir / "analysis.json").exists():
        (job_dir / "source.wav").unlink(missing_ok=True)
        return

    (job_dir / "source.wav").unlink(missing_ok=True)
    (job_dir / "analysis.json.tmp").unlink(missing_ok=True)
    shutil.rmtree(job_dir / "stems", ignore_errors=True)
    shutil.rmtree(job_dir / "midi", ignore_errors=True)


def write_var_len(value: int) -> bytes:
    buffer = value & 0x7F
    value >>= 7
    while value:
        buffer <<= 8
        buffer |= ((value & 0x7F) | 0x80)
        value >>= 7
    output = bytearray()
    while True:
        output.append(buffer & 0xFF)
        if buffer & 0x80:
            buffer >>= 8
        else:
            break
    return bytes(output)
