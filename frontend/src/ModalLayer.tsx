import type { Analysis, AudioFormat, JobResponse, SeparationEngine, SeparationQuality, StemName } from "./types";
import { STEM_LABELS, messageLabel, normalizeErrorMessage, statusLabel } from "./labels";

export type ModalView = "add" | "upload" | "export" | null;

const exportButtonClass = "dialogControl dialogControlBorder min-h-[36px] px-[10px] py-[6px]";

export function ModalLayer({
  view,
  fileName,
  job,
  progress,
  error,
  analysis,
  exportStemSelection,
  exportSeparateStems,
  exportBusy,
  exportFormat,
  separationQuality,
  separationEngine,
  stemsOnly,
  uploadBusy,
  onExportFormatChange,
  onQualityChange,
  onEngineChange,
  onStemsOnlyChange,
  onClose,
  onAddFolder,
  onOpenUpload,
  onFile,
  onExportWhole,
  onExportInstrumental,
  onExportSelected,
  onExportAllStems,
  onExportSingle,
  onToggleExportStem,
  onExportSeparateChange
}: {
  view: ModalView;
  fileName: string;
  job: JobResponse | null;
  progress: number;
  error: string | null;
  analysis: Analysis | null;
  exportStemSelection: StemName[];
  exportSeparateStems: boolean;
  exportBusy: boolean;
  exportFormat: AudioFormat;
  separationQuality: SeparationQuality;
  separationEngine: SeparationEngine | "";
  stemsOnly: boolean;
  uploadBusy: boolean;
  onExportFormatChange: (format: AudioFormat) => void;
  onQualityChange: (quality: SeparationQuality) => void;
  onEngineChange: (engine: SeparationEngine | "") => void;
  onStemsOnlyChange: (value: boolean) => void;
  onClose: () => void;
  onAddFolder: () => void;
  onOpenUpload: () => void;
  onFile: (file: File) => void | Promise<void>;
  onExportWhole: () => void | Promise<void>;
  onExportInstrumental: () => void;
  onExportSelected: () => void | Promise<void>;
  onExportAllStems: () => void;
  onExportSingle: (stem: StemName) => void;
  onToggleExportStem: (stem: StemName) => void;
  onExportSeparateChange: (separate: boolean) => void;
}) {
  const status = statusLabel(job?.status ?? "ready");
  const message = messageLabel(job?.message) ?? (fileName ? "파일 분석을 준비 중입니다" : "MP3 또는 WAV 파일을 선택하세요");
  const exportableStems = analysis?.stems.filter((stem) => stem.audio_url) ?? [];
  return (
    <div className="fixed inset-0 z-80 grid place-items-center bg-[rgba(0,0,0,0.42)] [backdrop-filter:brightness(0.82)]" role="presentation">
      {view === "add" && (
        <section className="modalPanel modalWidth" role="dialog" aria-modal="true" aria-label="추가">
          <CloseButton onClose={onClose} />
          <strong>추가</strong>
          <div className="grid grid-cols-2 gap-[12px]">
            <button className="dialogControl dialogControlBorder min-h-[118px] p-[18px]" onClick={onAddFolder}>
              <span className="text-[18px] font-extrabold">폴더</span>
              <small className="text-[12px] text-[#bdbdbd]">새로운 폴더 생성</small>
            </button>
            <button className="dialogControl dialogControlBorder min-h-[118px] p-[18px]" onClick={onOpenUpload}>
              <span className="text-[18px] font-extrabold">노래</span>
              <small className="text-[12px] text-[#bdbdbd]">MP3/WAV 업로드</small>
            </button>
          </div>
        </section>
      )}

      {view === "export" && (
        <section className="modalPanel w-[min(620px,calc(100vw_-_40px))]" role="dialog" aria-modal="true" aria-label="내보내기">
          <CloseButton onClose={onClose} />
          <strong>내보내기</strong>
          <label className="flex flex-wrap items-center gap-[10px] text-ui text-muted">
            파일 형식
            <select className="dialogSelect" value={exportFormat} disabled={exportBusy} onChange={(event) => onExportFormatChange(event.target.value as AudioFormat)}>
              <option value="wav">WAV · PCM</option>
              <option value="flac">FLAC · 무손실 압축</option>
              <option value="m4a">M4A · AAC</option>
            </select>
          </label>
          {analysis && !analysis.stem_audio && <small>이전 작업의 저장된 스템에서 변환합니다. AAC 원본의 손실은 복원되지 않습니다.</small>}
          <div className="exportChoices grid grid-cols-[minmax(150px,0.85fr)_minmax(240px,1.15fr)] gap-[12px] [@media(max-width:640px)]:grid-cols-1">
            <div className="grid [align-content:start] gap-ui">
              <button className={exportButtonClass} disabled={exportBusy} onClick={() => void onExportWhole()}>전체 믹스 다운로드</button>
              <button className={exportButtonClass} disabled={exportBusy} onClick={onExportInstrumental}>Instrumental 다운로드</button>
              <button className={exportButtonClass} disabled={exportBusy} onClick={onExportAllStems}>6개 스템 ZIP 다운로드</button>
            </div>
            <div className="grid min-h-[180px] [align-content:start] gap-[10px] rounded-control border border-solid border-control bg-(image:--control-gradient) p-[18px] text-primary">
              <span className="text-[18px] font-extrabold">파트별</span>
              <div className="grid grid-cols-2 gap-ui">
                {exportableStems.map((stem) => (
                  <div className="flex gap-[4px]" key={stem.name}>
                    <label className="flex min-h-[30px] flex-[1] items-center gap-[7px] rounded-[5px] border border-solid border-[#4f4f4f] bg-[#2d2d2d] px-ui py-[5px] text-ui font-extrabold text-primary">
                      <input className="accent-check"
                        type="checkbox"
                        checked={exportStemSelection.includes(stem.name)}
                        disabled={exportBusy}
                        onChange={() => onToggleExportStem(stem.name)}
                      />
                      <b className="size-[10px] rounded-[50%]" style={{ background: stem.color }} />
                      {STEM_LABELS[stem.name]}
                    </label>
                    <button className={exportButtonClass} type="button" disabled={exportBusy} onClick={() => onExportSingle(stem.name)} aria-label={`${STEM_LABELS[stem.name]} 다운로드`}>↓</button>
                  </div>
                ))}
              </div>
              <label className="flex min-h-[34px] items-center gap-ui rounded-[5px] border border-solid border-control bg-raised px-[9px] py-[6px] text-ui font-extrabold text-[#f2f2f2]">
                <input
                  className="accent-check"
                  type="checkbox"
                  checked={exportSeparateStems}
                  disabled={exportBusy}
                  onChange={(event) => onExportSeparateChange(event.target.checked)}
                />
                선택한 파트를 ZIP으로 묶기
              </label>
              <button className="dialogControl min-h-[42px] border-[#68d7e5] px-[14px] py-[10px]" disabled={exportBusy || !exportStemSelection.length} onClick={() => void onExportSelected()}>
                선택한 파트 {exportSeparateStems ? "ZIP" : "믹스"} 다운로드
              </button>
            </div>
          </div>
          {exportBusy && <small role="status">내보내는 중</small>}
          {error && <p className="m-0 text-ui font-extrabold text-failure">{error}</p>}
        </section>
      )}

      {view === "upload" && (
        <section className="modalPanel modalWidth" role="dialog" aria-modal="true" aria-label="노래 업로드">
          <CloseButton onClose={onClose} />
          <strong>노래 업로드</strong>
          <label className="flex flex-wrap items-center gap-[10px] text-ui text-muted">
            분리 품질
            <select className="dialogSelect" value={separationQuality} disabled={uploadBusy} onChange={(event) => onQualityChange(event.target.value as SeparationQuality)}>
              <option value="standard">Standard</option>
              <option value="high">High Quality</option>
            </select>
          </label>
          {separationQuality === "high" && <small>여러 번 추론하므로 더 오래 걸리며, 개선 폭은 곡에 따라 다릅니다.</small>}
          <label className="flex flex-wrap items-center gap-[10px] text-ui text-muted">
            분리 엔진
            <select className="dialogSelect" value={separationEngine} disabled={uploadBusy} onChange={(event) => onEngineChange(event.target.value as SeparationEngine | "")}>
              <option value="">서버 기본값</option>
              <option value="torch">PyTorch</option>
              <option value="mps">PyTorch MPS · Mac</option>
              <option value="mlx">Fast · MLX · Apple Silicon</option>
            </select>
          </label>
          <label className="flex flex-wrap items-center gap-[10px] text-ui text-muted">
            <input type="checkbox" checked={stemsOnly} disabled={uploadBusy} onChange={(event) => onStemsOnlyChange(event.target.checked)} />
            스템만 분리 (BPM·키·코드 및 MIDI 생략)
          </label>
          <label className="dialogControl dialogControlBorder relative min-h-[110px] overflow-hidden p-[18px] text-center">
            <input
              className="absolute inset-0 m-0 h-full w-full cursor-pointer p-0 opacity-0"
              type="file"
              disabled={uploadBusy}
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void onFile(file);
              }}
            />
            <span className="text-[18px] font-extrabold">{fileName || "파일 선택"}</span>
            <small className="text-[12px] text-[#bdbdbd]">MP3 또는 WAV</small>
          </label>
          <div className="uploadStatus grid grid-cols-[1fr_auto] gap-[10px] rounded-ui border border-solid border-[#252525] bg-[#252525] p-[14px] text-ui text-[#cfcfcf]">
            <span>{uploadBusy ? "업로드 중" : status}</span>
            <strong>{progress}%</strong>
            <div className="meterBar">
              <div style={{ width: `${progress}%` }} />
            </div>
            <p>{error || job?.error ? normalizeErrorMessage(error ?? job?.error) : uploadBusy ? "파일을 전송하고 있습니다." : message}</p>
            {job?.separation_error && <p className="separationNotice failed">{job.separation_error}</p>}
          </div>
        </section>
      )}
    </div>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button className="absolute top-[10px] right-[10px] size-[32px] cursor-pointer rounded-[5px] [border:0] bg-transparent text-[24px] leading-none text-[#dcdcdc] [&:hover]:bg-selected" aria-label="닫기" onClick={onClose}>×</button>
  );
}
