from __future__ import annotations

import math
import os
import re
import subprocess
import zipfile
from pathlib import Path
from typing import Literal

from fastapi import HTTPException

from .processor import find_executable

AudioFormat = Literal["wav", "flac", "m4a"]
MEDIA_TYPES = {"wav": "audio/wav", "flac": "audio/flac", "m4a": "audio/mp4", "zip": "application/zip"}
LEGACY_SAMPLE_RATE = 44100


def ffmpeg_run(args: list[str], loglevel: str = "error") -> str:
    ffmpeg = find_executable("ffmpeg")
    if not ffmpeg:
        raise HTTPException(503, "이 형식으로 내보내려면 ffmpeg가 필요합니다.")
    try:
        completed = subprocess.run(
            [ffmpeg, "-y", "-nostdin", "-hide_banner", "-loglevel", loglevel, *args],
            capture_output=True, text=True, timeout=300,
        )
    except subprocess.TimeoutExpired as exc:
        raise HTTPException(504, "오디오 내보내기 시간 제한을 초과했습니다.") from exc
    except OSError as exc:
        raise HTTPException(503, f"ffmpeg를 실행할 수 없습니다. {exc}") from exc
    if completed.returncode:
        detail = completed.stderr.strip()[-1000:] or f"종료 코드 {completed.returncode}"
        raise HTTPException(500, f"오디오 내보내기 실패 · {detail}")
    return completed.stderr


def codec_options(audio_format: AudioFormat, *, mix: bool = False) -> list[str]:
    if audio_format == "wav":
        return ["-c:a", "pcm_s24le"]
    if audio_format == "flac":
        return ["-c:a", "flac", "-sample_fmt", "s32", "-bits_per_raw_sample", "24"]
    bitrate = os.getenv("MUSIC_STEM_BITRATE", "256k")
    if mix:
        bitrate = os.getenv("MUSIC_EXPORT_BITRATE", bitrate)
    return ["-c:a", "aac", "-b:a", bitrate, "-movflags", "+faststart"]


def export_stem(
    source: Path, target: Path, audio_format: AudioFormat, *, legacy_frames: int | None = None
) -> None:
    if source.suffix.lower() == f".{audio_format}" and legacy_frames is None:
        os.link(source, target)
        return
    filters = []
    if legacy_frames is not None:
        filters = [
            "-af", f"aresample={LEGACY_SAMPLE_RATE}:first_pts=0,apad,atrim=end_sample={legacy_frames}",
            "-ac", "2",
        ]
    ffmpeg_run(["-i", str(source), "-map", "0:a:0", *filters, *codec_options(audio_format), str(target)])


def export_mix(paths: dict[str, Path], target: Path, audio_format: AudioFormat) -> None:
    inputs = [argument for path in paths.values() for argument in ("-i", str(path))]
    labels = "".join(f"[{index}:a]" for index in range(len(paths)))
    mix = f"{labels}amix=inputs={len(paths)}:duration=longest:dropout_transition=0:normalize=0"
    # Measure the floating-point sum before PCM/AAC encoding can clip it.
    log = ffmpeg_run([
        *inputs, "-filter_complex", f"{mix},astats=measure_perchannel=none:measure_overall=Peak_level[out]",
        "-map", "[out]", "-f", "null", "-",
    ], loglevel="info")
    peaks = re.findall(r"Peak level dB:\s*(\S+)", log)
    peak = float(peaks[-1]) if peaks else math.nan
    if math.isnan(peak) or peak == math.inf:
        raise HTTPException(500, "믹스의 피크 레벨을 확인할 수 없습니다.")
    ceiling = -1.0 if audio_format == "m4a" else -0.1
    gain = min(0.0, ceiling - peak)
    ffmpeg_run([
        *inputs, "-filter_complex", f"{mix},volume={gain:.6f}dB[out]",
        "-map", "[out]", *codec_options(audio_format, mix=True), str(target),
    ])


def export_zip(
    paths: dict[str, Path], target: Path, folder: str, analysis: dict, audio_format: AudioFormat
) -> None:
    metadata = analysis.get("stem_audio")
    sample_rate = metadata["sample_rate"] if metadata else LEGACY_SAMPLE_RATE
    frames = metadata["frames"] if metadata else round(float(analysis.get("duration") or 0) * sample_rate)
    if frames <= 0:
        raise HTTPException(500, "스템을 정렬할 오디오 길이 정보가 없습니다.")
    already_compressed = audio_format != "wav"
    compression = zipfile.ZIP_STORED if already_compressed else zipfile.ZIP_DEFLATED
    with zipfile.ZipFile(target, "w", compression=compression) as archive:
        for name, source in paths.items():
            filename = f"{name}.{audio_format}"
            item = target.parent / filename
            export_stem(source, item, audio_format, legacy_frames=None if metadata else frames)
            archive.write(item, arcname=f"{folder}/{filename}")
            item.unlink()
        bpm = analysis.get("bpm")
        info = [
            f"Title: {analysis.get('original_filename', '')}",
            f"BPM: {round(float(bpm), 3) if isinstance(bpm, (int, float)) else bpm or '--'}",
            f"Key: {analysis.get('key', '--')} {analysis.get('mode', '')}".strip(),
            f"Duration: {frames / sample_rate:.6f} seconds",
            f"Sample Count: {frames} samples at {sample_rate} Hz",
            f"Files: aligned {audio_format.upper()} stems.",
            "Ableton: set the project tempo to the BPM above and turn Warp OFF for all imported stems.",
        ]
        archive.writestr(f"{folder}/tempo-info.txt", "\n".join(info) + "\n")
