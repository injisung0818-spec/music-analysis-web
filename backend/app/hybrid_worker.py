"""Private Unix-socket worker for the Go server."""
from __future__ import annotations

import asyncio
import os
import re
import signal
from contextlib import asynccontextmanager
from contextlib import suppress
from pathlib import Path

from fastapi import FastAPI, HTTPException

from . import main
from .processor import JobState, MusicProcessor, link_stem_wavs, now_iso, read_cached_music

running: set[asyncio.Task] = set()
owner_pid: int | None = None


async def watch_owner() -> None:
    while owner_pid is not None and os.getppid() == owner_pid:
        await asyncio.sleep(0.25)
    if owner_pid is not None:
        tasks = tuple(running)
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        os.kill(os.getpid(), signal.SIGTERM)


@asynccontextmanager
async def lifespan(app: FastAPI):
    guard = asyncio.create_task(watch_owner())
    try:
        yield
    finally:
        guard.cancel()
        with suppress(asyncio.CancelledError):
            await guard


app = FastAPI(lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.get("/api/health")(main.health)
app.get("/api/jobs/{job_id}/analysis")(main.get_analysis)
app.get("/api/jobs/{job_id}/assets/{asset_path:path}")(main.get_asset)
app.get("/api/jobs/{job_id}/export/mix")(main.export_mix)
app.get("/api/jobs/{job_id}/export/instrumental")(main.export_instrumental)
app.get("/api/jobs/{job_id}/export/stems")(main.export_stems)


@app.post("/internal/process/{job_id}")
async def process_job(job_id: str, cache: dict[str, list[str]]) -> None:
    if not re.fullmatch(r"[0-9a-f]{32}", job_id):
        raise HTTPException(404)
    root = main.JOBS_DIR / job_id
    state = JobState.model_validate_json((root / "job.json").read_text())

    async def update(job: JobState) -> None:
        job.updated_at = now_iso()
        main.store._write_state(job)

    async def reuse(key: str, destination: Path) -> Path | None:
        for candidate in cache.get(key, []):
            if not re.fullmatch(r"[0-9a-f]{32}", candidate):
                continue
            job_dir = main.JOBS_DIR / candidate
            if link_stem_wavs(job_dir / "stems", destination):
                return job_dir
        return None

    async def reuse_music(key: str) -> dict | None:
        for candidate in cache.get(key, []):
            if re.fullmatch(r"[0-9a-f]{32}", candidate):
                result = read_cached_music(main.JOBS_DIR / candidate)
                if result is not None:
                    return result
        return None

    async def watch_cancel(task: asyncio.Task) -> None:
        while not task.done():
            if (root / ".cancel").exists():
                task.cancel()
                return
            await asyncio.sleep(0.1)

    task = asyncio.create_task(MusicProcessor(update, reuse, reuse_music).process(state))
    running.add(task)
    watcher = asyncio.create_task(watch_cancel(task))
    try:
        await task
    except asyncio.CancelledError:
        state.status = "error"
        state.separation_status = "failed"
        state.message = state.error = state.separation_error = "작업이 취소되었습니다."
        await update(state)
        if not (root / ".cancel").exists() and (owner_pid is None or os.getppid() == owner_pid):
            raise
    finally:
        running.discard(task)
        watcher.cancel()
        with suppress(asyncio.CancelledError):
            await watcher


if __name__ == "__main__":
    import sys
    import uvicorn

    owner_pid = int(sys.argv[2]) if len(sys.argv) > 2 else os.getppid()
    uvicorn.run(app, uds=sys.argv[1], access_log=False)
