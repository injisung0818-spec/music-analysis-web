import type { StemName } from "./types";

export const STEM_LABELS: Record<StemName, string> = {
  vocals: "보컬",
  drums: "드럼",
  bass: "베이스",
  guitar: "기타",
  piano: "피아노",
  other: "나머지"
};

const STATUS_LABELS: Record<string, string> = {
  queued: "대기 중",
  running: "분석 중",
  done: "완료",
  error: "오류",
  ready: "준비됨"
};

const MESSAGE_LABELS: Record<string, string> = {
  Queued: "대기열에 추가됨",
  "Preparing audio": "오디오 준비 중",
  "Separating stems": "스템 분리 중",
  "Analyzing tempo, key, and chords": "템포, 키, 코드 분석 중",
  "Extracting MIDI": "MIDI 추출 중",
  "Compressing audio assets": "오디오 압축 저장 중",
  "오디오 압축 저장 중": "오디오 압축 저장 중",
  "Writing results": "결과 저장 중",
  "Analysis complete": "분석 완료",
  "Processing failed": "처리 실패"
};

export function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

export function messageLabel(message?: string) {
  if (!message) return null;
  return MESSAGE_LABELS[message] ?? message;
}

export function normalizeErrorMessage(errorValue: unknown) {
  const raw = errorValue instanceof Error ? errorValue.message : String(errorValue ?? "");
  const withoutPrefix = raw.replace(/^Error:\s*/i, "").trim();
  try {
    const parsed = JSON.parse(withoutPrefix) as { detail?: string };
    if (parsed.detail === "Method Not Allowed") {
      return "백엔드 서버의 API가 아직 최신 코드로 실행되지 않았습니다. 서버를 재시작한 뒤 다시 시도하세요.";
    }
    return parsed.detail ?? withoutPrefix;
  } catch {
    return withoutPrefix;
  }
}
