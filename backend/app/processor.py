from __future__ import annotations

import asyncio
import json
import math
import os
import shutil
import struct
import subprocess
import sys
import wave
from collections.abc import Awaitable, Callable
from datetime import datetime, timezone
from pathlib import Path

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
SILENT_PEAK_THRESHOLD = 0.003
SILENT_RMS_THRESHOLD = 0.0001


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


class MusicProcessor:
    def __init__(self, update_job: Callable[[JobState], Awaitable[None]]) -> None:
        self.update_job = update_job

    async def process(self, state: JobState) -> None:
        try:
            await self._set(state, "running", 0.03, "오디오 준비 중")
            job_dir = Path(state.job_dir)
            source = Path(state.source_path)
            audio_wav = job_dir / "source.wav"
            stems_dir = job_dir / "stems"
            midi_dir = job_dir / "midi"
            stems_dir.mkdir(exist_ok=True)
            midi_dir.mkdir(exist_ok=True)

            converted = await self._convert_to_wav(source, audio_wav, state)
            remove_upload_source(source)
            await self._set(state, "running", 0.16, "스템 분리 중")

            stem_paths = await self._separate_stems(converted, stems_dir, state)
            await self._set(state, "running", 0.55, "템포, 키, 코드 분석 중")

            analysis = await asyncio.to_thread(self._analyze_audio, converted, stem_paths, state)
            await self._set(state, "running", 0.76, "MIDI 추출 중")

            midi_paths = await self._extract_midi(stem_paths, midi_dir, state)
            await self._set(state, "running", 0.86, "오디오 무손실 저장 중")

            asset_stem_paths, stored_silent_stems = await self._store_lossless_stems(stem_paths, state)
            silent_stems = {stem for stem in STEMS if stem not in asset_stem_paths}
            silent_stems.update(stored_silent_stems)
            await self._set(state, "running", 0.92, "결과 저장 중")

            stem_assets = []
            for stem in STEMS:
                stem_path = asset_stem_paths.get(stem)
                midi_path = midi_paths.get(stem)
                stem_asset = {
                    "name": stem,
                    "color": STEM_COLORS[stem],
                    "audio_url": f"/api/jobs/{state.id}/assets/{stem_path.relative_to(job_dir)}" if stem_path else None,
                    "midi_url": f"/api/jobs/{state.id}/assets/{midi_path.relative_to(job_dir)}" if midi_path else None,
                    "waveform": analysis["waveforms"].get(stem, []),
                    "silent": stem in silent_stems,
                }
                if stem in silent_stems:
                    stem_asset["skipped_reason"] = "silent"
                stem_assets.append(stem_asset)

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
                "warnings": state.warnings,
                "generated_at": now_iso(),
            }
            (job_dir / "analysis.json").write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
            cleanup_intermediates(source, converted, stems_dir)
            await self._set(state, "done", 1.0, "분석 완료")
        except Exception as exc:
            state.error = str(exc)
            await self._set(state, "error", state.progress, "처리 실패")

    async def _set(self, state: JobState, status: str, progress: float, message: str) -> None:
        state.status = status
        state.progress = round(max(0.0, min(progress, 1.0)), 3)
        state.message = message
        await self.update_job(state)

    async def _convert_to_wav(self, source: Path, target: Path, state: JobState) -> Path:
        if source.suffix.lower() == ".wav":
            shutil.copyfile(source, target)
            state.warnings.append("WAV 파일이라 ffmpeg 재변환을 건너뛰고 바로 분석했습니다.")
            return target

        ffmpeg = find_executable("ffmpeg")
        if ffmpeg:
            cmd = [
                ffmpeg,
                "-y",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(source),
                "-ac",
                "2",
                "-ar",
                "44100",
                str(target),
            ]
            await asyncio.to_thread(self._run_command, cmd, "ffmpeg 변환 실패")
            return target

        if source.suffix.lower() == ".wav":
            shutil.copyfile(source, target)
            state.warnings.append("ffmpeg가 설치되어 있지 않아 WAV 파일을 변환 없이 복사했습니다.")
            return target

        state.warnings.append("ffmpeg가 설치되어 있지 않아 MP3 변환을 건너뛰고 테스트용 무음 오디오를 생성했습니다.")
        await asyncio.to_thread(write_silent_wav, target, 30.0)
        return target

    async def _separate_stems(self, audio_wav: Path, stems_dir: Path, state: JobState) -> dict[str, Path]:
        demucs = find_executable("demucs")
        if demucs:
            out_dir = stems_dir / "_demucs"
            cmd = [demucs, "-n", "htdemucs_6s", "--out", str(out_dir), str(audio_wav)]
            try:
                await asyncio.to_thread(self._run_command, cmd, "Demucs 스템 분리 실패")
                model_dir = out_dir / "htdemucs_6s" / audio_wav.stem
                paths = {}
                found_outputs = 0
                for stem in STEMS:
                    src = model_dir / f"{stem}.wav"
                    dst = stems_dir / f"{stem}.wav"
                    if src.exists():
                        found_outputs += 1
                        if is_silent_audio(src):
                            state.warnings.append(f"{stem} stem이 거의 무음이라 파일 저장을 생략했습니다.")
                            continue
                        shutil.copyfile(src, dst)
                        paths[stem] = dst
                if found_outputs == len(STEMS):
                    shutil.rmtree(out_dir, ignore_errors=True)
                    return paths
                state.warnings.append("Demucs가 완료됐지만 6개 stem이 모두 생성되지 않아 fallback stems를 생성했습니다.")
            except Exception as exc:
                state.warnings.append(f"Demucs 실행에 실패해 fallback stems를 생성했습니다. 상세: {exc}")
            shutil.rmtree(out_dir, ignore_errors=True)
        else:
            state.warnings.append("demucs 명령을 찾을 수 없어 실제 스템 분리 대신 fallback stems를 생성했습니다.")

        paths = {}
        if is_silent_audio(audio_wav):
            state.warnings.append("fallback 입력 오디오가 무음이라 other stem 파일 저장도 생략했습니다.")
        else:
            other_path = stems_dir / "other.wav"
            shutil.copyfile(audio_wav, other_path)
            paths["other"] = other_path
        state.warnings.append("저장 용량을 줄이기 위해 fallback 무음 stem 파일 생성을 생략했습니다.")
        return paths

    def _analyze_audio(self, audio_wav: Path, stem_paths: dict[str, Path], state: JobState) -> dict:
        try:
            import librosa
            import numpy as np

            y, sr = librosa.load(audio_wav, sr=ANALYSIS_SAMPLE_RATE, mono=True)
            duration = float(librosa.get_duration(y=y, sr=sr))
            tempo, beat_frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
            tempo_value = float(np.asarray(tempo).reshape(-1)[0]) if np.asarray(tempo).size else 120.0
            beat_times = librosa.frames_to_time(beat_frames, sr=sr).tolist()
            chroma = librosa.feature.chroma_stft(y=y, sr=sr, hop_length=2048, n_fft=4096)
            key, mode = estimate_key(chroma)
            chords = estimate_chords(chroma, sr, librosa)
            mix_waveform = waveform_peaks(audio_wav)
            waveforms = {
                stem: stem_waveform(stem, path, mix_waveform) if (path := stem_paths.get(stem)) else shaped_mix_waveform(stem, mix_waveform)
                for stem in STEMS
            }
            return {
                "duration": round(duration, 3),
                "bpm": round(tempo_value, 2),
                "key": key,
                "mode": mode,
                "beats": [{"time": round(float(t), 3), "index": i + 1} for i, t in enumerate(beat_times[:500])],
                "chords": chords,
                "waveforms": waveforms,
            }
        except Exception as exc:
            state.warnings.append(f"librosa가 설치되어 있지 않거나 분석에 실패해 임시 BPM/key/chord 분석 결과를 생성했습니다. 상세: {exc}")
            duration = get_wav_duration(audio_wav) or 30.0
            bpm = 120.0
            beat_step = 60.0 / bpm
            beats = [{"time": round(i * beat_step, 3), "index": i + 1} for i in range(int(duration / beat_step))]
            chords = mock_chords(duration)
            mix_waveform = waveform_peaks(audio_wav)
            waveforms = {
                stem: stem_waveform(stem, path, mix_waveform) if (path := stem_paths.get(stem)) else shaped_mix_waveform(stem, mix_waveform)
                for stem in STEMS
            }
            return {
                "duration": round(duration, 3),
                "bpm": bpm,
                "key": "C",
                "mode": "major",
                "beats": beats,
                "chords": chords,
                "waveforms": waveforms,
            }

    async def _extract_midi(self, stem_paths: dict[str, Path], midi_dir: Path, state: JobState) -> dict[str, Path]:
        if env_flag("MUSIC_FAST_UPLOAD", True):
            state.warnings.append("빠른 업로드 모드로 basic-pitch MIDI 추출을 건너뛰고 placeholder MIDI 파일을 생성했습니다.")
            return write_placeholder_midis(midi_dir)

        try:
            from basic_pitch import ICASSP_2022_MODEL_PATH
            from basic_pitch.inference import predict_and_save

            midi_paths = {}
            for stem, path in stem_paths.items():
                await asyncio.to_thread(
                    predict_and_save,
                    [str(path)],
                    str(midi_dir),
                    True,
                    False,
                    False,
                    False,
                    ICASSP_2022_MODEL_PATH,
                )
                generated = midi_dir / f"{path.stem}_basic_pitch.mid"
                target = midi_dir / f"{stem}.mid"
                if generated.exists():
                    generated.replace(target)
                else:
                    write_minimal_midi(target, stem)
                midi_paths[stem] = target
            return midi_paths
        except Exception as exc:
            state.warnings.append(f"basic-pitch가 설치되어 있지 않거나 MIDI 추출에 실패해 placeholder MIDI 파일을 생성했습니다. 상세: {exc}")
            return write_placeholder_midis(midi_dir)

    async def _store_lossless_stems(self, stem_paths: dict[str, Path], state: JobState) -> tuple[dict[str, Path], set[str]]:
        kept_paths: dict[str, Path] = {}
        silent_stems: set[str] = set()
        for stem, path in stem_paths.items():
            if is_silent_audio(path):
                path.unlink(missing_ok=True)
                silent_stems.add(stem)
                state.warnings.append(f"{stem} stem이 거의 무음이라 파일 저장을 생략했습니다.")
            else:
                kept_paths[stem] = path

        ffmpeg = find_executable("ffmpeg")
        if not ffmpeg:
            if kept_paths:
                state.warnings.append("ffmpeg가 없어 stem WAV를 FLAC으로 변환하지 않고 WAV로 저장했습니다.")
            return kept_paths, silent_stems

        stored: dict[str, Path] = {}
        for stem, path in kept_paths.items():
            target = path.with_suffix(".flac")
            cmd = [
                ffmpeg,
                "-y",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-i",
                str(path),
                "-vn",
                "-c:a",
                "flac",
                "-compression_level",
                os.getenv("MUSIC_FLAC_COMPRESSION_LEVEL", "8"),
                str(target),
            ]
            try:
                await asyncio.to_thread(self._run_command, cmd, "stem FLAC 변환 실패")
                if target.exists() and target.stat().st_size > 0:
                    path.unlink(missing_ok=True)
                    stored[stem] = target
                else:
                    stored[stem] = path
            except Exception as exc:
                state.warnings.append(f"{stem} stem FLAC 변환에 실패해 WAV로 저장했습니다. 상세: {exc}")
                target.unlink(missing_ok=True)
                stored[stem] = path
        return stored, silent_stems

    def _run_command(self, cmd: list[str], error_message: str) -> None:
        completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if completed.returncode != 0:
            stderr = completed.stderr.strip().splitlines()
            detail = stderr[-1] if stderr else "알 수 없는 오류"
            raise RuntimeError(f"{error_message}: {detail}")


