"""Use the optional Rust DSP library for librosa's two HPSS median passes."""
from __future__ import annotations

import ctypes
import sys
from functools import lru_cache
from pathlib import Path

FFT_SIZE = 2048
HOP_LENGTH = FFT_SIZE // 4
MEDIAN_WIDTH = 31


@lru_cache(maxsize=1)
def _median_filter(dsp_binary: str):
    import numpy as np

    name = "libmusic_dsp.dylib" if sys.platform == "darwin" else "libmusic_dsp.so"
    try:
        library = Path(dsp_binary).resolve().with_name(name)
        median = ctypes.CDLL(str(library)).median_filter_31
    except (OSError, RuntimeError, AttributeError):
        return None
    buffer_type = np.ctypeslib.ndpointer(
        dtype=np.float32, ndim=2, flags=("C_CONTIGUOUS", "ALIGNED")
    )
    median.argtypes = [buffer_type, buffer_type, ctypes.c_size_t, ctypes.c_size_t]
    median.restype = None
    return median


def harmonic_filter(librosa, audio, dsp_binary: str | None):
    if not dsp_binary:
        return librosa.effects.harmonic(audio)

    import numpy as np

    median = _median_filter(dsp_binary)
    # Keep librosa's edge handling when the kernel exceeds the time axis.
    if median is None or audio.ndim != 1 or audio.dtype != np.float32 or (
        audio.size < (MEDIAN_WIDTH - 1) * HOP_LENGTH
    ):
        return librosa.effects.harmonic(audio)

    magnitude, phase = librosa.magphase(librosa.stft(audio, n_fft=FFT_SIZE, hop_length=HOP_LENGTH))
    if not np.isfinite(magnitude).all():
        return librosa.effects.harmonic(audio)

    # Store rows contiguously for each pass, then restore the STFT's column order.
    harmonic = np.empty_like(magnitude, order="C")
    median(np.ascontiguousarray(magnitude), harmonic, *magnitude.shape)
    harmonic = np.asfortranarray(harmonic)
    percussive = np.empty_like(magnitude, order="F")
    median(np.ascontiguousarray(magnitude.T), percussive.T, *magnitude.T.shape)

    mask = librosa.util.softmask(harmonic, percussive, power=2.0, split_zeros=True)
    spectrum = (magnitude * mask) * phase
    return librosa.istft(spectrum, dtype=audio.dtype, length=audio.size, n_fft=FFT_SIZE, hop_length=HOP_LENGTH)
