import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
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
  folderId: string | null;
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
  const [libraryWidth, setLibraryWidth] = useState(286);
  const [trackControlsWidth, setTrackControlsWidth] = useState(620);
  const [editorHeight, setEditorHeight] = useState(294);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [chordsVisible, setChordsVisible] = useState(true);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);
  const [globalVolume, setGlobalVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const rafRef = useRef<number | null>(null);
  const controlsScrollRef = useRef<HTMLDivElement | null>(null);
  const lanesScrollRef = useRef<HTMLDivElement | null>(null);
  const rulerScrollRef = useRef<HTMLDivElement | null>(null);
  const syncingScrollRef = useRef(false);

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
  const displayDuration = duration || 120;
  const timelineWidth = Math.max(1600, Math.round(displayDuration * 42));
  const currentChord = useMemo(() => getCurrentChord(analysis, currentTime), [analysis, currentTime]);
  const rootStyle = {
    "--library-width": `${libraryWidth}px`,
    "--controls-width": `${trackControlsWidth}px`,
    "--editor-height": `${editorHeight}px`
  } as CSSProperties;

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

  useEffect(() => {
    if (!isPlaying || !lanesScrollRef.current || !rulerScrollRef.current) return;
    const lane = lanesScrollRef.current;
    const playheadX = (currentTime / displayDuration) * timelineWidth;
    const margin = Math.min(280, lane.clientWidth * 0.28);
    const visibleLeft = lane.scrollLeft;
    const visibleRight = visibleLeft + lane.clientWidth;
    if (playheadX > visibleRight - margin) {
      const nextLeft = Math.min(playheadX - lane.clientWidth + margin, lane.scrollWidth - lane.clientWidth);
      lane.scrollLeft = Math.max(0, nextLeft);
      rulerScrollRef.current.scrollLeft = lane.scrollLeft;
    } else if (playheadX < visibleLeft + 80) {
      lane.scrollLeft = Math.max(0, playheadX - 80);
      rulerScrollRef.current.scrollLeft = lane.scrollLeft;
    }
  }, [currentTime, displayDuration, isPlaying, timelineWidth]);

  async function handleFile(file: File) {
    setError(null);
    setAnalysis(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setSongInfoOpen(false);
    setUploadFileName(file.name);
    setModalView("upload");
    const songId = createId();
    setSongs((prev) => [...prev, { id: songId, title: file.name, folderId: null }]);
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

  function syncVerticalScroll(source: "controls" | "lanes") {
    if (syncingScrollRef.current) return;
    const from = source === "controls" ? controlsScrollRef.current : lanesScrollRef.current;
    const to = source === "controls" ? lanesScrollRef.current : controlsScrollRef.current;
    if (!from || !to) return;
    syncingScrollRef.current = true;
    to.scrollTop = from.scrollTop;
    requestAnimationFrame(() => {
      syncingScrollRef.current = false;
    });
  }

  function syncHorizontalScroll() {
    if (rulerScrollRef.current && lanesScrollRef.current) {
      rulerScrollRef.current.scrollLeft = lanesScrollRef.current.scrollLeft;
    }
    syncVerticalScroll("lanes");
  }

  function beginResize(kind: "library" | "tracks" | "editor", event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startLibrary = libraryWidth;
    const startTracks = trackControlsWidth;
    const startEditor = editorHeight;

    const handleMove = (moveEvent: MouseEvent) => {
      if (kind === "library") {
        setLibraryWidth(clamp(startLibrary + moveEvent.clientX - startX, 220, 460));
      }
      if (kind === "tracks") {
        setTrackControlsWidth(clamp(startTracks + moveEvent.clientX - startX, 420, 860));
      }
      if (kind === "editor") {
        setEditorHeight(clamp(startEditor - (moveEvent.clientY - startY), 170, 520));
      }
    };

    const stopMove = () => {
      window.removeEventListener("mousemove", handleMove);
      window.removeEventListener("mouseup", stopMove);
    };

    window.addEventListener("mousemove", handleMove);
    window.addEventListener("mouseup", stopMove);
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

  function moveSongToFolder(songId: string, folderId: string | null) {
    setFolders((prev) => prev.map((folder) => (folder.id === folderId ? { ...folder, open: true } : folder)));
    setSongs((prev) => prev.map((song) => (song.id === songId ? { ...song, folderId } : song)));
  }

  return (
    <main className="appShell" style={rootStyle}>
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

        <div className="lcd" role="button" tabIndex={0} onClick={() => setSongInfoOpen((open) => !open)}>
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
        {libraryOpen && <aside
          className="library"
          onDragOver={(event) => {
            if (Array.from(event.dataTransfer.types).includes("application/x-song-id")) {
              event.preventDefault();
              event.stopPropagation();
            }
          }}
          onDrop={(event) => {
            const songId = event.dataTransfer.getData("application/x-song-id");
            if (!songId || (event.target as HTMLElement).closest(".libraryGroup")) return;
            event.preventDefault();
            event.stopPropagation();
            moveSongToFolder(songId, null);
          }}
        >
          {folders.map((folder) => (
            <div
              className="libraryGroup"
              key={folder.id}
              onDragOver={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onDrop={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const songId = event.dataTransfer.getData("application/x-song-id");
                if (songId) moveSongToFolder(songId, folder.id);
              }}
            >
              <LibraryRow
                open={folder.open}
                label={folder.name}
                editing={editingFolderId === folder.id}
                onRename={(name) => updateFolderName(folder.id, name)}
                onEdit={() => setEditingFolderId(folder.id)}
                onToggle={() => setFolders((prev) => prev.map((item) => (item.id === folder.id ? { ...item, open: !item.open } : item)))}
              />
              {folder.open && songs.filter((song) => song.folderId === folder.id).map((song) => (
                <SongRow
                  key={song.id}
                  id={song.id}
                  label={song.title}
                  nested
                  active={activeSongId === song.id}
                  onSelect={() => setActiveSongId(song.id)}
                />
              ))}
            </div>
          ))}
          {songs.filter((song) => song.folderId === null).map((song) => (
            <SongRow
              key={song.id}
              id={song.id}
              label={song.title}
              active={activeSongId === song.id}
              onSelect={() => setActiveSongId(song.id)}
            />
          ))}
          {!folders.length && !songs.length && (
            <div className="emptyLibrary">오른쪽 + 버튼으로 폴더나 노래를 추가하세요</div>
          )}
        </aside>}
        {libraryOpen && <div className="libraryResizer" onMouseDown={(event) => beginResize("library", event)} />}

        <section className="arranger" style={{ "--timeline-width": `${timelineWidth}px` } as CSSProperties}>
          <div className="trackHeaderSpacer" />
          <div className="trackAreaResizer" onMouseDown={(event) => beginResize("tracks", event)} />
          <div className="rulerViewport" ref={rulerScrollRef}>
            <Ruler currentTime={currentTime} duration={displayDuration} onSeek={seek} />
          </div>
          <div className="trackControlsScroller" ref={controlsScrollRef} onScroll={() => syncVerticalScroll("controls")}>
            <div className="trackControlsStack">
              {stems.map((stem) => (
                <TrackControlsRow
                  key={stem.name}
                  name={stem.name}
                  color={stem.color}
                  state={tracks[stem.name]}
                  onUpdate={updateTrack}
                />
              ))}
            </div>
          </div>
          <div className="lanesScroller" ref={lanesScrollRef} onScroll={syncHorizontalScroll}>
            <div className="lanesStack">
              {stems.map((stem) => (
                <RegionLane
                  key={stem.name}
                  color={stem.color}
                  waveform={stem.waveform}
                  duration={displayDuration}
                  currentTime={currentTime}
                  onSeek={seek}
                />
              ))}
            </div>
          </div>
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

        <div className="editorResizer" onMouseDown={(event) => beginResize("editor", event)} />

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
            <span>CHORD <strong>{currentChord}</strong></span>
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

function SongRow({
  id,
  label,
  active = false,
  nested = false,
  onSelect
}: {
  id: string;
  label: string;
  active?: boolean;
  nested?: boolean;
  onSelect: () => void;
}) {
  return (
    <div
      className={`songRow ${active ? "active" : ""} ${nested ? "nested" : ""}`}
      draggable
      onClick={onSelect}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-song-id", id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
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

function TrackControlsRow({
  name,
  color,
  state,
  onUpdate
}: {
  name: StemName;
  color: string;
  state: TrackState;
  onUpdate: (name: StemName, patch: Partial<TrackState>) => void;
}) {
  return (
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
  );
}

function RegionLane({
  color,
  waveform,
  duration,
  currentTime,
  onSeek
}: {
  color: string;
  waveform: number[];
  duration: number;
  currentTime: number;
  onSeek: (time: number) => void;
}) {
  const peaks = waveform.length ? resamplePeaks(waveform, Math.max(500, Math.min(3600, Math.round(duration * 9)))) : [];
  const wavePath = peaks.length ? buildWavePath(peaks) : "";
  return (
    <div
      className="regionLane"
      style={{ "--accent": color } as CSSProperties}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    >
      <div className="region">
        <div className={`regionWave ${peaks.length ? "" : "empty"}`}>
          {peaks.length ? (
            <svg className="waveSvg" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="1000" y1="50" y2="50" />
              <path d={wavePath} />
            </svg>
          ) : (
            <small>분석 대기 중</small>
          )}
        </div>
      </div>
      <i className="playhead" style={{ left: `${duration ? (currentTime / duration) * 100 : 0}%` }} />
    </div>
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

function getCurrentChord(analysis: Analysis | null, time: number) {
  if (!analysis || !analysis.chords.length) return "--";
  const chord = analysis.chords.find((item) => time >= item.start && time < item.end) ?? analysis.chords[analysis.chords.length - 1];
  return chord?.label ?? "--";
}

function buildWavePath(peaks: number[]) {
  const width = 1000;
  const mid = 50;
  const topPoints = peaks.map((peak, index) => {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const amp = Math.max(1, Math.min(48, peak * 58));
    return `${x.toFixed(2)},${(mid - amp).toFixed(2)}`;
  });
  const bottomPoints = peaks.map((peak, index) => {
    const x = (index / Math.max(1, peaks.length - 1)) * width;
    const amp = Math.max(1, Math.min(48, peak * 58));
    return `${x.toFixed(2)},${(mid + amp).toFixed(2)}`;
  }).reverse();
  return `M ${topPoints.join(" L ")} L ${bottomPoints.join(" L ")} Z`;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function createId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
