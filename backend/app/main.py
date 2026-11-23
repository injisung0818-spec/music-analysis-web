from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import re
import shutil
import tempfile
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Annotated, Literal

from fastapi import FastAPI, File, Form, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.background import BackgroundTask
from starlette.concurrency import run_in_threadpool
from pydantic import BaseModel, ValidationError

from . import exports
from .exports import AudioFormat
from .processor import (
    STEMS, JobState, MusicProcessor, SeparationQuality, SeparationStatus,
    cleanup_failed_artifacts, demucs_installed, env_flag, find_executable, now_iso, read_cached_music,
)

from .separation import Engine, MODEL as DEMUCS_MODEL, default_engine


BASE_DIR = Path(__file__).resolve().parents[1]
# The desktop app supplies a writable Application Support directory.  Keeping
# generated audio there avoids attempting to write inside the signed .app bundle.
STORAGE_DIR = Path(os.getenv("MUSIC_APP_DATA_DIR", str(BASE_DIR / "storage"))).expanduser().resolve()
UPLOADS_DIR = STORAGE_DIR / "uploads"
JOBS_DIR = STORAGE_DIR / "jobs"
ALLOWED_SUFFIXES = {".mp3", ".wav"}
EXPORTS_DIR = STORAGE_DIR / "exports"
MAX_UPLOAD_BYTES = int(os.getenv("MUSIC_MAX_UPLOAD_MB", "150")) * 1024 * 1024
MAX_PENDING_JOBS = int(os.getenv("MUSIC_MAX_PENDING_JOBS", "8"))
export_lock = asyncio.Lock()
logger = logging.getLogger(__name__)


class JobResponse(BaseModel):
    id: str
    status: str
    progress: float
    message: str
    created_at: str
    updated_at: str
    original_filename: str
    warnings: list[str] = []
    error: str | None = None
    separation_quality: SeparationQuality = "standard"
    separation_status: SeparationStatus = "unverified"
    separation_error: str | None = None
    separation_engine: Engine = "torch"
    actual_separation_engine: Engine | None = None
    separation_cache_hit: bool = False
    music_analysis: bool = True
    midi: bool = True
    timings: dict[str, float] = {}
    music_cache_hit: bool = False


class JobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, JobState] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.lock = asyncio.Lock()
        self.active_uploads: dict[str, tuple[str, str, SeparationQuality, Engine, bool, bool]] = {}

    async def create(
        self, upload: UploadFile, quality: SeparationQuality,
        engine: Engine, music_analysis: bool, midi: bool,
    ) -> JobState:
        safe_name = Path(upload.filename or "").name
        suffix = Path(safe_name).suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise HTTPException(400, "mp3와 wav 파일만 업로드할 수 있습니다.")
        if upload.size is not None and upload.size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, f"업로드 한도는 {MAX_UPLOAD_BYTES // 1024**2}MB입니다.")

        job_id = uuid.uuid4().hex
        job_dir = JOBS_DIR / job_id
        upload_dir = UPLOADS_DIR / job_id
        source_path = upload_dir / safe_name
        fingerprint = hashlib.sha256()
        size = 0
        accepted = False
        try:
            upload_dir.mkdir()
            with source_path.open("wb") as handle:
                while chunk := await upload.read(1024 * 1024):
                    size += len(chunk)
                    if size > MAX_UPLOAD_BYTES:
                        raise HTTPException(413, f"업로드 한도는 {MAX_UPLOAD_BYTES // 1024**2}MB입니다.")
                    fingerprint.update(chunk)
                    handle.write(chunk)
            if not size:
                raise HTTPException(400, "빈 오디오 파일은 업로드할 수 없습니다.")

            digest = fingerprint.hexdigest()
            signature = (digest, safe_name, quality, engine, music_analysis, midi)
            async with self.lock:
                for existing_id, existing in self.active_uploads.items():
                    if existing == signature and self.jobs[existing_id].status in {"queued", "running"}:
                        return self.jobs[existing_id]
                pending = sum(state.status in {"queued", "running"} for state in self.jobs.values())
                if pending >= MAX_PENDING_JOBS:
                    raise HTTPException(429, "작업 대기열이 가득 찼습니다. 잠시 후 다시 업로드하세요.")

                state = JobState(
                    id=job_id, status="queued", progress=0.0, message="대기열에 추가됨",
                    created_at=now_iso(), updated_at=now_iso(), original_filename=safe_name,
                    source_path=str(source_path), job_dir=str(job_dir),
                    separation_quality=quality, separation_status="pending",
                    separation_engine=engine, music_analysis=music_analysis, midi=midi, audio_digest=digest,
                )
                self._write_state(state)
                self.jobs[job_id] = state
                self.active_uploads[job_id] = signature
                self.queue.put_nowait(job_id)
                accepted = True
                return state
        finally:
            if not accepted:
                shutil.rmtree(upload_dir, ignore_errors=True)
                shutil.rmtree(job_dir, ignore_errors=True)

    async def get(self, job_id: str) -> JobState:
        async with self.lock:
            if job_id in self.jobs:
                return self.jobs[job_id]
            loaded = self._read_state(job_id)
            if loaded:
                self.jobs[job_id] = loaded
                return loaded
        raise HTTPException(status_code=404, detail="작업을 찾을 수 없습니다.")

    async def list(self) -> list[JobState]:
        async with self.lock:
            states = list(self.jobs.values())
            known = {state.id for state in states}
            if JOBS_DIR.exists():
                for job_path in JOBS_DIR.iterdir():
                    if not job_path.is_dir() or job_path.name in known:
                        continue
                    loaded = self._read_state(job_path.name)
                    if loaded:
                        self.jobs[loaded.id] = loaded
                        states.append(loaded)
            return sorted(states, key=lambda state: state.created_at, reverse=True)

    async def delete(self, job_id: str) -> None:
        state = await self.get(job_id)
        async with self.lock:
            if state.status == "running":
                raise HTTPException(409, "처리 중인 작업입니다. 분석이 끝난 뒤 삭제할 수 있습니다.")
            self.jobs.pop(job_id, None)
            self.active_uploads.pop(job_id, None)
            shutil.rmtree(JOBS_DIR / state.id, ignore_errors=True)
            shutil.rmtree(UPLOADS_DIR / state.id, ignore_errors=True)

    async def update(self, state: JobState) -> None:
        state.updated_at = now_iso()
        async with self.lock:
            self.jobs[state.id] = state
            self._write_state(state)

    async def link_cached_stems(self, key: str, destination: Path) -> Path | None:
        async with self.lock:
            for job in reversed(self.jobs.values()):
                if job.status != "done" or job.separation_status != "succeeded" or job.separation_cache_key != key:
                    continue
                try:
                    destination.mkdir()
                    for name in STEMS:
                        filename = f"{name}.wav"
                        os.link(JOBS_DIR / job.id / "stems" / filename, destination / filename)
                except OSError:
                    shutil.rmtree(destination, ignore_errors=True)
                else:
                    return JOBS_DIR / job.id
        return None

    async def load_cached_music(self, key: str) -> dict | None:
        async with self.lock:
            for job in reversed(self.jobs.values()):
                if job.status == "done" and job.music_cache_key == key:
                    result = read_cached_music(JOBS_DIR / job.id)
                    if result is not None:
                        return result
        return None

    def _write_state(self, state: JobState) -> None:
        path = JOBS_DIR / state.id / "job.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        temporary = path.with_suffix(".json.tmp")
        temporary.write_text(state.model_dump_json(indent=2), encoding="utf-8")
        temporary.replace(path)

    def _read_state(self, job_id: str) -> JobState | None:
        if not re.fullmatch(r"[0-9a-f]{32}", job_id):
            return None
        path = JOBS_DIR / job_id / "job.json"
        if not path.is_file():
            return None
        try:
            return JobState.model_validate_json(path.read_text(encoding="utf-8"))
        except (OSError, ValidationError):
            logger.exception("Cannot load job %s", job_id)
            return None


store = JobStore()
processor = MusicProcessor(store.update, store.link_cached_stems, store.load_cached_music)


def configured_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "").strip()
    if not raw:
        return []
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


async def recover_interrupted_jobs() -> None:
    for state in await store.list():
        if state.status not in {"queued", "running"}:
            continue
        if (Path(state.job_dir) / "analysis.json").is_file():
            state.status = "done"
            state.progress = 1.0
            state.message = "분석 완료"
        else:
            cleanup_failed_artifacts(Path(state.job_dir), Path(state.source_path))
            state.separation_status = "failed"
            state.status = "error"
            state.error = state.separation_error = "서버가 재시작되어 작업이 중단되었습니다. 파일을 다시 업로드하세요."
            state.message = "처리 중단"
        await store.update(state)


