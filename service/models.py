from __future__ import annotations

from enum import Enum
from pydantic import BaseModel, Field


class JobStatus(str, Enum):
    queued = "queued"
    running = "running"
    succeeded = "succeeded"
    failed = "failed"


class ProveRequest(BaseModel):
    theorem: str = Field(min_length=1)
    initial_goal: str = Field(min_length=1)
    max_depth: int | None = None
    timeout_seconds: int | None = None


class ProveResponse(BaseModel):
    job_id: str
    status: JobStatus


class JobRecord(BaseModel):
    job_id: str
    status: JobStatus
    theorem: str
    initial_goal: str
    max_depth: int
    timeout_seconds: int
    result: dict | None = None
    error: str | None = None


class JobStatusResponse(BaseModel):
    job_id: str
    status: JobStatus
    result: dict | None = None
    error: str | None = None
