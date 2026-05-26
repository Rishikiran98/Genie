from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class ServiceConfig:
    api_auth_token: str
    queue_backend: str
    firestore_enabled: bool
    max_request_chars: int
    max_depth_cap: int
    max_timeout_seconds_cap: int
    default_depth: int
    default_timeout_seconds: int
    max_requests_per_minute: int
    worker_poll_interval_seconds: float
    cloud_tasks_queue: str | None
    cloud_tasks_location: str | None
    cloud_tasks_project: str | None
    worker_base_url: str | None



def load_config() -> ServiceConfig:
    return ServiceConfig(
        api_auth_token=os.getenv("API_AUTH_TOKEN", ""),
        queue_backend=os.getenv("QUEUE_BACKEND", "memory").lower(),
        firestore_enabled=os.getenv("USE_FIRESTORE", "false").lower() == "true",
        max_request_chars=int(os.getenv("MAX_REQUEST_CHARS", "8000")),
        max_depth_cap=int(os.getenv("MAX_DEPTH_CAP", "12")),
        max_timeout_seconds_cap=int(os.getenv("MAX_TIMEOUT_SECONDS_CAP", "120")),
        default_depth=int(os.getenv("DEFAULT_DEPTH", "8")),
        default_timeout_seconds=int(os.getenv("DEFAULT_TIMEOUT_SECONDS", "30")),
        max_requests_per_minute=int(os.getenv("MAX_REQUESTS_PER_MINUTE", "60")),
        worker_poll_interval_seconds=float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "0.2")),
        cloud_tasks_queue=os.getenv("CLOUD_TASKS_QUEUE"),
        cloud_tasks_location=os.getenv("GCP_REGION"),
        cloud_tasks_project=os.getenv("GCP_PROJECT"),
        worker_base_url=os.getenv("WORKER_BASE_URL"),
    )
