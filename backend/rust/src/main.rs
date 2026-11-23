use std::{env, error::Error, path::Path};

type Result<T> = std::result::Result<T, Box<dyn Error>>;

fn waveform(path: &Path, points: usize) -> Result<Vec<f64>> {
    let mut wav = hound::WavReader::open(path)?;
    let spec = wav.spec();
    if spec.sample_format != hound::SampleFormat::Int
        || !matches!(spec.bits_per_sample, 16 | 24 | 32)
        || !matches!(spec.channels, 1 | 2)
        || wav.duration() == 0
    {
        return Err("expected non-empty mono or stereo integer PCM WAV".into());
    }
    let frames = wav.duration() as usize;
    let bucket = frames.div_ceil(points);
    let stereo = spec.channels == 2;
    let scale = (1_u64 << (spec.bits_per_sample - 1)) as f32;
    let mut samples = wav.samples::<i32>();
    let mut peaks = Vec::with_capacity(points);
    let mut peak = 0.0_f32;
    for frame in 0..frames {
        let left = samples.next().ok_or("truncated WAV")?? as f32;
        let mut level = left.abs() / scale;
        if stereo {
            let right = samples.next().ok_or("missing right channel")?? as f32;
            level = (level + right.abs() / scale) * 0.5;
        }
        peak = peak.max(level);
        if (frame + 1) % bucket == 0 || frame + 1 == frames {
            peaks.push(f64::from(peak));
            peak = 0.0;
        }
    }
    Ok(peaks)
}

fn main() -> Result<()> {
    let args: Vec<_> = env::args_os().skip(1).collect();
    if args.is_empty() || args.len() > 6 {
        return Err("usage: music-dsp STEM.wav [STEM.wav ...]".into());
    }
    let output = args
        .iter()
        .map(|path| waveform(Path::new(path), 2400))
        .collect::<Result<Vec<_>>>()?;
    serde_json::to_writer(std::io::stdout().lock(), &output)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mono_stereo_and_tail_buckets_at_multiple_rates() -> Result<()> {
        let base = env::temp_dir().join(format!("music-dsp-{}", std::process::id()));
        for (channels, sample_rate, bits) in [(1, 22050, 16), (2, 48000, 24)] {
            let mut writer = hound::WavWriter::create(
                &base,
                hound::WavSpec { channels, sample_rate, bits_per_sample: bits, sample_format: hound::SampleFormat::Int },
            )?;
            let scale = 1 << (bits - 1);
            for level in [scale / 4, -scale / 2, 0, 0, -scale] {
                writer.write_sample(level)?;
                if channels == 2 {
                    writer.write_sample(0_i32)?;
                }
            }
            writer.finalize()?;
            let gain = if channels == 2 { 0.5 } else { 1.0 };
            assert_eq!(waveform(&base, 3)?, vec![0.5 * gain, 0.0, gain]);
            std::fs::remove_file(&base)?;
        }
        Ok(())
    }
}
