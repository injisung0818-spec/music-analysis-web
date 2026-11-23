"""Isolated MLX worker. Invoked with the optional Apple Silicon Python environment."""
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path

from separation import MLX_VERSION, MODEL


def main() -> None:
    try:
        installed = version("demucs-mlx")
    except PackageNotFoundError:
        sys.exit(f"MLX 실행 환경에 demucs-mlx가 없습니다. demucs-mlx=={MLX_VERSION}을 설치하세요.")
    if installed != MLX_VERSION:
        sys.exit(f"demucs-mlx=={MLX_VERSION}이 필요합니다. 설치 버전 {installed}")

    import mlx.core as mx
    from demucs_mlx.api import Separator, save_audio
    from demucs_mlx.audio import load_audio

    source, output, shifts, overlap = sys.argv[1:]
    separator = Separator(
        model=MODEL, shifts=int(shifts), overlap=float(overlap), progress=True,
        batch_size=1, compile=False, attention_precision="fp32",
    )
    print(f"Separating track {source}", flush=True)
    wav, _ = load_audio(source, sr=separator.samplerate, dtype="float32")
    # Match PyTorch Demucs's outer normalization and restore levels after inference.
    wav = wav[:separator.audio_channels]
    ref = wav.mean(axis=0)
    mean = ref.mean()
    std = mx.std(ref, ddof=1) + 1e-8 if ref.size > 1 else mx.array(1e-8)
    _, stems = separator.separate_tensor((wav - mean) / std, return_mx=True)
    print("Writing stems", flush=True)
    output_dir = Path(output)
    output_dir.mkdir(parents=True, exist_ok=True)
    for name, stem in stems.items():
        stem = stem * std + mean
        if not mx.all(mx.isfinite(stem)).item():
            raise RuntimeError(f"{name} 스템에 유한하지 않은 샘플이 있습니다.")
        save_audio(stem, output_dir / f"{name}.wav", samplerate=separator.samplerate, bits_per_sample=24)


if __name__ == "__main__":
    main()
