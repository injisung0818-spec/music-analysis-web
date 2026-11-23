import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, MouseEvent as ReactMouseEvent } from "react";
import { assetUrl, deleteJob, exportInstrumentalUrl, exportMixUrl, exportStemsUrl, fetchAnalysis, fetchJob, fetchJobs, uploadAudio } from "./api";
import type { Analysis, AudioFormat, JobResponse, SeparationEngine, SeparationQuality, SeparationStatus, StemName, TrackState } from "./types";
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
  vocals: { muted: false, solo: false, volume: 0.9, pan: 0 },
  drums: { muted: false, solo: false, volume: 0.88, pan: 0 },
  bass: { muted: false, solo: false, volume: 0.86, pan: 0 },
  guitar: { muted: false, solo: false, volume: 0.78, pan: 0 },
  piano: { muted: false, solo: false, volume: 0.78, pan: 0 },
  other: { muted: false, solo: false, volume: 0.72, pan: 0 }
};

const STEM_LABELS: Record<StemName, string> = {
  vocals: "보컬",
  drums: "드럼",
  bass: "베이스",
  guitar: "기타",
  piano: "피아노",
  other: "나머지"
};

const STEM_COLORS: Record<StemName, string> = {
  vocals: "#69caec",
  drums: "#72d1dc",
  bass: "#80dce4",
  guitar: "#97edf2",
  piano: "#c7fbfd",
  other: "#e8fbfc"
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

type PanGraph = {
  audio: HTMLAudioElement;
  source: MediaElementAudioSourceNode;
  panner: StereoPannerNode;
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

const LIBRARY_STORAGE_KEY = "local-music-analysis-library-v1";

type LibraryFolder = {
  id: string;
  name: string;
  open: boolean;
};

type LibrarySong = {
  id: string;
  jobId: string | null;
  title: string;
  folderId: string | null;
  pinned: boolean;
  restoring: boolean;
  job: JobResponse | null;
  analysis: Analysis | null;
  error: string | null;
};

type LibraryMetadata = {
  folders: LibraryFolder[];
  songs: Record<string, {
    title?: string;
    folderId?: string | null;
    pinned?: boolean;
  }>;
};

type ModalView = "add" | "upload" | "export" | null;

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
  const [openFolderMenuId, setOpenFolderMenuId] = useState<string | null>(null);
  const [editingSongId, setEditingSongId] = useState<string | null>(null);
  const [openSongMenuId, setOpenSongMenuId] = useState<string | null>(null);
  const [libraryLoaded, setLibraryLoaded] = useState(false);
  const [uploadFileName, setUploadFileName] = useState("");
  const [separationQuality, setSeparationQuality] = useState<SeparationQuality>("standard");
  const [separationEngine, setSeparationEngine] = useState<SeparationEngine | "">("");
  const [stemsOnly, setStemsOnly] = useState(false);
  const [uploadBusy, setUploadBusy] = useState(false);
  const [exportFormat, setExportFormat] = useState<AudioFormat>("wav");
  const [exportStemSelection, setExportStemSelection] = useState<StemName[]>([]);
  const [exportSeparateStems, setExportSeparateStems] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [libraryWidth, setLibraryWidth] = useState(286);
  const [trackControlsWidth, setTrackControlsWidth] = useState(620);
  const [editorHeight, setEditorHeight] = useState(294);
  const [metronomeOn, setMetronomeOn] = useState(false);
  const [chordsVisible, setChordsVisible] = useState(true);
  const [lyricsVisible, setLyricsVisible] = useState(false);
  const [repeatOn, setRepeatOn] = useState(false);
  const [globalVolume, setGlobalVolume] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const uploadInFlightRef = useRef(false);
  const activeSongIdRef = useRef<string | null>(null);
  const audioRefs = useRef<Record<string, HTMLAudioElement | null>>({});
  const panGraphRefs = useRef<Record<string, PanGraph>>({});
  const rafRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const lastAudioSyncRef = useRef(0);
  const metronomeBeatRef = useRef(-1);
  const currentTimeRef = useRef(0);
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
  const analysisSkipped = analysis?.music_analysis === false;
  const transportKey = analysisSkipped ? "--" : analysis ? `${analysis.key} ${modeLabel(analysis.mode)}` : "Cmin";
  activeSongIdRef.current = activeSongId;
  const separationStatus = analysis?.separation_status ?? job?.separation_status;
  const separationError = analysis?.separation_error ?? job?.separation_error;
  const progress = Math.round((job?.progress ?? 0) * 100);
  const stems = analysis?.stems ?? stemPlaceholders();
  const exportableStems = analysis?.separation_status === "succeeded"
    ? analysis.stems.filter((stem) => stem.audio_url).map((stem) => stem.name)
    : [];
  const canPlayStems = exportableStems.length === 6;
  const jobId = job?.id;
  const jobStatus = job?.status;
  const orderedSongs = useMemo(() => sortSongs(songs), [songs]);
  const activeSongTitle = songs.find((song) => song.id === activeSongId)?.title ?? analysis?.original_filename ?? "노래 이름";
  const modalOpen = modalView !== null;
  const displayDuration = duration || 120;
  const timelinePixelsPerSecond = analysis ? 16 : 22;
  const timelineWidth = Math.max(1500, Math.min(6200, Math.round(displayDuration * timelinePixelsPerSecond)));
  const currentChord = useMemo(() => getCurrentChord(analysis, currentTime), [analysis, currentTime]);
  const rootStyle = {
    "--library-width": `${libraryWidth}px`,
    "--controls-width": `${trackControlsWidth}px`,
    "--editor-height": `${editorHeight}px`
  } as CSSProperties;

  useEffect(() => {
    currentTimeRef.current = currentTime;
  }, [currentTime]);

  useEffect(() => {
    let mounted = true;

    async function restoreLibrary() {
      const metadata = readLibraryMetadata();
      const loadingSongs = metadataSongsToLoadingRows(metadata);
      if (mounted && loadingSongs.length) {
        setFolders(metadata.folders);
        setSongs(loadingSongs);
        setActiveSongId(loadingSongs[0]?.id ?? null);
      }
      try {
        const jobs = await fetchRestorableJobs(metadata);
        const restoredSongs = await Promise.all(jobs.map((storedJob) => restoreSong(storedJob, metadata)));
        if (!mounted) return;
        const nextSongs = sortSongs(restoredSongs);
        const firstSong = nextSongs[0] ?? null;
        setFolders(metadata.folders);
        setSongs(nextSongs);
        setActiveSongId(firstSong?.id ?? null);
        setJob(firstSong?.job ?? null);
        setAnalysis(firstSong?.analysis ?? null);
        setError(firstSong?.error ?? null);
      } catch (restoreError) {
        if (mounted) setError(normalizeErrorMessage(restoreError));
      } finally {
        if (mounted) setLibraryLoaded(true);
      }
    }

    void restoreLibrary();
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    if (!libraryLoaded) return;
    writeLibraryMetadata(folders, songs);
  }, [folders, songs, libraryLoaded]);

  useEffect(() => {
    if (!jobId || jobStatus === "done" || jobStatus === "error") return;
    let stopped = false;
    let timer: number;
    async function poll() {
      if (!jobId) return;
      try {
        const next = await fetchJob(jobId);
        const result = next.status === "done" ? applyStemPalette(await fetchAnalysis(next.id)) : null;
        if (stopped) return;
        setJob(next);
        setError(null);
        if (result) setAnalysis(result);
        setSongs((prev) => prev.map((song) => (
          song.id === activeSongId ? { ...song, job: next, analysis: result, error: next.error ?? null } : song
        )));
        if (next.status === "done" || next.status === "error") return;
      } catch (pollError) {
        if (stopped) return;
        setError(normalizeErrorMessage(pollError));
      }
      timer = window.setTimeout(poll, 650);
    }
    timer = window.setTimeout(poll, 250);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [jobId, jobStatus, activeSongId]);

  useEffect(() => {
    if (!isPlaying) {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      return;
    }
    const tickFrame = (now: number) => {
      const first = firstPlayableAudio();
      if (first) {
        setCurrentTime(first.currentTime);
        if (now - lastAudioSyncRef.current >= 50) {
          synchronizeAudioElements(first);
          lastAudioSyncRef.current = now;
        }
      }
      rafRef.current = requestAnimationFrame(tickFrame);
    };
    rafRef.current = requestAnimationFrame(tickFrame);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, analysis]);

  useEffect(() => {
    if (!analysis) return;
    const context = ensureAudioContext();
    const masterGain = context ? ensureMasterGain(context) : null;
    if (masterGain && context) {
      masterGain.gain.cancelScheduledValues(context.currentTime);
      masterGain.gain.setTargetAtTime(globalVolume, context.currentTime, 0.015);
    }
    for (const stem of analysis.stems) {
      const audio = audioRefs.current[stem.name];
      if (!audio) continue;
      const state = tracks[stem.name];
      const graph = ensurePanGraph(stem.name, audio);
      // WKWebView does not consistently apply HTMLMediaElement.volume after a
      // MediaElementAudioSourceNode is attached.  Per-track volume stays on the
      // element, while the master level is applied by a real Web Audio gain.
      audio.volume = graph ? state.volume : state.volume * globalVolume;
      audio.muted = state.muted || (soloActive && !state.solo);
      audio.loop = repeatOn;
      if (graph) graph.panner.pan.value = state.pan;
    }
  }, [tracks, soloActive, analysis, globalVolume, repeatOn]);

  useEffect(() => {
    if (!isPlaying || !metronomeOn || !analysis || analysis.music_analysis === false) {
      metronomeBeatRef.current = -1;
      return;
    }

    const timer = window.setInterval(() => {
      const audio = firstPlayableAudio();
      const time = audio?.currentTime ?? currentTimeRef.current;
      const beatIndex = Math.floor(time / beatLength);
      const beatRemainder = time % beatLength;
      if (beatIndex !== metronomeBeatRef.current && beatRemainder < 0.08) {
        metronomeBeatRef.current = beatIndex;
        playMetronomeClick(beatIndex % 4 === 0);
      }
    }, 20);

    return () => window.clearInterval(timer);
  }, [analysis, beatLength, isPlaying, metronomeOn]);

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
    if (uploadInFlightRef.current) return;
    uploadInFlightRef.current = true;
    setUploadBusy(true);
    setError(null);
    setJob(null);
    setAnalysis(null);
    setIsPlaying(false);
    pauseAll();
    setCurrentTime(0);
    setSongInfoOpen(false);
    setUploadFileName(file.name);
    setModalView("upload");
    const songId = createId();
    setSongs((prev) => sortSongs([...prev, { id: songId, jobId: null, title: file.name, folderId: null, pinned: false, restoring: false, job: null, analysis: null, error: null }]));
    activeSongIdRef.current = songId;
    setActiveSongId(songId);
    try {
      const created = await uploadAudio(file, separationQuality, separationEngine, stemsOnly);
      const existing = songs.find((song) => song.jobId === created.id);
      const targetId = existing?.id ?? songId;
      setSongs((prev) => sortSongs(prev
        .filter((song) => !existing || song.id !== songId)
        .map((song) => (song.id === targetId ? { ...song, jobId: created.id, job: created } : song))));
      if (activeSongIdRef.current === songId) {
        setActiveSongId(targetId);
        setJob(created);
      }
    } catch (uploadError) {
      const message = normalizeErrorMessage(uploadError);
      if (activeSongIdRef.current === songId) setError(message);
      setSongs((prev) => prev.map((song) => (song.id === songId ? { ...song, error: message } : song)));
    } finally {
      uploadInFlightRef.current = false;
      setUploadBusy(false);
    }
  }

  function openUploadModal() {
    setError(null);
    setUploadFileName("");
    setModalView("upload");
  }

  function openExportModal() {
    if (!canPlayStems) return;
    setError(null);
    setExportStemSelection(exportableStems);
    setExportSeparateStems(false);
    setModalView("export");
  }

  async function downloadExport(url: string, suffix: string, extension: string = exportFormat) {
    if (exportBusy) return;
    setExportBusy(true);
    setError(null);
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(await exportErrorMessage(response));
      const href = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = href;
      link.download = downloadNameFromHeader(
        response.headers.get("content-disposition"), `${safeFileBase(activeSongTitle)}-${suffix}.${extension}`
      );
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(href), 1000);
    } catch (exportError) {
      setError(normalizeErrorMessage(exportError));
    } finally {
      setExportBusy(false);
    }
  }

  function exportWholeSong() {
    if (analysis && canPlayStems) void downloadExport(exportMixUrl(analysis.job_id, exportFormat), "mix");
  }

  function exportInstrumental() {
    if (analysis && canPlayStems) void downloadExport(exportInstrumentalUrl(analysis.job_id, exportFormat), "instrumental");
  }

  function exportStems(mode: "mix" | "zip" | "single", selection: StemName[]) {
    if (!analysis || !canPlayStems || !selection.length) return;
    const suffix = mode === "single" ? selection[0] : mode === "zip" ? "stems" : "selected-stems";
    void downloadExport(
      exportStemsUrl(analysis.job_id, selection, mode, exportFormat),
      suffix,
      mode === "zip" ? "zip" : exportFormat
    );
  }

  function toggleExportStem(stem: StemName) {
    setExportStemSelection((prev) => (prev.includes(stem) ? prev.filter((item) => item !== stem) : [...prev, stem]));
  }

  function selectSong(songId: string) {
    const song = songs.find((item) => item.id === songId);
    if (!song) return;
    setIsPlaying(false);
    pauseAll();
    setActiveSongId(song.id);
    setCurrentTime(0);
    setJob(song.job);
    setAnalysis(song.analysis);
    setError(song.error);
    setSongInfoOpen(false);
    metronomeBeatRef.current = -1;
    if (lanesScrollRef.current) lanesScrollRef.current.scrollLeft = 0;
    if (rulerScrollRef.current) rulerScrollRef.current.scrollLeft = 0;
  }

  function renameSong(songId: string, title: string) {
    const safeTitle = title.trim() || "이름 없는 노래";
    setSongs((prev) => prev.map((song) => (song.id === songId ? { ...song, title: safeTitle } : song)));
    setEditingSongId(null);
  }

  function toggleSongPin(songId: string) {
    setSongs((prev) => sortSongs(prev.map((song) => (song.id === songId ? { ...song, pinned: !song.pinned } : song))));
    setOpenSongMenuId(null);
  }

  async function removeSong(songId: string) {
    const song = songs.find((item) => item.id === songId);
    if (!song) return;
    const backendJobId = song.jobId ?? song.job?.id;
    if (backendJobId) {
      try {
        await deleteJob(backendJobId);
      } catch (deleteError) {
        setError(normalizeErrorMessage(deleteError));
        return;
      }
    }

    const remainingSongs = sortSongs(songs.filter((item) => item.id !== songId));
    const nextSong = remainingSongs[0] ?? null;
    setOpenSongMenuId(null);
    if (activeSongId === songId) {
      setIsPlaying(false);
      pauseAll();
      setCurrentTime(0);
      setJob(nextSong?.job ?? null);
      setAnalysis(nextSong?.analysis ?? null);
      setError(null);
      setActiveSongId(nextSong?.id ?? null);
    }
    setSongs(remainingSongs);
  }

  function firstPlayableAudio() {
    if (!analysis) return null;
    for (const stem of analysis.stems) {
      const audio = audioRefs.current[stem.name];
      if (audio && audio.readyState >= 1) return audio;
    }
    return null;
  }

  function synchronizeAudioElements(master: HTMLAudioElement) {
    if (!analysis || master.paused || master.seeking) return;
    master.playbackRate = 1;
    for (const stem of analysis.stems) {
      const audio = audioRefs.current[stem.name];
      if (!audio || audio === master || audio.paused || audio.seeking || audio.readyState < 2) continue;
      const drift = audio.currentTime - master.currentTime;
      if (Math.abs(drift) > 0.075) {
        audio.currentTime = Math.min(master.currentTime, Math.max(0, audio.duration || duration));
        audio.playbackRate = 1;
      } else if (Math.abs(drift) > 0.008) {
        // Tiny rate corrections are inaudible with pitch preservation and keep
        // independently decoded stems locked without repeated hard seeks.
        audio.playbackRate = Math.max(0.985, Math.min(1.015, 1 - drift * 0.35));
      } else {
        audio.playbackRate = 1;
      }
    }
  }

  async function togglePlayback() {
    if (!analysis || !canPlayStems) return;
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    if (nextPlaying) {
      const context = ensureAudioContext();
      if (context?.state === "suspended") await context.resume().catch(() => undefined);
      if (metronomeOn) metronomeBeatRef.current = -1;
    }
    if (nextPlaying && analysis) {
      for (const stem of analysis.stems) {
        const audio = audioRefs.current[stem.name];
        if (audio) ensurePanGraph(stem.name, audio);
      }
    }
    const audible = analysis.stems
      .map((stem) => audioRefs.current[stem.name])
      .filter((audio): audio is HTMLAudioElement => Boolean(audio));
    if (nextPlaying) {
      lastAudioSyncRef.current = 0;
      await Promise.allSettled(
        audible.map(async (audio) => {
          audio.playbackRate = 1;
          audio.preservesPitch = true;
          audio.currentTime = Math.min(currentTime, Math.max(0, audio.duration || duration));
          await audio.play();
        })
      );
    } else {
      pauseAll();
    }
  }

  function pauseAll() {
    Object.values(audioRefs.current).forEach((audio) => {
      if (!audio) return;
      audio.pause();
      audio.playbackRate = 1;
    });
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
      if (audio) {
        audio.playbackRate = 1;
        audio.currentTime = clamped;
      }
    });
  }

  function updateTrack(name: StemName, patch: Partial<TrackState>) {
    setTracks((prev) => ({ ...prev, [name]: { ...prev[name], ...patch } }));
  }

  function ensureAudioContext() {
    if (audioContextRef.current) return audioContextRef.current;
    const AudioContextCtor = window.AudioContext ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return null;
    audioContextRef.current = new AudioContextCtor();
    return audioContextRef.current;
  }

  function ensureMasterGain(context: AudioContext) {
    const existing = masterGainRef.current;
    if (existing && existing.context === context) return existing;
    existing?.disconnect();
    const master = context.createGain();
    master.gain.value = globalVolume;
    master.connect(context.destination);
    masterGainRef.current = master;
    return master;
  }

  function ensurePanGraph(stemName: StemName, audio: HTMLAudioElement) {
    const existing = panGraphRefs.current[stemName];
    if (existing?.audio === audio) return existing;
    if (existing) {
      existing.source.disconnect();
      existing.panner.disconnect();
    }
    const context = ensureAudioContext();
    if (!context || !context.createStereoPanner) return null;
    try {
      const source = context.createMediaElementSource(audio);
      const panner = context.createStereoPanner();
      source.connect(panner);
      panner.connect(ensureMasterGain(context));
      const graph = { audio, source, panner };
      panGraphRefs.current[stemName] = graph;
      return graph;
    } catch {
      return existing ?? null;
    }
  }

  function playMetronomeClick(accent: boolean) {
    const context = ensureAudioContext();
    if (!context) return;
    const start = context.currentTime;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "square";
    oscillator.frequency.value = accent ? 1480 : 940;
    gain.gain.setValueAtTime(accent ? 0.32 : 0.22, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.07);
    oscillator.connect(gain);
    gain.connect(ensureMasterGain(context));
    oscillator.start(start);
    oscillator.stop(start + 0.075);
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

  async function removeFolder(folderId: string) {
    const removedSongs = songs.filter((song) => song.folderId === folderId);
    const removedSongIds = new Set(removedSongs.map((song) => song.id));
    const remainingSongs = sortSongs(songs.filter((song) => !removedSongIds.has(song.id)));
    const nextSong = remainingSongs[0] ?? null;
    const deleteResults = await Promise.allSettled(
      removedSongs
        .map((song) => song.jobId ?? song.job?.id)
        .filter((jobId): jobId is string => Boolean(jobId))
        .map((jobId) => deleteJob(jobId))
    );
    const failed = deleteResults.find((result) => result.status === "rejected");
    if (failed) {
      setError(normalizeErrorMessage(failed.reason));
      return;
    }

    setOpenFolderMenuId(null);
    setEditingFolderId(null);
    setFolders((prev) => prev.filter((folder) => folder.id !== folderId));
    setSongs(remainingSongs);

    if (activeSongId && removedSongIds.has(activeSongId)) {
      setIsPlaying(false);
      pauseAll();
      setCurrentTime(0);
      setJob(nextSong?.job ?? null);
      setAnalysis(nextSong?.analysis ?? null);
      setError(null);
      setActiveSongId(nextSong?.id ?? null);
    }
  }

  function moveSongToFolder(songId: string, folderId: string | null) {
    setFolders((prev) => prev.map((folder) => (folder.id === folderId ? { ...folder, open: true } : folder)));
    setSongs((prev) => prev.map((song) => (song.id === songId ? { ...song, folderId } : song)));
  }

  return (
    <main className="appShell grid h-screen bg-panel" style={rootStyle}>
      <header className="topBar relative z-60 flex min-w-0 items-center gap-(--gap) overflow-visible">
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
          <button className="toolButton playButton" data-tooltip="재생" aria-label="재생" onClick={togglePlayback} disabled={!canPlayStems}>
            <Icon name={isPlaying ? "pause" : "play"} />
          </button>
          <button className={`toolButton ${volumeOpen ? "active" : ""}`} data-tooltip="소리 크기" aria-label="소리 크기" onClick={() => setVolumeOpen((open) => !open)}><Icon name="speaker" /></button>
        </div>

        <div className="lcd" role="button" tabIndex={0} onClick={() => setSongInfoOpen((open) => !open)}>
          <span className="songName">{activeSongTitle}</span>
          <Metric value={analysisSkipped ? "--" : String(bar).padStart(3, "0")} label="BAR" />
          <Metric value={analysisSkipped ? "--" : String(beat)} label="BEAT" />
          <Metric value={analysisSkipped ? "--" : String(div)} label="DIV" />
          <Metric value={analysisSkipped ? "--" : String(tick).padStart(3, "0")} label="TICK" />
          <Metric value={analysisSkipped ? "--" : String(Math.round(bpm))} label="TEMPO" />
          <Metric value={transportKey} label="KEY" />
          <Metric value="4/4" label="TIME" />
        </div>

        <div className="ml-auto inline-flex flex-none items-center gap-(--gap)">
          <div className="toolbarGroup analysisTools">
            <button
              className={`toolButton ${metronomeOn && !analysisSkipped ? "active" : ""}`}
              disabled={analysisSkipped}
              data-tooltip="메트로놈"
              aria-label="메트로놈"
              onClick={() => {
                const next = !metronomeOn;
                setMetronomeOn(next);
                if (next) {
                  void ensureAudioContext()?.resume();
                  metronomeBeatRef.current = -1;
                }
              }}
            ><Icon name="metronome" /></button>
            <button className={`toolButton ${chordsVisible ? "active" : ""}`} data-tooltip="코드 보기" aria-label="코드 보기" onClick={() => setChordsVisible((visible) => !visible)}><Icon name="notes" /></button>
          </div>
          <div className="toolbarGroup lyricTools">
            <button className={`toolButton ${lyricsVisible ? "active" : ""}`} data-tooltip="가사" aria-label="가사" onClick={() => setLyricsVisible((visible) => !visible)}><Icon name="lyrics" /></button>
            <button className={`toolButton ${repeatOn ? "active" : ""}`} data-tooltip="연속 재생" aria-label="연속 재생" onClick={() => setRepeatOn((on) => !on)}><Icon name="repeat" /></button>
          </div>
          <div className="toolbarSpacer wide" aria-hidden="true" />
          <div className="toolbarGroup outputTools">
            <button className="toolButton" data-tooltip="더보기" aria-label="더보기"><Icon name="more" /></button>
            <button className="toolButton exportButton" data-tooltip="내보내기" aria-label="내보내기" onClick={openExportModal} disabled={!canPlayStems}><Icon name="upload" /></button>
            <button className="toolButton" data-tooltip="추가" aria-label="추가" onClick={() => setModalView("add")}><Icon name="plus" /></button>
          </div>
        </div>

        <TopPopovers
          settingsOpen={settingsOpen}
          profileOpen={profileOpen}
          volumeOpen={volumeOpen}
          songInfoOpen={songInfoOpen}
          metronomeOn={metronomeOn && !analysisSkipped}
          repeatOn={repeatOn}
          globalVolume={globalVolume}
          onVolume={setGlobalVolume}
          songTitle={activeSongTitle}
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
          className="library col-start-1 row-[1/4] min-h-0 overflow-x-hidden overflow-y-auto bg-panel text-muted [border-right:2px_solid_#232323]"
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
                menuOpen={openFolderMenuId === folder.id}
                onRename={(name) => updateFolderName(folder.id, name)}
                onEdit={() => {
                  setEditingFolderId(folder.id);
                  setOpenFolderMenuId(null);
                }}
                onDelete={() => void removeFolder(folder.id)}
                onMenu={() => setOpenFolderMenuId((openId) => (openId === folder.id ? null : folder.id))}
                onToggle={() => setFolders((prev) => prev.map((item) => (item.id === folder.id ? { ...item, open: !item.open } : item)))}
              />
              {folder.open && orderedSongs.filter((song) => song.folderId === folder.id).map((song) => (
                <SongRow
                  key={song.id}
                  id={song.id}
                  label={song.title}
                  pinned={song.pinned}
                  loading={song.restoring}
                  nested
                  active={activeSongId === song.id}
                  editing={editingSongId === song.id}
                  menuOpen={openSongMenuId === song.id}
                  onSelect={() => selectSong(song.id)}
                  onRename={(title) => renameSong(song.id, title)}
                  onEdit={() => {
                    setEditingSongId(song.id);
                    setOpenSongMenuId(null);
                  }}
                  onTogglePin={() => toggleSongPin(song.id)}
                  onDelete={() => void removeSong(song.id)}
                  onMenu={() => setOpenSongMenuId((openId) => (openId === song.id ? null : song.id))}
                />
              ))}
            </div>
          ))}
          {orderedSongs.filter((song) => song.folderId === null).map((song) => (
            <SongRow
              key={song.id}
              id={song.id}
              label={song.title}
              pinned={song.pinned}
              loading={song.restoring}
              active={activeSongId === song.id}
              editing={editingSongId === song.id}
              menuOpen={openSongMenuId === song.id}
              onSelect={() => selectSong(song.id)}
              onRename={(title) => renameSong(song.id, title)}
              onEdit={() => {
                setEditingSongId(song.id);
                setOpenSongMenuId(null);
              }}
              onTogglePin={() => toggleSongPin(song.id)}
              onDelete={() => void removeSong(song.id)}
              onMenu={() => setOpenSongMenuId((openId) => (openId === song.id ? null : song.id))}
            />
          ))}
          {!folders.length && !songs.length && (
            <div className="mx-[14px] my-[18px] rounded-ui bg-raised p-[14px] text-ui leading-[1.45] text-[#bcbcbc] [border:1px_dashed_#606060]">오른쪽 + 버튼으로 폴더나 노래를 추가하세요</div>
          )}
        </aside>}
        {libraryOpen && <div className="col-start-2 row-[1/4] cursor-col-resize bg-track-surface [border-left:1px_solid_#111] [border-right:1px_solid_#3d3d3d]" onMouseDown={(event) => beginResize("library", event)} />}

        <section className="arranger" style={{ "--timeline-width": `${timelineWidth}px` } as CSSProperties}>
          <div className="col-start-1 row-start-1 border-2 border-solid border-track-edge border-l-0 bg-[#4a4a4a]" />
          <div className="col-start-2 row-[1/3] z-5 cursor-col-resize bg-[#1d1d1d] [border-left:1px_solid_#101010] [border-right:1px_solid_#363636]" onMouseDown={(event) => beginResize("tracks", event)} />
          <div className="col-start-3 row-start-1 min-w-0 overflow-hidden [border-right:2px_solid_var(--color-track-edge)]" ref={rulerScrollRef}>
            <Ruler currentTime={currentTime} duration={displayDuration} onSeek={seek} />
          </div>
          <div className="trackControlsScroller" ref={controlsScrollRef} onScroll={() => syncVerticalScroll("controls")}>
            <div className="min-w-0 [direction:ltr]">
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
            <div className="w-(--timeline-width)">
              {stems.map((stem) => (
                <RegionLane
                  key={stem.name}
                  color={stem.color}
                  waveform={stem.waveform}
                  emptyLabel={emptyStemLabel(separationStatus)}
                  duration={displayDuration}
                  currentTime={currentTime}
                  onSeek={seek}
                />
              ))}
            </div>
          </div>
          {analysis?.stems.filter((stem) => stem.audio_url).map((stem) => (
            <audio
              key={stem.name}
              preload="auto"
              ref={(node) => {
                audioRefs.current[stem.name] = node;
              }}
              src={assetUrl(stem.audio_url) ?? undefined}
              onEnded={() => setIsPlaying(false)}
            />
          ))}
        </section>

        <div className="col-start-3 row-start-2 cursor-row-resize bg-[#1a1a1a] [border-top:1px_solid_#101010] [border-bottom:1px_solid_#333]" onMouseDown={(event) => beginResize("editor", event)} />

        <section className="editorPanel">
          <div className="editorTitle flex items-center gap-[16px] bg-[#212121] px-[18px] [border-bottom:1px_solid_var(--color-raised)]">
            <strong>{lyricsVisible ? "가사" : "분석"}</strong>
            <span>{analysis ? `${formatTime(analysis.duration)} · ${analysisSkipped ? "스템 분리만" : `${analysis.chords.length}개 코드 · ${analysis.beats.length}개 비트`}` : "분석 결과 대기 중"}</span>
          </div>
          {chordsVisible && <ChordTimeline analysis={analysis} currentTime={currentTime} onSeek={seek} />}
          {lyricsVisible && <LyricsPanel title={activeSongTitle} />}
          <div className="editorDetails flex flex-wrap items-center gap-[28px] px-[18px] py-[16px] text-secondary">
            <span>BPM <strong>{analysis && !analysisSkipped ? Math.round(analysis.bpm) : "--"}</strong></span>
            <span>KEY <strong>{analysis && !analysisSkipped ? `${analysis.key} ${modeLabel(analysis.mode)}` : "--"}</strong></span>
            <span>MIDI <strong>{analysis ? analysis.stems.filter((stem) => stem.midi_url).length : 0}</strong></span>
            <span>METRO <strong>{metronomeOn && !analysisSkipped ? "ON" : "OFF"}</strong></span>
            <span>LOOP <strong>{repeatOn ? "ON" : "OFF"}</strong></span>
            <span>CHORD <strong>{currentChord}</strong></span>
            {(error || job?.error) && <em>{normalizeErrorMessage(error ?? job?.error)}</em>}
          </div>
          {separationStatus && separationStatus !== "unverified" && (
            <div className={`separationNotice ${separationStatus === "failed" ? "failed" : ""}`} role="status">
              <strong>{separationLabel(separationStatus)}</strong>
              {analysis?.actual_separation_engine && <span>{SEPARATION_ENGINES[analysis.actual_separation_engine]}</span>}
              {analysis?.separation_cache_hit && <span>저장된 스템 재사용</span>}
              {separationError && <span>{separationError}</span>}
            </div>
          )}
          {(job?.warnings.length || analysis?.warnings.length) ? (
            <div className="warnings mx-[18px] mb-[18px] rounded-ui bg-[#2b281b] p-[12px] text-[12px] leading-[1.45] text-[#e3d69d] [border:1px_solid_#5a5333]">
              {(analysis?.warnings ?? job?.warnings ?? []).map((warning, index) => <p key={`${warning}-${index}`}>{translateWarning(warning)}</p>)}
            </div>
          ) : null}
        </section>
      </section>

      {modalOpen && (
        <ModalLayer
          view={modalView}
          fileName={uploadFileName}
          job={modalView === "upload" && !uploadFileName ? null : job}
          progress={modalView === "upload" && !uploadFileName ? 0 : progress}
          error={error}
          analysis={analysis}
          exportStemSelection={exportStemSelection}
          exportSeparateStems={exportSeparateStems}
          exportBusy={exportBusy}
          exportFormat={exportFormat}
          separationQuality={separationQuality}
          separationEngine={separationEngine}
          stemsOnly={stemsOnly}
          uploadBusy={uploadBusy}
          onExportFormatChange={setExportFormat}
          onQualityChange={setSeparationQuality}
          onEngineChange={setSeparationEngine}
          onStemsOnlyChange={setStemsOnly}
          onClose={() => setModalView(null)}
          onAddFolder={addFolder}
          onOpenUpload={openUploadModal}
          onFile={handleFile}
          onExportWhole={exportWholeSong}
          onExportInstrumental={exportInstrumental}
          onExportSelected={() => exportStems(exportSeparateStems ? "zip" : "mix", exportStemSelection)}
          onExportAllStems={() => exportStems("zip", exportableStems)}
          onExportSingle={(stem) => exportStems("single", [stem])}
          onToggleExportStem={toggleExportStem}
          onExportSeparateChange={setExportSeparateStems}
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
  songTitle,
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
  songTitle: string;
  analysis: Analysis | null;
  job: JobResponse | null;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-15" aria-live="polite">
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
          <strong>{songTitle}</strong>
          <span>{analysis ? formatTime(analysis.duration) : statusLabel(job?.status ?? "ready")}
            {analysis && analysis.music_analysis !== false && ` · ${Math.round(analysis.bpm)} BPM · ${analysis.key} ${modeLabel(analysis.mode)}`}
          </span>
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
          <button className="absolute top-[10px] right-[10px] size-[32px] cursor-pointer rounded-[5px] [border:0] bg-transparent text-[24px] leading-none text-[#dcdcdc] [&:hover]:bg-selected" aria-label="닫기" onClick={onClose}>×</button>
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
          <button className="absolute top-[10px] right-[10px] size-[32px] cursor-pointer rounded-[5px] [border:0] bg-transparent text-[24px] leading-none text-[#dcdcdc] [&:hover]:bg-selected" aria-label="닫기" onClick={onClose}>×</button>
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
              <button className="dialogControl dialogControlBorder min-h-[36px] px-[10px] py-[6px]" disabled={exportBusy} onClick={() => void onExportWhole()}>전체 믹스 다운로드</button>
              <button className="dialogControl dialogControlBorder min-h-[36px] px-[10px] py-[6px]" disabled={exportBusy} onClick={onExportInstrumental}>Instrumental 다운로드</button>
              <button className="dialogControl dialogControlBorder min-h-[36px] px-[10px] py-[6px]" disabled={exportBusy} onClick={onExportAllStems}>6개 스템 ZIP 다운로드</button>
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
                    <button className="dialogControl dialogControlBorder min-h-[36px] px-[10px] py-[6px]" type="button" disabled={exportBusy} onClick={() => onExportSingle(stem.name)} aria-label={`${STEM_LABELS[stem.name]} 다운로드`}>↓</button>
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
          <button className="absolute top-[10px] right-[10px] size-[32px] cursor-pointer rounded-[5px] [border:0] bg-transparent text-[24px] leading-none text-[#dcdcdc] [&:hover]:bg-selected" aria-label="닫기" onClick={onClose}>×</button>
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

function LibraryRow({
  open,
  label,
  editing,
  menuOpen,
  onRename,
  onEdit,
  onDelete,
  onMenu,
  onToggle
}: {
  open: boolean;
  label: string;
  editing: boolean;
  menuOpen: boolean;
  onRename: (name: string) => void;
  onEdit: () => void;
  onDelete: () => void;
  onMenu: () => void;
  onToggle: () => void;
}) {
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    setDraft(label);
  }, [label, editing]);

  return (
    <div className="libraryFolder" onDoubleClick={onEdit}>
      <button className="folderButton" aria-label={open ? "폴더 닫기" : "폴더 열기"} onClick={onToggle}>{open ? "▼" : "▶"}</button>
      {editing ? (
        <input
          className="h-[30px] w-full min-w-0 rounded-[4px] border border-solid border-[rgba(116,214,239,0.7)] bg-[#2a2a2a] px-ui text-white outline-none"
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
      <button
        className="folderButton rowMenuButton"
        aria-label="폴더 메뉴"
        onClick={(event) => {
          event.stopPropagation();
          onMenu();
        }}
      >⋮</button>
      {menuOpen && (
        <div className="libraryMenu top-[40px] z-55 w-[126px]" onClick={(event) => event.stopPropagation()}>
          <button className="libraryMenuItem text-primary" onClick={onEdit}>이름 수정</button>
          <button className="libraryMenuItem text-[#ffb6b6]" onClick={onDelete}>폴더 지우기</button>
        </div>
      )}
    </div>
  );
}

function SongRow({
  id,
  label,
  pinned = false,
  loading = false,
  active = false,
  nested = false,
  editing = false,
  menuOpen = false,
  onRename,
  onEdit,
  onTogglePin,
  onDelete,
  onMenu,
  onSelect
}: {
  id: string;
  label: string;
  pinned?: boolean;
  loading?: boolean;
  active?: boolean;
  nested?: boolean;
  editing?: boolean;
  menuOpen?: boolean;
  onRename: (title: string) => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onDelete: () => void;
  onMenu: () => void;
  onSelect: () => void;
}) {
  const [draft, setDraft] = useState(label);

  useEffect(() => {
    setDraft(label);
  }, [label, editing]);

  return (
    <div
      className={`songRow ${active ? "active" : ""} ${nested ? "nested" : ""} ${pinned ? "pinned" : ""} ${loading ? "loading" : ""}`}
      draggable={!loading}
      onClick={() => {
        if (!editing && !loading) onSelect();
      }}
      onDragStart={(event) => {
        event.dataTransfer.setData("application/x-song-id", id);
        event.dataTransfer.effectAllowed = "move";
      }}
    >
      <span className="tinyWave">▥</span>
      {editing ? (
        <input
          className="songNameInput"
          autoFocus
          value={draft}
          onClick={(event) => event.stopPropagation()}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => onRename(draft)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onRename(draft);
            if (event.key === "Escape") onRename(label);
          }}
        />
      ) : (
        <strong>{loading ? "불러오는중" : `${pinned ? "● " : ""}${label}`}</strong>
      )}
      <button
        aria-label="노래 메뉴"
        className="rowMenuButton h-[32px] cursor-pointer [border:0] text-[25px] text-[#d9d9d9] disabled:cursor-default disabled:opacity-[0.35]"
        disabled={loading}
        onClick={(event) => {
          event.stopPropagation();
          onMenu();
        }}
      >⋮</button>
      {menuOpen && (
        <div className="libraryMenu top-[34px] z-50 w-[116px]" onClick={(event) => event.stopPropagation()}>
          <button className="libraryMenuItem text-primary" onClick={onTogglePin}>{pinned ? "고정 해제" : "고정"}</button>
          <button className="libraryMenuItem text-primary" onClick={onEdit}>이름 수정</button>
          <button className="libraryMenuItem text-[#ffb6b6]" onClick={onDelete}>지우기</button>
        </div>
      )}
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
      <div className="relative grid size-[clamp(56px,2.8125vw,72px)] place-items-center">
        <img className="h-full w-full object-contain [filter:drop-shadow(0_1px_0_rgba(0,0,0,0.22))]" src={STEM_ICONS[name]} alt="" aria-hidden="true" />
      </div>
      <div className="trackMeta grid gap-[10px]">
        <strong>{STEM_LABELS[name]}</strong>
        <div className="trackButtons inline-grid w-[88px] grid-cols-[44px_44px] overflow-hidden rounded-[5px] border border-solid border-[rgba(20,20,20,0.24)] bg-[#444]">
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
      <label className="panControl relative grid h-[90px] w-[86px] place-items-center justify-self-center">
        <input
          aria-label={`${STEM_LABELS[name]} 좌우 음향`}
          type="range"
          min="-1"
          max="1"
          step="0.01"
          value={state.pan}
          onDoubleClick={() => onUpdate(name, { pan: 0 })}
          onChange={(event) => onUpdate(name, { pan: Number(event.target.value) })}
        />
        <span
          className="panKnob"
          style={{ "--pan": state.pan } as CSSProperties}
          onDoubleClick={() => onUpdate(name, { pan: 0 })}
        >
          <i />
          <small>L</small>
          <b>R</b>
        </span>
      </label>
    </div>
  );
}

