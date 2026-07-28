from __future__ import annotations

import asyncio
import json
import os
import shutil
import subprocess
import tempfile
import uuid
import zipfile
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response
from starlette.background import BackgroundTask
from pydantic import BaseModel

from .processor import JobState, MusicProcessor, find_executable, now_iso


BASE_DIR = Path(__file__).resolve().parents[1]
STORAGE_DIR = BASE_DIR / "storage"
UPLOADS_DIR = STORAGE_DIR / "uploads"
JOBS_DIR = STORAGE_DIR / "jobs"
ALLOWED_SUFFIXES = {".mp3", ".wav"}
STALE_INCOMPLETE_JOB_SECONDS = 20 * 60
EXPORT_STEMS = {"vocals", "drums", "bass", "guitar", "piano", "other"}


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


class JobStore:
    def __init__(self) -> None:
        self.jobs: dict[str, JobState] = {}
        self.queue: asyncio.Queue[str] = asyncio.Queue()
        self.lock = asyncio.Lock()

    async def create(self, upload: UploadFile) -> JobState:
        suffix = Path(upload.filename or "").suffix.lower()
        if suffix not in ALLOWED_SUFFIXES:
            raise HTTPException(status_code=400, detail="mp3와 wav 파일만 업로드할 수 있습니다.")

        job_id = uuid.uuid4().hex
        job_dir = JOBS_DIR / job_id
        upload_dir = UPLOADS_DIR / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        upload_dir.mkdir(parents=True, exist_ok=True)

        safe_name = Path(upload.filename or f"upload{suffix}").name
        source_path = upload_dir / safe_name
        with source_path.open("wb") as handle:
            while chunk := await upload.read(1024 * 1024):
                handle.write(chunk)

        state = JobState(
            id=job_id,
            status="queued",
            progress=0.0,
            message="대기열에 추가됨",
            created_at=now_iso(),
            updated_at=now_iso(),
            original_filename=safe_name,
            source_path=str(source_path),
            job_dir=str(job_dir),
        )
        async with self.lock:
            self.jobs[job_id] = state
            self._write_state(state)
        await self.queue.put(job_id)
        return state

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
            self.jobs.pop(job_id, None)
        shutil.rmtree(Path(state.job_dir), ignore_errors=True)
        shutil.rmtree(Path(state.source_path).parent, ignore_errors=True)

    async def update(self, state: JobState) -> None:
        state.updated_at = now_iso()
        async with self.lock:
            self.jobs[state.id] = state
            self._write_state(state)

    def _write_state(self, state: JobState) -> None:
        path = JOBS_DIR / state.id / "job.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state.model_dump(), indent=2), encoding="utf-8")

    def _read_state(self, job_id: str) -> JobState | None:
        path = JOBS_DIR / job_id / "job.json"
        if not path.exists():
            return None
        return JobState(**json.loads(path.read_text(encoding="utf-8")))


store = JobStore()
processor = MusicProcessor(store.update)


def configured_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "").strip()
    if not raw:
        return []
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def cleanup_stale_incomplete_jobs() -> None:
    if not JOBS_DIR.exists():
        return
    now = datetime.now(timezone.utc)
    for job_path in JOBS_DIR.iterdir():
        job_json = job_path / "job.json"
        if not job_path.is_dir() or not job_json.exists():
            continue
        try:
            data = json.loads(job_json.read_text(encoding="utf-8"))
            if data.get("status") == "done" or (job_path / "analysis.json").exists():
                continue
            updated_at = datetime.fromisoformat(str(data.get("updated_at", "")).replace("Z", "+00:00"))
            if updated_at.tzinfo is None:
                updated_at = updated_at.replace(tzinfo=timezone.utc)
            if (now - updated_at).total_seconds() < STALE_INCOMPLETE_JOB_SECONDS:
                continue
            shutil.rmtree(job_path, ignore_errors=True)
            source_path = data.get("source_path")
            if source_path:
                shutil.rmtree(Path(source_path).parent, ignore_errors=True)
        except Exception:
            continue


async def worker() -> None:
    while True:
        job_id = await store.queue.get()
        try:
            state = await store.get(job_id)
            await processor.process(state)
        finally:
            store.queue.task_done()


@asynccontextmanager
async def lifespan(app: FastAPI):
    STORAGE_DIR.mkdir(exist_ok=True)
    UPLOADS_DIR.mkdir(exist_ok=True)
    JOBS_DIR.mkdir(exist_ok=True)
    cleanup_stale_incomplete_jobs()
    task = asyncio.create_task(worker())
    yield
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
    )
else:
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def public_job(state: JobState) -> JobResponse:
    return JobResponse(**state.model_dump(exclude={"source_path", "job_dir"}))


def safe_download_name(name: str, suffix: str) -> str:
    stem = Path(name).stem or "song"
    safe = "".join(ch if ch.isalnum() or ch in {" ", "-", "_", "."} else "_" for ch in stem).strip()
    return f"{safe[:80] or 'song'}{suffix}"


def read_analysis_for_export(state: JobState) -> dict:
    analysis_path = Path(state.job_dir) / "analysis.json"
    if state.status != "done" or not analysis_path.exists():
        raise HTTPException(status_code=404, detail="분석 완료된 노래만 내보낼 수 있습니다.")
    return json.loads(analysis_path.read_text(encoding="utf-8"))


