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
  silent?: boolean;
  skipped_reason?: string;
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
  warnings: string[];
  generated_at: string;
}

export interface TrackState {
  muted: boolean;
  solo: boolean;
  volume: number;
  pan: number;
}
