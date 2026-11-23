"""Tempo, key, and chord analysis for the original audio."""
from __future__ import annotations

import os
from functools import lru_cache
from pathlib import Path
from time import perf_counter

import soundfile

from .harmonic import harmonic_filter


KEY_NAMES = ["C", "C#", "D", "Eb", "E", "F", "F#", "G", "Ab", "A", "Bb", "B"]
MAJOR_PROFILE = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88]
MINOR_PROFILE = [6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17]
ANALYSIS_SAMPLE_RATE = 22050
CHROMA_HOP_LENGTH = 2048


def analyze_music(audio_wav: Path) -> tuple[dict, dict, str | None]:
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
