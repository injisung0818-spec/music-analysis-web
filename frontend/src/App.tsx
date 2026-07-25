import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { assetUrl, fetchAnalysis, fetchJob, uploadAudio } from "./api";
import type { Analysis, JobResponse, StemName, TrackState } from "./types";
import iconBass from "./assets/figma-icons/bass.svg";
import iconDrums from "./assets/figma-icons/drums.svg";
import iconExport from "./assets/figma-icons/export.svg";
import iconGuitar from "./assets/figma-icons/guitar.svg";
import iconList from "./assets/figma-icons/list.svg";
import iconLyrics from "./assets/figma-icons/lyrics.svg";
import iconMetronome from "./assets/figma-icons/metronome.svg";
import iconMic from "./assets/figma-icons/mic.svg";
import iconMore from "./assets/figma-icons/more.svg";
import iconMoreFill from "./assets/figma-icons/more-fill.svg";
import iconNext from "./assets/figma-icons/next.svg";
import iconNotes from "./assets/figma-icons/notes.svg";
import iconPiano from "./assets/figma-icons/piano.svg";
import iconPlay from "./assets/figma-icons/play.svg";
import iconPlus from "./assets/figma-icons/plus.svg";
import iconPrev from "./assets/figma-icons/prev.svg";
import iconProfile from "./assets/figma-icons/profile.svg";
import iconRepeat from "./assets/figma-icons/repeat.svg";
import iconSettings from "./assets/figma-icons/settings.svg";
import iconSpeaker from "./assets/figma-icons/speaker.svg";

const INITIAL_TRACKS: Record<StemName, TrackState> = {
  vocals: { muted: false, solo: false, volume: 0.9 },
  drums: { muted: false, solo: false, volume: 0.88 },
  bass: { muted: false, solo: false, volume: 0.86 },
  guitar: { muted: false, solo: false, volume: 0.78 },
  piano: { muted: false, solo: false, volume: 0.78 },
  other: { muted: false, solo: false, volume: 0.72 }
};

const STEM_LABELS: Record<StemName, string> = {
  vocals: "보컬",
  drums: "드럼",
  bass: "베이스",
  guitar: "기타",
  piano: "피아노",
  other: "나머지"
};

const STEM_ICONS: Record<StemName, string> = {
  vocals: iconMic,
  drums: iconDrums,
  bass: iconBass,
  guitar: iconGuitar,
  piano: iconPiano,
  other: iconMoreFill
};

const TOOL_ICONS: Record<string, string> = {
  list: iconList,
  gear: iconSettings,
  profile: iconProfile,
  rewind: iconPrev,
  forward: iconNext,
  play: iconPlay,
  speaker: iconSpeaker,
  metronome: iconMetronome,
  notes: iconNotes,
  lyrics: iconLyrics,
  repeat: iconRepeat,
  more: iconMore,
  upload: iconExport,
  plus: iconPlus
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
  "Writing results": "결과 저장 중",
  "Analysis complete": "분석 완료",
  "Processing failed": "처리 실패"
};

type LibraryFolder = {
  id: string;
  name: string;
  open: boolean;
};

type LibrarySong = {
  id: string;
  title: string;
};

type ModalView = "add" | "upload" | null;

