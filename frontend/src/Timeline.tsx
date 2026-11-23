import { useMemo } from "react";
import type { CSSProperties, MouseEvent } from "react";
import type { Analysis } from "./types";

function seekAtClick(event: MouseEvent<HTMLDivElement>, duration: number, onSeek: (time: number) => void) {
  const rect = event.currentTarget.getBoundingClientRect();
  onSeek(((event.clientX - rect.left) / rect.width) * duration);
}

function playheadPosition(currentTime: number, duration: number) {
  return `${duration ? (currentTime / duration) * 100 : 0}%`;
}

export function Ruler({ currentTime, duration, onSeek }: { currentTime: number; duration: number; onSeek: (time: number) => void }) {
  return (
    <div
      className="ruler"
      onClick={(event) => seekAtClick(event, duration, onSeek)}
    >
      <div className="rulerTicks">
        {Array.from({ length: 48 }).map((_, index) => <i key={index} />)}
      </div>
      <b style={{ left: playheadPosition(currentTime, duration) }} />
    </div>
  );
}

export function RegionLane({
  color,
  waveform,
  emptyLabel,
  duration,
  currentTime,
  onSeek
}: {
  color: string;
  waveform: number[];
  emptyLabel: string;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const wavePath = useMemo(() => {
    if (!waveform.length) return "";
    const targetLength = Math.max(500, Math.min(3600, Math.round(duration * 9)));
    const peaks = resamplePeaks(waveform, targetLength);
    return peaks.length ? buildWavePath(peaks) : "";
  }, [waveform, duration]);
  return (
    <div
      className="regionLane"
      style={{ "--accent": color } as CSSProperties}
      onClick={(event) => seekAtClick(event, duration, onSeek)}
    >
      <div className="region">
        <div className={`regionWave relative h-full py-[7px] ${wavePath ? "" : "empty"}`}>
          {wavePath ? (
            <svg className="waveSvg block h-full w-full" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="1000" y1="50" y2="50" />
              <path d={wavePath} />
            </svg>
          ) : (
            <small>{emptyLabel}</small>
          )}
        </div>
      </div>
      <i className="playhead" style={{ left: playheadPosition(currentTime, duration) }} />
    </div>
  );
}

export function ChordTimeline({ analysis, currentTime, onSeek }: { analysis: Analysis | null; currentTime: number; onSeek: (time: number) => void }) {
  const duration = analysis?.duration ?? 30;
  const chords = analysis?.chords ?? [
    { start: 0, end: 7.5, label: "C", confidence: 0.4 },
    { start: 7.5, end: 15, label: "G", confidence: 0.4 },
    { start: 15, end: 22.5, label: "Am", confidence: 0.4 },
    { start: 22.5, end: 30, label: "F", confidence: 0.4 }
  ];
  return (
    <div
      className="chordTimeline"
      onClick={(event) => seekAtClick(event, duration, onSeek)}
    >
      {chords.map((chord, index) => (
        <span
          key={`${chord.label}-${chord.start}-${index}`}
          style={{
            left: `${(chord.start / duration) * 100}%`,
            width: `${Math.max(1, ((chord.end - chord.start) / duration) * 100)}%`
          }}
        >
          {chord.label}
        </span>
      ))}
      <i style={{ left: playheadPosition(currentTime, duration) }} />
    </div>
  );
}

function resamplePeaks(peaks: number[], targetLength: number) {
  if (peaks.length === targetLength) return peaks;
  if (peaks.length === 1) return Array.from({ length: targetLength }, () => peaks[0]);
  return Array.from({ length: targetLength }, (_, index) => {
    const position = (index / Math.max(1, targetLength - 1)) * (peaks.length - 1);
    const left = Math.floor(position);
    const right = Math.min(peaks.length - 1, left + 1);
    const blend = position - left;
    return peaks[left] * (1 - blend) + peaks[right] * blend;
  });
}

function buildWavePath(peaks: number[]) {
  const width = 1000;
  const mid = 50;
  const topPoints: string[] = [];
  const bottomPoints: string[] = [];
  const segments = Math.max(1, peaks.length - 1);
  peaks.forEach((peak, index) => {
    const x = ((index / segments) * width).toFixed(2);
    const amp = Math.max(1, Math.min(48, peak * 58));
    topPoints.push(`${x},${(mid - amp).toFixed(2)}`);
    bottomPoints.push(`${x},${(mid + amp).toFixed(2)}`);
  });
  bottomPoints.reverse();
  return `M ${topPoints.join(" L ")} L ${bottomPoints.join(" L ")} Z`;
}
