"""Use bounded Core ML batches with Basic Pitch 0.4.0's existing note decoder."""
from __future__ import annotations

from itertools import islice
from pathlib import Path

BATCH_SIZE = 8


def write_coreml_midi(source: Path, target: Path, model) -> None:
    import numpy as np
    from basic_pitch import inference, note_creation

    # Keep Basic Pitch's windowing, overlap trimming and default note settings.
    overlap_frames = 30
    overlap = overlap_frames * inference.FFT_HOP
    windows = iter(inference.get_audio_input(source, overlap, inference.AUDIO_N_SAMPLES - overlap))
    output_names = {"note": "Identity_1", "onset": "Identity_2", "contour": "Identity"}
    outputs: dict[str, list] = {name: [] for name in output_names}
    sample_count = 0
    while batch := list(islice(windows, BATCH_SIZE)):
        sample_count = batch[0][2]
        predictions = model.model.predict([{"input_2": audio} for audio, _, _ in batch])
        if len(predictions) != len(batch):
            raise RuntimeError("Core ML returned an incomplete prediction batch")
        for output in predictions:
            for name, feature in output_names.items():
                outputs[name].append(output[feature])

    model_output = {
        name: inference.unwrap_output(np.concatenate(values), sample_count, overlap_frames)
        for name, values in outputs.items()
    }
    del outputs
    min_note_len = int(np.round(127.70 / 1000 * (inference.AUDIO_SAMPLE_RATE / inference.FFT_HOP)))
    midi, _ = note_creation.model_output_to_notes(
        model_output, onset_thresh=0.5, frame_thresh=0.3, min_note_len=min_note_len,
        min_freq=None, max_freq=None, multiple_pitch_bends=False, melodia_trick=True, midi_tempo=120,
    )
    midi.write(str(target))