export default function App() {
  const [job, setJob] = useState<JobResponse | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [tracks, setTracks] = useState(INITIAL_TRACKS);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [volumeOpen, setVolumeOpen] = useState(false);
  const [songInfoOpen, setSongInfoOpen] = useState(false);
  const [modalView, setModalView] = useState<ModalView>(null);
  const [folders, setFolders] = useState<LibraryFolder[]>([]);
  const [songs, setSongs] = useState<LibrarySong[]>([]);
  const [activeSongId, setActiveSongId] = useState<string | null>(null);
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState("");
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [chordsVisible, setChordsVisible] = useState(true);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);
  const [globalVolume, setGlobalVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const rafRef = useRef<number | null>(null);

  const soloActive = useMemo(() => Object.values(tracks).some((track) => track.solo), [tracks]);
  const duration = analysis?.duration ?? 0;
  const bpm = analysis?.bpm && analysis.bpm > 0 ? analysis.bpm : 127;
  const beatLength = 60 / bpm;
  const bar = Math.max(1, Math.floor(currentTime / (beatLength * 4)) + 1);
  const beat = Math.max(1, Math.floor((currentTime % (beatLength * 4)) / beatLength) + 1);
  const div = Math.max(1, Math.floor((currentTime % beatLength) / (beatLength / 4)) + 1);
  const tick = Math.max(0, Math.floor(((currentTime % (beatLength / 4)) / (beatLength / 4)) * 120));
  const transportKey = analysis ? `${analysis.key} ${modeLabel(analysis.mode)}` : "Cmin";
  const progress = Math.round((job?.progress ?? 0) * 100);
  const stems = analysis?.stems ?? stemPlaceholders();
  const modalOpen = modalView !== null;

  useEffect(() => {
    if (!job || job.status === "done" || job.status === "error") return;
    const timer = window.setInterval(async () => {
      try {
        const next = await fetchJob(job.id);
        setJob(next);
        if (next.status === "done") {
          const result = await fetchAnalysis(next.id);
          setAnalysis(result);
        }
      } catch (pollError) {
        setError(String(pollError));
      }
    }, 1200);
    return () => window.clearInterval(timer);
  }, [job]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tickFrame = () => {
      const first = firstPlayableAudio();
      if (first) setCurrentTime(first.currentTime);
      rafRef.current = requestAnimationFrame(tickFrame);
    };
    rafRef.current = requestAnimationFrame(tickFrame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, analysis]);

  useEffect(() => {
    if (!analysis) return;
    for (const stem of analysis.stems) {
      const audio = audioRefs.current[stem.name];
      if (!audio) continue;
      const state = tracks[stem.name];
      audio.volume = state.volume * globalVolume;
      audio.muted = state.muted || (soloActive && !state.solo);
      audio.loop = repeatOn;
    }
  }, [tracks, soloActive, analysis, globalVolume, repeatOn]);

  async function handleFile(file: File) {
    setError(null);
    setAnalysis(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setSongInfoOpen(false);
    setUploadFileName(file.name);
    setModalView("upload");
    const songId = createId();
    setSongs((prev) => [...prev, { id: songId, title: file.name }]);
    setActiveSongId(songId);
    try {
      const created = await uploadAudio(file);
      setJob(created);
    } catch (uploadError) {
      setError(String(uploadError));
    }
  }

  function firstPlayableAudio() {
    if (!analysis) return null;
    for (const stem of analysis.stems) {
      const audio = audioRefs.current[stem.name];
      if (audio && audio.readyState >= 1) return audio;
    }
    return null;
  }

  async function togglePlayback() {
    if (!analysis) return;
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    const audible = analysis.stems
      .map((stem) => audioRefs.current[stem.name])
      .filter((audio): audio is HTMLAudioElement => Boolean(audio));
    if (nextPlaying) {
      await Promise.allSettled(
        audible.map(async (audio) => {
          audio.currentTime = Math.min(currentTime, Math.max(0, audio.duration || duration));
          await audio.play();
        })
      );
    } else {
      pauseAll();
    }
  }

  function pauseAll() {
    Object.values(audioRefs.current).forEach((audio) => audio?.pause());
  }

  function stopPlayback() {
    setIsPlaying(false);
    pauseAll();
    seek(0);
  }

  function seek(time: number) {
    const clamped = Math.max(0, Math.min(time, duration || 30));
    setCurrentTime(clamped);
    Object.values(audioRefs.current).forEach((audio) => {
      if (audio) audio.currentTime = clamped;
    });
  }

  function updateTrack(name: StemName, patch: Partial<TrackState>) {
    setTracks((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  function addFolder() {
    const id = createId();
    setFolders((prev) => [...prev, { id, name: "새로운 폴더", open: true }]);
    setEditingFolderId(id);
    setModalView(null);
  }

  function updateFolderName(id: string, name: string) {
    const safeName = name.trim() || "새로운 폴더";
    setFolders((prev) => prev.map((folder) => (folder.id === id ? { ...folder, name: safeName } : folder)));
    setEditingFolderId(null);
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <div className="toolbarGroup appTools">
          <button className="toolButton" data-tooltip="노래 목록 접고 열기" aria-label="노래 목록 접고 열기" onClick={() => setLibraryOpen((open) => !open)}><Icon name="list" /></button>
          <button className={`toolButton ${settingsOpen ? "active" : ""}`} data-tooltip="설정" aria-label="설정" onClick={() => setSettingsOpen((open) => !open)}><Icon name="gear" /></button>
          <button className={`toolButton ${profileOpen ? "active" : ""}`} data-tooltip="마이페이지" aria-label="마이페이지" onClick={() => setProfileOpen((open) => !open)}><Icon name="profile" /></button>
        </div>

        <div className="toolbarGroup projectSlots" aria-label="프로젝트 슬롯">
          <button className="toolButton ghostSlot" data-tooltip="비어 있음" aria-label="비어 있음" disabled />
          <button className="toolButton ghostSlot" data-tooltip="비어 있음" aria-label="비어 있음" disabled />
          <button className="toolButton ghostSlot" data-tooltip="비어 있음" aria-label="비어 있음" disabled />
        </div>

        <div className="toolbarSpacer narrow" aria-hidden="true" />

        <div className="toolbarGroup transportCluster">
          <button className="toolButton" data-tooltip="이전곡" aria-label="이전곡" onClick={() => seek(0)}><Icon name="rewind" /></button>
          <button className="toolButton" data-tooltip="다음곡" aria-label="다음곡" onClick={() => seek(duration || 30)}><Icon name="forward" /></button>
          <button className="toolButton" data-tooltip="멈춤" aria-label="멈춤" onClick={stopPlayback}><Icon name="stop" /></button>
          <button className="toolButton playButton" data-tooltip="재생" aria-label="재생" onClick={togglePlayback} disabled={!analysis}>
            <Icon name={isPlaying ? "pause" : "play"} />
          </button>
          <button className={`toolButton ${volumeOpen ? "active" : ""}`} data-tooltip="소리 크기" aria-label="소리 크기" onClick={() => setVolumeOpen((open) => !open)}><Icon name="speaker" /></button>
        </div>

        <div className="lcd" data-tooltip="여러가지 노래 정보" role="button" tabIndex={0} onClick={() => setSongInfoOpen((open) => !open)}>
          <span className="songName">{analysis?.original_filename ?? "노래 이름"}</span>
          <Metric value={String(bar).padStart(3, "0")} label="BAR" />
          <Metric value={String(beat)} label="BEAT" />
          <Metric value={String(div)} label="DIV" />
          <Metric value={String(tick).padStart(3, "0")} label="TICK" />
          <Metric value={String(Math.round(bpm))} label="TEMPO" />
          <Metric value={transportKey} label="KEY" />
          <Metric value="4/4" label="TIME" />
        </div>

        <div className="toolbarTail">
          <div className="toolbarGroup analysisTools">
            <button className={`toolButton ${metronomeOn ? "active" : ""}`} data-tooltip="메트로놈" aria-label="메트로놈" onClick={() => setMetronomeOn((on) => !on)}><Icon name="metronome" /></button>
            <button className={`toolButton ${chordsVisible ? "active" : ""}`} data-tooltip="코드 보기" aria-label="코드 보기" onClick={() => setChordsVisible((visible) => !visible)}><Icon name="notes" /></button>
          </div>
          <div className="toolbarGroup lyricTools">
            <button className={`toolButton ${lyricsVisible ? "active" : ""}`} data-tooltip="가사" aria-label="가사" onClick={() => setLyricsVisible((visible) => !visible)}><Icon name="lyrics" /></button>
            <button className={`toolButton ${repeatOn ? "active" : ""}`} data-tooltip="연속 재생" aria-label="연속 재생" onClick={() => setRepeatOn((on) => !on)}><Icon name="repeat" /></button>
          </div>
          <div className="toolbarSpacer wide" aria-hidden="true" />
          <div className="toolbarGroup outputTools">
            <button className="toolButton" data-tooltip="더보기" aria-label="더보기"><Icon name="more" /></button>
            <button className="toolButton exportButton" data-tooltip="내보내기" aria-label="내보내기"><Icon name="upload" /></button>
            <button className="toolButton" data-tooltip="추가" aria-label="추가" onClick={() => setModalView("add")}><Icon name="plus" /></button>
          </div>
        </div>

        <TopPopovers
          settingsOpen={settingsOpen}
          profileOpen={profileOpen}
          volumeOpen={volumeOpen}
          songInfoOpen={songInfoOpen}
          metronomeOn={metronomeOn}
          repeatOn={repeatOn}
          globalVolume={globalVolume}
          onVolume={setGlobalVolume}
          analysis={analysis}
          job={job}
        />
      </header>

      <section
        className={`studio ${isDragging ? "dragging" : ""} ${libraryOpen ? "" : "libraryCollapsed"}`}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          const file = event.dataTransfer.files?.[0];
          if (file) void handleFile(file);
        }}
      >
        {libraryOpen && <aside className="library">
          {folders.map((folder) => (
            <LibraryRow
              key={folder.id}
              open={folder.open}
              label={folder.name}
              editing={editingFolderId === folder.id}
              onRename={(name) => updateFolderName(folder.id, name)}
              onEdit={() => setEditingFolderId(folder.id)}
              onToggle={() => setFolders((prev) => prev.map((item) => (item.id === folder.id ? { ...item, open: !item.open } : item)))}
            />
          ))}
          {songs.map((song) => (
            <SongRow
              key={song.id}
              label={song.title}
              active={activeSongId === song.id}
              onSelect={() => setActiveSongId(song.id)}
            />
          ))}
          {!folders.length && !songs.length && (
            <div className="emptyLibrary">오른쪽 + 버튼으로 폴더나 노래를 추가하세요</div>
          )}
        </aside>}

        <section className="arranger">
          <div className="trackHeaderSpacer" />
          <Ruler currentTime={currentTime} duration={duration || 30} onSeek={seek} />
          {stems.map((stem) => (
            <TrackRow
              key={stem.name}
              name={stem.name}
              color={stem.color}
              waveform={stem.waveform}
              state={tracks[stem.name]}
              duration={duration || 30}
              currentTime={currentTime}
              onSeek={seek}
              onUpdate={updateTrack}
            />
          ))}
          {analysis?.stems.map((stem) => (
            <audio
              key={stem.name}
              ref={(node) => {
                audioRefs.current[stem.name] = node;
              }}
              src={assetUrl(stem.audio_url) ?? undefined}
              onEnded={() => setIsPlaying(false)}
            />
          ))}
        </section>

        <section className="editorPanel">
          <div className="editorTitle">
            <strong>{lyricsVisible ? "가사" : "분석"}</strong>
            <span>{analysis ? `${formatTime(analysis.duration)} · ${analysis.chords.length}개 코드 · ${analysis.beats.length}개 비트` : "분석 결과 대기 중"}</span>
          </div>
          {chordsVisible && <ChordTimeline analysis={analysis} currentTime={currentTime} onSeek={seek} />}
          {lyricsVisible && <LyricsPanel title={analysis?.original_filename ?? "노래 이름"} />}
          <div className="editorDetails">
            <span>BPM <strong>{analysis ? Math.round(analysis.bpm) : "--"}</strong></span>
            <span>KEY <strong>{analysis ? `${analysis.key} ${modeLabel(analysis.mode)}` : "--"}</strong></span>
            <span>MIDI <strong>{analysis ? analysis.stems.filter((stem) => stem.midi_url).length : 0}</strong></span>
            <span>METRO <strong>{metronomeOn ? "ON" : "OFF"}</strong></span>
            <span>LOOP <strong>{repeatOn ? "ON" : "OFF"}</strong></span>
            {(error || job?.error) && <em>{error ?? job?.error}</em>}
          </div>
          {(job?.warnings.length || analysis?.warnings.length) ? (
            <div className="warnings">
              {(analysis?.warnings ?? job?.warnings ?? []).map((warning, index) => <p key={`${warning}-${index}`}>{translateWarning(warning)}</p>)}
            </div>
          ) : null}
        </section>
      </section>

      {modalOpen && (
        <ModalLayer
          view={modalView}
          fileName={uploadFileName}
          job={job}
          progress={progress}
          error={error}
          onClose={() => setModalView(null)}
          onAddFolder={addFolder}
          onOpenUpload={() => setModalView("upload")}
          onFile={handleFile}
        />
      )}
    </main>
  );
}

function Metric({ value, label }: { value: string; label: string }) {
  return (
    <div className="metric">
      <strong>{value}</strong>
      <small>{label}</small>
    </div>
  );
}

function Icon({ name }: { name: string }) {
  if (name === "stop") return <span className="uiIcon stopGlyph" aria-hidden="true" />;
  if (name === "play") return <span className="uiIcon playGlyph" aria-hidden="true" />;
  if (name === "pause") return <span className="uiIcon pauseGlyph" aria-hidden="true" />;
  return <img className={`uiIcon ${name}`} src={TOOL_ICONS[name]} alt="" aria-hidden="true" />;
}

function TopPopovers({
  settingsOpen,
  profileOpen,
  volumeOpen,
  songInfoOpen,
  metronomeOn,
  repeatOn,
  globalVolume,
  onVolume,
  analysis,
  job
}: {
  settingsOpen: boolean;
  profileOpen: boolean;
  volumeOpen: boolean;
  songInfoOpen: boolean;
  metronomeOn: boolean;
  repeatOn: boolean;
  globalVolume: number;
  onVolume: (value: number) => void;
  analysis: Analysis | null;
  job: JobResponse | null;
}) {
  return (
    <div className="topPopovers" aria-live="polite">
      {settingsOpen && (
        <div className="popover settingsPopover">
          <strong>설정</strong>
          <span>로컬 처리 · 6 stems · MIDI 추출</span>
        </div>
      )}
      {profileOpen && (
        <div className="popover profilePopover">
          <strong>마이페이지</strong>
          <span>무료 로컬 세션</span>
        </div>
      )}
      {volumeOpen && (
        <div className="popover volumePopover">
          <strong>소리 크기</strong>
          <input
            aria-label="전체 볼륨"
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={globalVolume}
            onChange={(event) => onVolume(Number(event.target.value))}
          />
          <span>{Math.round(globalVolume * 100)}%</span>
        </div>
      )}
      {songInfoOpen && (
        <div className="popover infoPopover">
          <strong>{analysis?.original_filename ?? "노래 정보"}</strong>
          <span>{analysis ? `${formatTime(analysis.duration)} · ${Math.round(analysis.bpm)} BPM · ${analysis.key} ${modeLabel(analysis.mode)}` : statusLabel(job?.status ?? "ready")}</span>
          <small>메트로놈 {metronomeOn ? "켜짐" : "꺼짐"} · 연속 재생 {repeatOn ? "켜짐" : "꺼짐"}</small>
        </div>
      )}
    </div>
  );
}

function LyricsPanel({ title }: { title: string }) {
  return (
    <div className="lyricsPanel">
      <strong>{title}</strong>
      <p>가사 파일이 아직 연결되지 않았습니다.</p>
      <p>다음 단계에서 LRC/TXT 업로드나 자동 가사 타임라인을 붙일 수 있습니다.</p>
    </div>
  );
}

function ModalLayer({
  view,
  fileName,
  job,
  progress,
  error,
  onClose,
  onAddFolder,
  onOpenUpload,
  onFile
}: {
  view: ModalView;
  fileName: string;
  job: JobResponse | null;
  progress: number;
  error: string | null;
  onClose: () => void;
  onAddFolder: () => void;
  onOpenUpload: () => void;
  onFile: (file: File) => void | Promise<void>;
}) {
  const status = statusLabel(job?.status ?? "ready");
  const message = messageLabel(job?.message) ?? (fileName ? "파일 분석을 준비 중입니다" : "MP3 또는 WAV 파일을 선택하세요");
  return (
    <div className="modalOverlay" role="presentation">
      {view === "add" && (
        <section className="modalPanel addModal" role="dialog" aria-modal="true" aria-label="추가">
          <button className="modalClose" aria-label="닫기" onClick={onClose}>×</button>
          <strong>추가</strong>
          <div className="addChoices">
            <button onClick={onAddFolder}>
              <span>폴더</span>
              <small>새로운 폴더 생성</small>
            </button>
            <button onClick={onOpenUpload}>
              <span>노래</span>
              <small>MP3/WAV 업로드</small>
            </button>
          </div>
        </section>
      )}

      {view === "upload" && (
        <section className="modalPanel uploadModal" role="dialog" aria-modal="true" aria-label="노래 업로드">
          <button className="modalClose" aria-label="닫기" onClick={onClose}>×</button>
          <strong>노래 업로드</strong>
          <label className="fileDropButton">
            <input
              type="file"
              accept=".mp3,.wav,audio/mpeg,audio/wav"
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.currentTarget.value = "";
                if (file) void onFile(file);
              }}
            />
            <span>{fileName || "파일 선택"}</span>
            <small>MP3 또는 WAV</small>
          </label>
          <div className="uploadStatus">
            <span>{status}</span>
            <strong>{progress}%</strong>
            <div className="meterBar">
              <div style={{ width: `${progress}%` }} />
            </div>
            <p>{error ?? job?.error ?? message}</p>
          </div>
        </section>
      )}
    </div>
  );
}

