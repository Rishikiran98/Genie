from __future__ import annotations

import threading
import time
import uuid
from collections import defaultdict, deque

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from service.config import load_config
from service.models import JobRecord, JobStatus, JobStatusResponse, ProveRequest, ProveResponse
from service.queueing import CloudTasksQueue, InMemoryJobQueue
from service.store import FirestoreJobStore, InMemoryJobStore
from service.worker import ProofWorker

app = FastAPI(title="Genie API")
config = load_config()
store = FirestoreJobStore() if config.firestore_enabled else InMemoryJobStore()
queue = InMemoryJobQueue()
if config.queue_backend == "cloudtasks":
    if not all([config.cloud_tasks_project, config.cloud_tasks_location, config.cloud_tasks_queue, config.worker_base_url, config.api_auth_token]):
        raise RuntimeError("Cloud Tasks backend selected but required env vars missing")
    queue = CloudTasksQueue(
        project=config.cloud_tasks_project,
        location=config.cloud_tasks_location,
        queue_name=config.cloud_tasks_queue,
        worker_base_url=config.worker_base_url,
        auth_token=config.api_auth_token,
    )
worker = ProofWorker(store)
request_log: dict[str, deque[float]] = defaultdict(deque)


def _check_auth(authorization: str | None) -> None:
    if not config.api_auth_token:
        return
    if authorization != f"Bearer {config.api_auth_token}":
        raise HTTPException(status_code=401, detail="invalid auth token")


def _rate_limit(key: str) -> None:
    now = time.time()
    window = request_log[key]
    while window and now - window[0] > 60:
        window.popleft()
    if len(window) >= config.max_requests_per_minute:
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    window.append(now)


def _apply_caps(req: ProveRequest) -> tuple[int, int]:
    if len(req.theorem) > config.max_request_chars:
        raise HTTPException(status_code=400, detail="theorem exceeds max size")
    depth = req.max_depth or config.default_depth
    timeout = req.timeout_seconds or config.default_timeout_seconds
    if depth > config.max_depth_cap:
        raise HTTPException(status_code=400, detail="max_depth above cap")
    if timeout > config.max_timeout_seconds_cap:
        raise HTTPException(status_code=400, detail="timeout above cap")
    return depth, timeout


@app.on_event("startup")
def startup() -> None:
    if isinstance(queue, InMemoryJobQueue):
        thread = threading.Thread(target=_memory_loop, daemon=True)
        thread.start()


def _memory_loop() -> None:
    while True:
        job_id = queue.q.get()
        worker.process_job(job_id)
        time.sleep(config.worker_poll_interval_seconds)


@app.post("/prove", response_model=ProveResponse)
def submit_proof(req: ProveRequest, authorization: str | None = Header(default=None), x_forwarded_for: str | None = Header(default=None)) -> ProveResponse:
    _check_auth(authorization)
    _rate_limit(x_forwarded_for or "local")
    depth, timeout = _apply_caps(req)

    job_id = str(uuid.uuid4())
    store.create(JobRecord(
        job_id=job_id,
        status=JobStatus.queued,
        theorem=req.theorem,
        initial_goal=req.initial_goal,
        max_depth=depth,
        timeout_seconds=timeout,
    ))
    queue.enqueue(job_id)
    return ProveResponse(job_id=job_id, status=JobStatus.queued)


@app.get("/jobs/{job_id}", response_model=JobStatusResponse)
def get_job(job_id: str, authorization: str | None = Header(default=None)) -> JobStatusResponse:
    _check_auth(authorization)
    job = store.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return JobStatusResponse(job_id=job.job_id, status=job.status, result=job.result, error=job.error)


class ProcessJobRequest(BaseModel):
    job_id: str


@app.post("/internal/jobs/process")
def process_job(payload: ProcessJobRequest, authorization: str | None = Header(default=None)) -> dict[str, str]:
    _check_auth(authorization)
    worker.process_job(payload.job_id)
    return {"ok": "true"}


@app.get("/healthz")
def healthz() -> dict[str, str]:
    return {"status": "ok"}
