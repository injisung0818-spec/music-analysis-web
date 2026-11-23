export type SeparationEngine = "torch" | "mps" | "mlx";
export type SeparationQuality = "standard" | "high";
export type SeparationStatus = "pending" | "running" | "succeeded" | "failed" | "unverified";
export type AudioFormat = "wav" | "flac" | "m4a";

export type JobStatus = "queued" | "running" | "done" | "error";

export interface JobResponse {
  id: string;
  status: JobStatus;
  progress: number;
  message: string;
  created_at: string;
  updated_at: string;
  original_filename: string;
  warnings: string[];
  error?: string | null;
  separation_quality?: SeparationQuality;
  separation_status?: SeparationStatus;
  separation_error?: string | null;
  actual_separation_engine?: SeparationEngine | null;
  separation_cache_hit?: boolean;
}

export interface Beat {
  time: number;
  index: number;
}

export interface Chord {
  start: number;
  end: number;
  label: string;
  confidence: number;
}

export interface StemAsset {
  name: StemName;
  color: string;
  audio_url: string | null;
  midi_url: string | null;
  waveform: number[];
}

export type StemName = "vocals" | "drums" | "bass" | "guitar" | "piano" | "other";

export interface Analysis {
  job_id: string;
  original_filename: string;
  duration: number;
  bpm: number;
  key: string;
  mode: string;
  beats: Beat[];
  chords: Chord[];
  stems: StemAsset[];
  music_analysis?: boolean;
  warnings: string[];
  generated_at: string;
  separation_status?: SeparationStatus;
  separation_error?: string | null;
  actual_separation_engine?: SeparationEngine | null;
  separation_cache_hit?: boolean;
  stem_audio?: { frames: number; sample_rate: number; channels: number; bit_depth: number } | null;
}

export interface TrackState {
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
}