function LibraryRow({
  open,
  label,
  editing,
  onRename,
  onEdit,
  onToggle
}: {
  open: boolean;
  label: string;
  editing: boolean;
  onRename: (name: string) => void;
  onEdit: () => void;
  onToggle: () => void;
}) {
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    setDraft(label);
  }, [label, editing]);

  return (
    <div className="libraryFolder" onDoubleClick={onEdit}>
      <button aria-label={open ? "폴더 닫기" : "폴더 열기"} onClick={onToggle}>{open ? "▼" : "▶"}</button>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRename(draft);
            if (event.key === "Escape") onRename(label);
          }}
        />
      ) : (
        <strong>{label}</strong>
      )}
    </div>
  );
}

function SongRow({ label, active = false, onSelect }: { label: string; active?: boolean; onSelect: () => void }) {
  return (
    <div className={`songRow ${active ? "active" : ""}`} onClick={onSelect}>
      <span className="tinyWave">▥</span>
      <strong>{label}</strong>
      <button aria-label="더보기">⋮</button>
    </div>
  );
}

function Ruler({ currentTime, duration, onSeek }: { currentTime: number; duration: number; onSeek: (time: number) => void }) {
  return (
    <div
      className="ruler"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    >
      <div className="rulerTicks">
        {Array.from({ length: 48 }).map((_, index) => <i key={index} />)}
      </div>
      <b style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
    </div>
  );
}

