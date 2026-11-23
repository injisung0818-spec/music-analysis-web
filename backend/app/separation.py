"""Engine selection and identity for reusable, validated stem WAVs."""
from __future__ import annotations

import hashlib
import importlib.metadata as metadata
import json
import os
import platform
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

MODEL = "htdemucs_6s"
Engine = Literal["torch", "mps", "mlx"]
MLX_VERSION = "1.6.1"


def default_engine() -> Engine:
    configured = os.getenv("MUSIC_SEPARATION_ENGINE", "torch")
    if configured not in {"torch", "mps", "mlx"}:
        raise ValueError(f"지원하지 않는 MUSIC_SEPARATION_ENGINE 설정입니다. {configured}")
    return cast(Engine, configured)


@dataclass(frozen=True)
class SeparationPlan:
    engine: Engine
    device: str
    python: str
    repo: Path | None = None
    mlx_cache: Path | None = None

    @classmethod
    def build(cls, engine: Engine, *, cpu_retry: bool = False) -> SeparationPlan:
        raw_repo = os.getenv("MUSIC_DEMUCS_REPO")
        repo = Path(raw_repo).expanduser().resolve() if raw_repo else None
        if engine == "mlx":
            if platform.system() != "Darwin" or platform.machine() != "arm64":
                raise RuntimeError("MLX 실행에는 Apple Silicon macOS가 필요합니다.")
            if repo:
                raise RuntimeError("MLX는 MUSIC_DEMUCS_REPO의 PyTorch 체크포인트를 사용할 수 없습니다.")
            separate_python = Path(__file__).resolve().parents[1] / ".venv-mlx" / "bin" / "python"
            python = os.getenv("MUSIC_MLX_PYTHON") or (
                str(separate_python) if separate_python.is_file() else sys.executable
            )
            cache = Path(os.getenv("DEMUCS_MLX_CACHE_DIR") or Path.home() / ".cache" / "demucs-mlx")
            return cls(engine, "metal", str(Path(python).expanduser()), mlx_cache=cache.expanduser().resolve())
        device = "cpu" if cpu_retry else "mps" if engine == "mps" else os.getenv("MUSIC_DEMUCS_DEVICE", "cpu")
        return cls("mps" if device == "mps" else "torch", device, sys.executable, repo=repo)

    @property
    def accelerated(self) -> bool:
        return self.engine in {"mps", "mlx"} or self.device != "cpu"

    def command(self, source: Path, output: Path, shifts: int, overlap: str) -> tuple[list[str], Path, dict[str, str]]:
        env = os.environ.copy()
        if self.engine == "mlx":
            env["DEMUCS_MLX_CACHE_DIR"] = str(self.mlx_cache)
            worker = Path(__file__).with_name("mlx_stems.py")
            return [self.python, "-u", str(worker), str(source), str(output), str(shifts), overlap], output, env

        if self.device == "mps":
            # A failed GPU operation gets a clean, explicit CPU retry.
            env["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
        command = [
            self.python, "-u", "-m", "demucs", "-n", MODEL, "--device", self.device,
            "--shifts", str(shifts), "--overlap", overlap, "--int24",
            "--out", str(output), "--filename", "{stem}.{ext}",
        ]
        if self.repo:
            command.extend(["--repo", str(self.repo)])
        return command + [str(source)], output / MODEL, env

    def cache_key(self, digest: str, shifts: int, overlap: str) -> str | None:
        # A cold installation has no model identity until its first successful run.
        try:
            files = self._model_files()
            if not files:
                return None
            if self.engine == "mlx":
                versions = subprocess.check_output(
                    [self.python, "-c", "from importlib.metadata import version; print("
                     "version('demucs-mlx'), version('mlx'), version('mlx-audio-io'), version('mlx-spectro'))"],
                    text=True, stderr=subprocess.DEVNULL, timeout=5,
                ).strip()
            else:
                versions = " ".join(metadata.version(name) for name in ("demucs", "torch", "sphn", "julius"))
            identity = []
            for path in sorted(files):
                info = path.stat()
                identity.append((str(path.resolve()), info.st_size, info.st_mtime_ns, info.st_ctime_ns))
        except (OSError, subprocess.SubprocessError, metadata.PackageNotFoundError):
            return None
        key = (1, digest, self.engine, self.device, MODEL, shifts, overlap, versions, identity)
        return hashlib.sha256(json.dumps(key).encode()).hexdigest()

    def _model_files(self) -> list[Path]:
        if self.mlx_cache is not None:
            return [self.mlx_cache / f"{MODEL}.safetensors", self.mlx_cache / f"{MODEL}_config.json"]
        if self.repo:
            return [self.repo / f"{MODEL}.yaml", *self.repo.glob("*.th")]
        cache_home = Path(os.getenv("XDG_CACHE_HOME") or Path.home() / ".cache").expanduser()
        torch_home = Path(os.getenv("TORCH_HOME") or cache_home / "torch").expanduser()
        checkpoint = torch_home / "hub" / "checkpoints" / "5c90dfd2-34c22ccb.th"
        paths = [checkpoint] if checkpoint.is_file() else []
        if metadata.version("demucs").startswith("4.1."):
            from huggingface_hub.constants import HF_HUB_CACHE

            repo = Path(HF_HUB_CACHE) / "models--adefossez--HTDemucs-6s"
            reference = repo / "refs" / "main"
            if reference.is_file():
                snapshot = repo / "snapshots" / reference.read_text().strip()
                weights = list(snapshot.glob("*.safetensors"))
                if weights:
                    paths.extend([snapshot / f"{MODEL}.yaml", *weights])
        return paths