function RegionLane({
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
        <div className={`regionWave relative h-full py-[7px] ${peaks.length ? "" : "empty"}`}>
          {peaks.length ? (
            <svg className="waveSvg block h-full w-full" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" x2="1000" y1="50" y2="50" />
              <path d={wavePath} />
            </svg>
          ) : (
            <small>{emptyLabel}</small>
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

function emptyStemLabel(status: SeparationStatus | undefined) {
  if (status === "failed") return "분리된 오디오 없음";
  if (status === "succeeded") return "저장된 파형 없음";
  return "분리 대기 중";
}

const SEPARATION_ENGINES: Record<SeparationEngine, string> = {
  torch: "PyTorch",
  mps: "PyTorch MPS",
  mlx: "MLX"
};

function separationLabel(status: SeparationStatus) {
  const labels: Record<SeparationStatus, string> = {
    pending: "스템 분리 대기 중",
    running: "스템 분리 중",
    succeeded: "6개 스템 분리 완료",
    failed: "스템 분리 실패",
    unverified: "스템 분리 확인 대기 중"
  };
  return labels[status];
}

function translateWarning(warning: string) {
  if (warning.includes("ffmpeg not found") && warning.includes("MP3 conversion")) {
    return "ffmpeg가 설치되어 있지 않아 MP3 변환을 건너뛰고 테스트용 무음 오디오로 처리했습니다.";
  }
  if (warning.includes("ffmpeg not found") && warning.includes("copied WAV")) {
    return "ffmpeg가 설치되어 있지 않아 WAV 파일을 변환 없이 복사했습니다.";
  }
  if (warning.includes("WAV 파일이라 ffmpeg 재변환을 건너뛰고 바로 분석했습니다")) {
    return "WAV 파일이라 ffmpeg 재변환을 건너뛰고 바로 분석했습니다.";
  }
  if (warning.includes("fallback stems") || warning.includes("Demucs unavailable or failed") || warning.includes("demucs command not found")) {
    return "이전 작업에서 Demucs 분리가 완료되지 않았습니다.";
  }
  if (warning.includes("librosa analysis unavailable or failed")) {
    return "librosa가 설치되어 있지 않거나 분석에 실패해 임시 BPM/key/chord 분석 결과를 생성했습니다.";
  }
  if (warning.includes("basic-pitch unavailable or failed")) {
    return "basic-pitch가 설치되어 있지 않거나 MIDI 추출에 실패해 placeholder MIDI 파일을 생성했습니다.";
  }
  if (warning.includes("빠른 업로드 모드로 basic-pitch MIDI 추출을 건너뛰고")) {
    return "빠른 업로드 모드로 MIDI 추출을 건너뛰고 placeholder MIDI 파일을 생성했습니다.";
  }
  if (warning.includes("ffmpeg가 없어 stem WAV를 압축하지 않고 저장했습니다")) {
    return "ffmpeg가 없어 stem WAV를 압축하지 않고 저장했습니다.";
  }
  if (warning.includes("stem 압축에 실패해 WAV로 저장했습니다")) {
    return "일부 stem 압축에 실패해 WAV로 저장했습니다.";
  }
  if (warning.includes("저장 용량을 줄이기 위해 fallback 무음 stem 파일 생성을 생략했습니다")) {
    return "저장 용량을 줄이기 위해 fallback 무음 stem 파일 생성을 생략했습니다.";
  }
  return warning;
}

function stemPlaceholders() {
  return [
    { name: "vocals" as StemName, color: STEM_COLORS.vocals, waveform: [] },
    { name: "drums" as StemName, color: STEM_COLORS.drums, waveform: [] },
    { name: "bass" as StemName, color: STEM_COLORS.bass, waveform: [] },
    { name: "guitar" as StemName, color: STEM_COLORS.guitar, waveform: [] },
    { name: "piano" as StemName, color: STEM_COLORS.piano, waveform: [] },
    { name: "other" as StemName, color: STEM_COLORS.other, waveform: [] }
  ];
}

function applyStemPalette(analysis: Analysis): Analysis {
  return {
    ...analysis,
    chords: analysis.music_analysis === false ? [] : normalizeChordTimeline(analysis.chords, analysis.duration),
    stems: analysis.stems.map((stem) => ({
      ...stem,
      color: STEM_COLORS[stem.name] ?? stem.color
    }))
  };
}

function normalizeChordTimeline(chords: Analysis["chords"], duration: number) {
  if (!duration || duration <= 0) return chords;
  if (!chords.length) {
    return [{ start: 0, end: duration, label: "N", confidence: 0 }];
  }

  const lastEnd = Math.max(...chords.map((chord) => chord.end));
  const scale = lastEnd > 0 && lastEnd < duration * 0.6 ? duration / lastEnd : 1;
  const fixed = chords
    .map((chord) => ({
      ...chord,
      start: Math.max(0, Math.min(chord.start * scale, duration)),
      end: Math.max(0, Math.min(chord.end * scale, duration))
    }))
    .filter((chord) => chord.end >= chord.start);

  if (!fixed.length) {
    return [{ start: 0, end: duration, label: "N", confidence: 0 }];
  }

  fixed[0] = { ...fixed[0], start: 0 };
  const last = fixed[fixed.length - 1];
  fixed[fixed.length - 1] = { ...last, end: duration };
  return fixed;
}

async function fetchRestorableJobs(metadata: LibraryMetadata): Promise<JobResponse[]> {
  try {
    return await fetchJobs();
  } catch (listError) {
    const savedJobIds = Object.keys(metadata.songs);
    if (!savedJobIds.length) throw listError;
    const restored = await Promise.allSettled(savedJobIds.map((jobId) => fetchJob(jobId)));
    const jobs = restored
      .filter((result): result is PromiseFulfilledResult<JobResponse> => result.status === "fulfilled")
      .map((result) => result.value);
    if (!jobs.length) throw listError;
    return jobs;
  }
}

async function restoreSong(storedJob: JobResponse, metadata: LibraryMetadata): Promise<LibrarySong> {
  const meta = metadata.songs[storedJob.id] ?? {};
  let restoredAnalysis: Analysis | null = null;
  if (storedJob.status === "done") {
    try {
      restoredAnalysis = applyStemPalette(await fetchAnalysis(storedJob.id));
    } catch {
      restoredAnalysis = null;
    }
  }
  return {
    id: storedJob.id,
    jobId: storedJob.id,
    title: meta.title ?? storedJob.original_filename,
    folderId: meta.folderId ?? null,
    pinned: meta.pinned ?? false,
    restoring: false,
    job: storedJob,
    analysis: restoredAnalysis,
    error: storedJob.error ?? null
  };
}

function sortSongs(songList: LibrarySong[]) {
  return [...songList].sort((first, second) => {
    if (first.pinned !== second.pinned) return first.pinned ? -1 : 1;
    const firstTime = Date.parse(first.job?.created_at ?? "");
    const secondTime = Date.parse(second.job?.created_at ?? "");
    if (Number.isFinite(firstTime) && Number.isFinite(secondTime) && firstTime !== secondTime) {
      return secondTime - firstTime;
    }
    return first.title.localeCompare(second.title, "ko");
  });
}

function readLibraryMetadata(): LibraryMetadata {
  try {
    const raw = window.localStorage.getItem(LIBRARY_STORAGE_KEY);
    if (!raw) return { folders: [], songs: {} };
    const parsed = JSON.parse(raw) as Partial<LibraryMetadata>;
    return {
      folders: Array.isArray(parsed.folders) ? parsed.folders : [],
      songs: parsed.songs && typeof parsed.songs === "object" ? parsed.songs : {}
    };
  } catch {
    return { folders: [], songs: {} };
  }
}

function metadataSongsToLoadingRows(metadata: LibraryMetadata): LibrarySong[] {
  return sortSongs(Object.entries(metadata.songs).map(([jobId, meta]) => ({
    id: jobId,
    jobId,
    title: meta.title ?? "불러오는중",
    folderId: meta.folderId ?? null,
    pinned: meta.pinned ?? false,
    restoring: true,
    job: null,
    analysis: null,
    error: null
  })));
}

function writeLibraryMetadata(folders: LibraryFolder[], songs: LibrarySong[]) {
  const metadata: LibraryMetadata = {
    folders,
    songs: {}
  };
  for (const song of songs) {
    const key = song.jobId ?? song.job?.id ?? song.id;
    metadata.songs[key] = {
      title: song.title,
      folderId: song.folderId,
      pinned: song.pinned
    };
  }
  window.localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(metadata));
}

async function exportErrorMessage(response: Response) {
  const text = await response.text();
  try {
    const parsed = JSON.parse(text) as { detail?: string };
    return parsed.detail ?? text;
  } catch {
    return text || response.statusText;
  }
}

function downloadNameFromHeader(header: string | null, fallbackName = "export") {
  if (!header) return fallbackName;
  const encoded = header.match(/filename\*=utf-8''([^;]+)/i)?.[1];
  if (encoded) return decodeURIComponent(encoded);
  const plain = header.match(/filename="?([^";]+)"?/i)?.[1];
  return plain || fallbackName;
}

function safeFileBase(name: string) {
  return (name || "song").replace(/\.[^/.]+$/, "").replace(/[\\/:*?"<>|]/g, "_").trim() || "song";
}

function normalizeErrorMessage(errorValue: unknown) {
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