function TrackRow({
  name,
  color,
  waveform,
  state,
  duration,
  currentTime,
  onSeek,
  onUpdate
}: {
  name: StemName;
  color: string;
  waveform: number[];
  state: TrackState;
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
  onUpdate: (name: StemName, patch: Partial<TrackState>) => void;
}) {
  const peaks = waveform.length ? waveform : Array.from({ length: 96 }, (_, i) => 0.25 + Math.abs(Math.sin(i * 0.21)) * 0.45);
  return (
    <>
      <div className="trackControls" style={{ "--accent": color } as CSSProperties}>
        <div className="stemIcon">
          <img src={STEM_ICONS[name]} alt="" aria-hidden="true" />
        </div>
        <div className="trackMeta">
          <strong>{STEM_LABELS[name]}</strong>
          <div className="trackButtons">
            <button className={state.muted ? "active" : ""} onClick={() => onUpdate(name, { muted: !state.muted })}>M</button>
            <button className={state.solo ? "solo active" : ""} onClick={() => onUpdate(name, { solo: !state.solo })}>S</button>
          </div>
        </div>
        <input
          aria-label={`${STEM_LABELS[name]} 볼륨`}
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={state.volume}
          onChange={(event) => onUpdate(name, { volume: Number(event.target.value) })}
        />
        <span className="panKnob" />
      </div>
      <div
        className="regionLane"
        style={{ "--accent": color } as CSSProperties}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          onSeek(((event.clientX - rect.left) / rect.width) * duration);
        }}
      >
        <div className="region">
          <div className="regionWave">
            {peaks.map((peak, index) => <span key={index} style={{ height: `${Math.max(4, peak * 56)}px` }} />)}
          </div>
        </div>
        <i className="playhead" style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
      </div>
    </>
  );
}