def get_wav_duration(path: Path) -> float | None:
    try:
        with wave.open(str(path), "rb") as handle:
            frames = handle.getnframes()
            rate = handle.getframerate()
            return frames / float(rate)
    except Exception:
        return None


def find_executable(name: str) -> str | None:
    from_path = shutil.which(name)
    if from_path:
        return from_path
    venv_bin = Path(sys.executable).parent / name
    if venv_bin.exists():
        return str(venv_bin)
    return None


def write_silent_wav(path: Path, duration: float, sample_rate: int = 44100) -> None:
    frames = int(max(0.1, duration) * sample_rate)
    with wave.open(str(path), "wb") as handle:
        handle.setnchannels(2)
        handle.setsampwidth(2)
        handle.setframerate(sample_rate)
        silence = b"\x00\x00\x00\x00" * min(sample_rate, frames)
        remaining = frames
        while remaining > 0:
            chunk = min(sample_rate, remaining)
            handle.writeframes(silence[: chunk * 4])
            remaining -= chunk


def waveform_peaks(path: Path, points: int = 2400) -> list[float]:
    try:
        with wave.open(str(path), "rb") as handle:
            channels = handle.getnchannels()
            frames = handle.getnframes()
            sample_width = handle.getsampwidth()
            raw = handle.readframes(frames)
        if sample_width != 2 or frames == 0:
            return synthetic_waveform(points)
        samples = struct.unpack("<" + "h" * (len(raw) // 2), raw)
        mono = []
        for i in range(0, len(samples), channels):
            mono.append(sum(abs(samples[i + ch]) for ch in range(channels)) / channels / 32768)
        bucket = max(1, len(mono) // points)
        peaks = [max(mono[i : i + bucket] or [0]) for i in range(0, len(mono), bucket)]
        return [round(float(v), 4) for v in peaks[:points]]
    except Exception:
        return synthetic_waveform(points)


def is_silent_audio(path: Path, peak_threshold: float = SILENT_PEAK_THRESHOLD, rms_threshold: float = SILENT_RMS_THRESHOLD) -> bool:
    stats = audio_stats(path)
    if not stats:
        return False
    peak, rms = stats
    return peak <= peak_threshold or rms <= rms_threshold


def audio_stats(path: Path) -> tuple[float, float] | None:
    try:
        import numpy as np
        import soundfile as sf

        peak = 0.0
        square_sum = 0.0
        sample_count = 0
        with sf.SoundFile(str(path)) as audio:
            while True:
                chunk = audio.read(frames=65536, dtype="float32", always_2d=True)
                if chunk.size == 0:
                    break
                absolute = np.abs(chunk)
                peak = max(peak, float(absolute.max(initial=0.0)))
                square_sum += float(np.square(chunk).sum())
                sample_count += int(chunk.size)
        if sample_count == 0:
            return 0.0, 0.0
        return peak, math.sqrt(square_sum / sample_count)
    except Exception:
        return wav_audio_stats(path)


def wav_audio_stats(path: Path) -> tuple[float, float] | None:
    try:
        with wave.open(str(path), "rb") as handle:
            if handle.getsampwidth() != 2:
                return None
            peak = 0.0
            square_sum = 0.0
            sample_count = 0
            while True:
                raw = handle.readframes(65536)
                if not raw:
                    break
                samples = struct.unpack("<" + "h" * (len(raw) // 2), raw)
                for sample in samples:
                    value = abs(sample) / 32768
                    peak = max(peak, value)
                    square_sum += value * value
                sample_count += len(samples)
        if sample_count == 0:
            return 0.0, 0.0
        return peak, math.sqrt(square_sum / sample_count)
    except Exception:
        return None


def synthetic_waveform(points: int) -> list[float]:
    return [round(0.15 + 0.7 * abs(math.sin(i * 0.19)) * (0.6 + 0.4 * abs(math.sin(i * 0.047))), 4) for i in range(points)]


def stem_waveform(stem: str, path: Path, mix_waveform: list[float]) -> list[float]:
    peaks = waveform_peaks(path)
    if peaks and max(peaks) > 0.01:
        return peaks
    return shaped_mix_waveform(stem, mix_waveform)


def shaped_mix_waveform(stem: str, mix_waveform: list[float]) -> list[float]:
    profiles = {
        "vocals": (0.72, 0.21, 0.037),
        "drums": (0.96, 0.55, 0.083),
        "bass": (0.62, 0.34, 0.021),
        "guitar": (0.68, 0.28, 0.051),
        "piano": (0.55, 0.22, 0.033),
        "other": (0.5, 0.18, 0.047),
    }
    gain, movement, speed = profiles.get(stem, (0.6, 0.2, 0.04))
    shaped = []
    for index, peak in enumerate(mix_waveform):
        envelope = gain + movement * abs(math.sin(index * speed))
        shaped.append(round(max(0.01, min(1.0, peak * envelope)), 4))
    return shaped


def estimate_key(chroma) -> tuple[str, str]:
    import numpy as np

    profile = np.mean(chroma, axis=1)
    scores: list[tuple[float, str, str]] = []
    for i, name in enumerate(KEY_NAMES):
        scores.append((float(np.corrcoef(profile, np.roll(MAJOR_PROFILE, i))[0, 1]), name, "major"))
        scores.append((float(np.corrcoef(profile, np.roll(MINOR_PROFILE, i))[0, 1]), name, "minor"))
    _, key, mode = max(scores, key=lambda item: item[0])
    return key, mode


def estimate_chords(chroma, sr: int, librosa) -> list[dict]:
    import numpy as np

    frames = chroma.shape[1]
    times = librosa.frames_to_time(np.arange(frames), sr=sr)
    if frames == 0:
        return []
    window_seconds = 2.0
    chords = []
    start = 0
    while start < frames:
        end = min(frames, int(np.searchsorted(times, times[start] + window_seconds)))
        segment = np.mean(chroma[:, start:max(start + 1, end)], axis=1)
        label, confidence = estimate_chord_label(segment)
        chords.append(
            {
                "start": round(float(times[start]), 3),
                "end": round(float(times[min(max(end - 1, start), frames - 1)]), 3),
                "label": label,
                "confidence": round(confidence, 3),
            }
        )
        start = max(end, start + 1)
    return merge_adjacent_chords(chords)


def estimate_chord_label(chroma_vector) -> tuple[str, float]:
    import numpy as np

    major_template = np.array([1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    minor_template = np.array([1, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0], dtype=float)
    vector = np.asarray(chroma_vector, dtype=float)
    if vector.max() > 0:
        vector = vector / vector.max()
    best = (-1.0, "N")
    for i, name in enumerate(KEY_NAMES):
        maj = float(np.dot(vector, np.roll(major_template, i)))
        min_score = float(np.dot(vector, np.roll(minor_template, i)))
        best = max(best, (maj, name), (min_score, f"{name}m"), key=lambda item: item[0])
    confidence = min(1.0, max(0.0, best[0] / 3.0))
    return best[1], confidence


def merge_adjacent_chords(chords: list[dict]) -> list[dict]:
    merged: list[dict] = []
    for chord in chords:
        if merged and merged[-1]["label"] == chord["label"]:
            merged[-1]["end"] = chord["end"]
            merged[-1]["confidence"] = round((merged[-1]["confidence"] + chord["confidence"]) / 2, 3)
        else:
            merged.append(chord)
    return merged[:120]


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


def cleanup_intermediates(source: Path, converted: Path, stems_dir: Path) -> None:
    converted.unlink(missing_ok=True)
    remove_upload_source(source)
    shutil.rmtree(stems_dir / "_demucs", ignore_errors=True)


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