async def worker() -> None:
    while True:
        job_id = await store.queue.get()
        try:
            async with store.lock:
                state = store.jobs.get(job_id)
                if state is None:
                    continue
                state.status = "running"
            await processor.process(state)
        except Exception:
            logger.exception("Music job failed: %s", job_id)
        finally:
            store.active_uploads.pop(job_id, None)
            store.queue.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    if os.name == "nt":
        async with run_server():
            yield
        return

    import fcntl

    STORAGE_DIR.mkdir(parents=True, exist_ok=True)
    with (STORAGE_DIR / ".server.lock").open("a") as storage_lock:
        fcntl.flock(storage_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        async with run_server():
            yield


@asynccontextmanager
async def run_server():
    for directory in (UPLOADS_DIR, JOBS_DIR):
        directory.mkdir(parents=True, exist_ok=True)
    shutil.rmtree(EXPORTS_DIR, ignore_errors=True)
    EXPORTS_DIR.mkdir()
    await recover_interrupted_jobs()
    task = asyncio.create_task(worker())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(title="Local Music Analysis MVP", lifespan=lifespan)

cors_origins = configured_cors_origins()
if cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
        expose_headers=["Content-Disposition"],
    )


def public_job(state: JobState) -> JobResponse:
    return JobResponse(**state.model_dump(exclude={"source_path", "job_dir", "audio_digest", "separation_cache_key", "music_cache_key"}))


def safe_download_name(name: str, suffix: str) -> str:
    stem = Path(name).stem or "song"
    safe = "".join(ch if ch.isalnum() or ch in {" ", "-", "_", "."} else "_" for ch in stem).strip()
    return f"{safe[:80] or 'song'}{suffix}"


def read_analysis(state: JobState) -> dict:
    analysis_path = Path(state.job_dir) / "analysis.json"
    if state.status != "done" or not analysis_path.is_file():
        raise HTTPException(404, "분석 결과가 아직 준비되지 않았습니다.")
    analysis = json.loads(analysis_path.read_text(encoding="utf-8"))
    paths = resolve_stem_audio_paths(state, analysis)
    legacy = "separation_status" not in analysis
    fallback = legacy and any("fallback" in warning.lower() for warning in analysis.get("warnings", []))
    if analysis.get("separation_status") != "failed" and not fallback and set(paths) == set(STEMS):
        analysis["separation_status"] = "succeeded"
        analysis["separation_error"] = None
        if legacy:
            # Older results could include synthetic peaks even for valid Demucs audio.
            for stem in analysis["stems"]:
                stem["waveform"] = []
    else:
        analysis["separation_status"] = "failed"
        analysis["separation_error"] = analysis.get("separation_error") or (
            "이 작업에는 확인 가능한 6개 스템 파일이 없습니다. 다시 업로드해 분리하세요."
        )
        for stem in analysis.get("stems", []):
            stem.update(audio_url=None, midi_url=None, waveform=[])
    return analysis


def resolve_stem_audio_paths(state: JobState, analysis: dict) -> dict[str, Path]:
    root = Path(state.job_dir).resolve()
    prefix = f"/api/jobs/{state.id}/assets/"
    paths: dict[str, Path] = {}
    for stem in analysis.get("stems", []):
        name = stem.get("name")
        audio_url = stem.get("audio_url") or ""
        if name not in STEMS or not audio_url.startswith(prefix):
            continue
        target = (root / audio_url[len(prefix):]).resolve()
        if root in target.parents and target.is_file() and target.stat().st_size > 0:
            paths[name] = target
    return paths


async def stem_download(
    job_id: str,
    mode: Literal["mix", "zip", "single"],
    audio_format: AudioFormat,
    suffix: str,
    selected: list[str],
) -> FileResponse:
    # Prepare one export at a time while keeping the API event loop responsive.
    # Export files are independent of the job directory once generation completes.
    async with export_lock:
        state = await store.get(job_id)
        analysis = read_analysis(state)
        if analysis["separation_status"] != "succeeded":
            raise HTTPException(409, analysis["separation_error"])
        available = resolve_stem_audio_paths(state, analysis)
        paths = {name: available[name] for name in selected}
        extension = "zip" if mode == "zip" else audio_format
        filename = safe_download_name(state.original_filename, f"-{suffix}.{extension}")
        directory = Path(tempfile.mkdtemp(prefix=f"{job_id}-", dir=EXPORTS_DIR))
        output = directory / f"download.{extension}"
        try:
            if mode == "zip":
                await run_in_threadpool(exports.export_zip, paths, output, Path(filename).stem, analysis, audio_format)
            elif mode == "single":
                source = next(iter(paths.values()))
                await run_in_threadpool(exports.export_stem, source, output, audio_format)
            else:
                await run_in_threadpool(exports.export_mix, paths, output, audio_format)
        except BaseException:
            shutil.rmtree(directory, ignore_errors=True)
            raise
    return FileResponse(
        output, media_type=exports.MEDIA_TYPES[extension], filename=filename,
        background=BackgroundTask(shutil.rmtree, directory, ignore_errors=True),
    )


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "app": "local-music-analysis",
        "ffmpeg": bool(find_executable("ffmpeg")),
        "separation": {
            "enabled": env_flag("MUSIC_ENABLE_DEMUCS", True),
            "demucs_installed": demucs_installed(),
            "model": DEMUCS_MODEL,
        },
    }