function ChordTimeline({ analysis, currentTime, onSeek }: { analysis: Analysis | null; currentTime: number; onSeek: (time: number) => void }) {
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
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
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
      <i style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
    </div>
  );
}

function statusLabel(status: string) {
  return STATUS_LABELS[status] ?? status;
}

function messageLabel(message?: string) {
  if (!message) return null;
  return MESSAGE_LABELS[message] ?? message;
}

function modeLabel(mode: string) {
  if (mode === "major") return "장조";
  if (mode === "minor") return "단조";
  return mode;
}

function translateWarning(warning: string) {
  if (warning.includes("ffmpeg not found") && warning.includes("MP3 conversion")) {
    return "ffmpeg가 설치되어 있지 않아 MP3 변환을 건너뛰고 테스트용 무음 오디오로 처리했습니다.";
  }
  if (warning.includes("ffmpeg not found") && warning.includes("copied WAV")) {
    return "ffmpeg가 설치되어 있지 않아 WAV 파일을 변환 없이 복사했습니다.";
  }
  if (warning.includes("demucs command not found")) {
    return "demucs 명령을 찾을 수 없어 실제 스템 분리 대신 fallback stems를 생성했습니다.";
  }
  if (warning.includes("Demucs finished but did not produce all 6 stems")) {
    return "Demucs가 완료됐지만 6개 stem이 모두 생성되지 않아 fallback stems를 생성했습니다.";
  }
  if (warning.includes("Demucs unavailable or failed")) {
    return "Demucs 실행에 실패해 fallback stems를 생성했습니다.";
  }
  if (warning.includes("librosa analysis unavailable or failed")) {
    return "librosa가 설치되어 있지 않거나 분석에 실패해 임시 BPM/key/chord 분석 결과를 생성했습니다.";
  }
  if (warning.includes("basic-pitch unavailable or failed")) {
    return "basic-pitch가 설치되어 있지 않거나 MIDI 추출에 실패해 placeholder MIDI 파일을 생성했습니다.";
  }
  return warning;
}

function stemPlaceholders() {
  return [
    { name: "vocals" as StemName, color: "#69caec", waveform: [] },
    { name: "drums" as StemName, color: "#72d1dc", waveform: [] },
    { name: "bass" as StemName, color: "#80dce4", waveform: [] },
    { name: "guitar" as StemName, color: "#97edf2", waveform: [] },
    { name: "piano" as StemName, color: "#c7fbfd", waveform: [] },
    { name: "other" as StemName, color: "#e8fbfc", waveform: [] }
  ];
}

function formatTime(seconds: number) {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0);
  const mins = Math.floor(safe / 60).toString().padStart(2, "0");
  const secs = Math.floor(safe % 60).toString().padStart(2, "0");
  const millis = Math.floor((safe % 1) * 100).toString().padStart(2, "0");
  return `${mins}:${secs}.${millis}`;
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