def resolve_stem_audio_paths(state: JobState, selected_stems: list[str] | None = None) -> dict[str, Path]:
    analysis = read_analysis_for_export(state)
    root = Path(state.job_dir).resolve()
    selected = set(selected_stems or EXPORT_STEMS)
    paths: dict[str, Path] = {}
    for stem in analysis.get("stems", []):
        name = stem.get("name")
        audio_url = stem.get("audio_url")
        if name not in selected or not audio_url:
            continue
        asset_prefix = f"/api/jobs/{state.id}/assets/"
        if not str(audio_url).startswith(asset_prefix):
            continue
        target = (root / str(audio_url)[len(asset_prefix):]).resolve()
        if target.is_file() and root in target.parents:
            paths[name] = target
    return paths


def cleanup_export_path(path: Path) -> None:
    shutil.rmtree(path.parent, ignore_errors=True)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": "local-music-analysis"}


@app.options("/api/{path:path}")
def api_options(path: str) -> Response:
    return Response(status_code=204)


@app.post("/api/jobs", response_model=JobResponse)
async def create_job(file: Annotated[UploadFile, File(...)]) -> JobResponse:
    state = await store.create(file)
    return public_job(state)


@app.get("/api/jobs", response_model=list[JobResponse])
async def list_jobs() -> list[JobResponse]:
    states = await store.list()
    return [public_job(state) for state in states]


@app.get("/api/jobs/{job_id}/analysis")
async def get_analysis(job_id: str) -> dict:
    state = await store.get(job_id)
    analysis_path = Path(state.job_dir) / "analysis.json"
    if state.status != "done" or not analysis_path.exists():
        raise HTTPException(status_code=404, detail="분석 결과가 아직 준비되지 않았습니다.")
    return json.loads(analysis_path.read_text(encoding="utf-8"))


@app.get("/api/jobs/{job_id}/assets/{asset_path:path}")
async def get_asset(job_id: str, asset_path: str) -> FileResponse:
    state = await store.get(job_id)
    root = Path(state.job_dir).resolve()
    target = (root / asset_path).resolve()
    if not target.is_file() or root not in target.parents:
        raise HTTPException(status_code=404, detail="파일을 찾을 수 없습니다.")
    return FileResponse(target)


@app.get("/api/jobs/{job_id}/export/mix")
async def export_mix(job_id: str) -> FileResponse:
    state = await store.get(job_id)
    paths = resolve_stem_audio_paths(state)
    if not paths:
        raise HTTPException(status_code=404, detail="내보낼 오디오 파일이 없습니다.")

    ffmpeg = find_executable("ffmpeg")
    if not ffmpeg:
        raise HTTPException(status_code=503, detail="전체 내보내기에는 ffmpeg가 필요합니다.")

    export_dir = Path(tempfile.mkdtemp(prefix=f"{job_id}-export-"))
    output = export_dir / "mix.m4a"
    cmd = [ffmpeg, "-y", "-nostdin", "-hide_banner", "-loglevel", "error"]
    for path in paths.values():
        cmd.extend(["-i", str(path)])
    inputs = "".join(f"[{index}:a]" for index in range(len(paths)))
    cmd.extend([
        "-filter_complex",
        f"{inputs}amix=inputs={len(paths)}:duration=longest:dropout_transition=0,volume={len(paths)}[mix]",
        "-map",
        "[mix]",
        "-c:a",
        "aac",
        "-b:a",
        os.getenv("MUSIC_EXPORT_BITRATE", "160k"),
        "-movflags",
        "+faststart",
        str(output),
    ])
    completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if completed.returncode != 0 or not output.exists():
        shutil.rmtree(export_dir, ignore_errors=True)
        detail = completed.stderr.strip().splitlines()[-1] if completed.stderr.strip() else "전체 믹스 생성 실패"
        raise HTTPException(status_code=500, detail=detail)

    return FileResponse(
        output,
        media_type="audio/mp4",
        filename=safe_download_name(state.original_filename, "-mix.m4a"),
        background=BackgroundTask(cleanup_export_path, output),
    )


@app.get("/api/jobs/{job_id}/export/stems")
async def export_stems(job_id: str, stem: Annotated[list[str], Query()] = None) -> FileResponse:
    state = await store.get(job_id)
    selected = [item for item in dict.fromkeys(stem or []) if item in EXPORT_STEMS]
    if not selected:
        raise HTTPException(status_code=400, detail="내보낼 파트를 하나 이상 선택하세요.")

    paths = resolve_stem_audio_paths(state, selected)
    if not paths:
        raise HTTPException(status_code=404, detail="선택한 파트의 오디오 파일이 없습니다.")

    export_dir = Path(tempfile.mkdtemp(prefix=f"{job_id}-stems-"))
    output = export_dir / "stems.zip"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        for name in selected:
            path = paths.get(name)
            if path:
                archive.write(path, arcname=f"{name}{path.suffix}")

    return FileResponse(
        output,
        media_type="application/zip",
        filename=safe_download_name(state.original_filename, "-stems.zip"),
        background=BackgroundTask(cleanup_export_path, output),
    )


@app.get("/api/jobs/{job_id}", response_model=JobResponse)
async def get_job(job_id: str) -> JobResponse:
    state = await store.get(job_id)
    return public_job(state)


@app.delete("/api/jobs/{job_id}", status_code=204)
async def delete_job(job_id: str) -> None:
    await store.delete(job_id)


@app.post("/api/jobs/{job_id}/delete", status_code=204)
async def post_delete_job(job_id: str) -> None:
    await store.delete(job_id)


@app.post("/api/jobs/delete/{job_id}", status_code=204)
async def post_delete_job_alt(job_id: str) -> None:
    await store.delete(job_id)