@app.options("/api/{path:path}")
def api_options(path: str) -> Response:
    return Response(status_code=204)


@app.post("/api/jobs", response_model=JobResponse)
async def create_job(
    file: Annotated[UploadFile, File(...)],
    quality: Annotated[SeparationQuality, Form()] = "standard",
    engine: Annotated[Engine | None, Form()] = None,
    music_analysis: Annotated[bool, Form()] = True,
    midi: Annotated[bool, Form()] = True,
) -> JobResponse:
    try:
        requested = engine or default_engine()
    except ValueError as exc:
        raise HTTPException(503, str(exc)) from exc
    state = await store.create(file, quality, requested, music_analysis, midi)
    return public_job(state)


@app.get("/api/jobs", response_model=list[JobResponse])
async def list_jobs() -> list[JobResponse]:
    states = await store.list()
    return [public_job(state) for state in states]


@app.get("/api/jobs/{job_id}/analysis")
async def get_analysis(job_id: str) -> dict:
    return read_analysis(await store.get(job_id))


@app.get("/api/jobs/{job_id}/assets/{asset_path:path}")
async def get_asset(job_id: str, asset_path: str) -> FileResponse:
    state = await store.get(job_id)
    root = Path(state.job_dir).resolve()
    target = (root / asset_path).resolve()
    if not target.is_file() or root not in target.parents:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    if state.separation_status == "unverified" and target.is_relative_to(root / "stems"):
        if read_analysis(state)["separation_status"] != "succeeded":
            raise HTTPException(404, "확인된 스템 오디오가 없습니다.")
    return FileResponse(target)


@app.get("/api/jobs/{job_id}/export/mix")
async def export_mix(job_id: str, format: AudioFormat = "m4a") -> FileResponse:
    return await stem_download(job_id, "mix", format, "mix", STEMS)


@app.get("/api/jobs/{job_id}/export/instrumental")
async def export_instrumental(job_id: str, format: AudioFormat = "wav") -> FileResponse:
    selected = [stem for stem in STEMS if stem != "vocals"]
    return await stem_download(job_id, "mix", format, "instrumental", selected)


@app.get("/api/jobs/{job_id}/export/stems")
async def export_stems(
    job_id: str,
    stem: Annotated[list[str] | None, Query()] = None,
    mode: Literal["mix", "zip", "single"] = "mix",
    format: AudioFormat | None = None,
) -> FileResponse:
    if mode != "zip" and not stem:
        raise HTTPException(400, "내보낼 파트를 하나 이상 선택하세요.")
    selected = list(dict.fromkeys(stem or STEMS))
    if any(name not in STEMS for name in selected):
        raise HTTPException(400, "알 수 없는 스템 이름입니다.")
    if mode == "single" and len(selected) != 1:
        raise HTTPException(400, "개별 다운로드에는 파트를 하나만 선택하세요.")
    suffix = selected[0] if mode == "single" else "stems" if mode == "zip" else "selected-stems"
    return await stem_download(job_id, mode, format or ("m4a" if mode == "mix" else "wav"), suffix, selected)


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    state = await store.get(job_id)
    return public_job(state)


@app.delete("/api/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str) -> None:
    async with export_lock:
        await store.delete(job_id)


@app.post("/api/jobs/{job_id}/delete", status_code=204)
async def post_delete_job(job_id: str) -> None:
    await delete_job(job_id)


@app.post("/api/jobs/delete/{job_id}", status_code=204)
async def post_delete_job_alt(job_id: str) -> None:
    await delete_job(job_id)


# In browser development Vite serves the UI.  The macOS app instead provides a
# built Vite directory here, so one local server can serve both the UI and API.
_frontend_dir = os.getenv("MUSIC_FRONTEND_DIR")
if _frontend_dir and (Path(_frontend_dir) / "index.html").is_file():
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")
