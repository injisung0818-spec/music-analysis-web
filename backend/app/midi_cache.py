"""Reuse real Basic Pitch MIDI only from the job that supplied the exact WAVs."""
from __future__ import annotations

import hashlib
import json
import os
import platform
import sys
from contextlib import suppress
from functools import lru_cache
from importlib.metadata import PackageNotFoundError, distribution, version
from pathlib import Path

MARKER = ".basic-pitch.json"


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


@lru_cache(maxsize=1)
def cache_signature() -> str | None:
    try:
        package = distribution("basic-pitch")
        models = [file for file in package.files or () if "/saved_models/" in str(file)]
        if not models:
            return None
        releases = {}
        for name in (
            "coremltools", "tensorflow", "tensorflow-cpu", "tensorflow-intel", "tensorflow-macos",
            "tf-nightly", "tflite-runtime", "onnxruntime", "onnxruntime-gpu", "onnxruntime-silicon",
            "librosa", "numpy", "scipy", "soxr", "soundfile", "pretty-midi", "mido",
        ):
            try:
                releases[name] = version(name)
            except PackageNotFoundError:
                releases[name] = None
        artifacts = {str(file): digest(package.locate_file(file)) for file in models}
        return hashlib.sha256(json.dumps((
            1, sys.version, platform.platform(), package.version, releases, artifacts,
        ), sort_keys=True).encode()).hexdigest()
    except (PackageNotFoundError, OSError):
        return None


def reuse_midi(source: Path, destination: Path, stems: tuple[str, ...], signature: str) -> dict[str, Path]:
    targets: dict[str, Path] = {}
    try:
        if (source / MARKER).is_symlink():
            return {}
        stamp = json.loads((source / MARKER).read_text())
        if stamp["signature"] != signature:
            return {}
        for stem in stems:
            filename = f"{stem}.mid"
            original = source / filename
            target = destination / filename
            if original.is_symlink() or not original.is_file():
                raise OSError("invalid cached MIDI path")
            os.link(original, target)
            targets[stem] = target
            if digest(target) != stamp["files"][stem]:
                raise ValueError("cached MIDI checksum mismatch")
    except (OSError, ValueError, KeyError, TypeError):
        for path in targets.values():
            path.unlink(missing_ok=True)
        return {}
    return targets


def mark_midi(destination: Path, targets: dict[str, Path], signature: str) -> None:
    stamp = destination / MARKER
    temp = stamp.with_suffix(".tmp")
    try:
        files = {stem: digest(path) for stem, path in targets.items()}
        temp.write_text(json.dumps({"signature": signature, "files": files}))
        temp.replace(stamp)
    except OSError:
        with suppress(OSError):
            temp.unlink(missing_ok=True)
