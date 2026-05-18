from __future__ import annotations

import base64
import json
import queue
from abc import ABC, abstractmethod


class JobQueue(ABC):
    @abstractmethod
    def enqueue(self, job_id: str) -> None: ...


class InMemoryJobQueue(JobQueue):
    def __init__(self) -> None:
        self.q: queue.Queue[str] = queue.Queue()

    def enqueue(self, job_id: str) -> None:
        self.q.put(job_id)


class CloudTasksQueue(JobQueue):
    def __init__(self, project: str, location: str, queue_name: str, worker_base_url: str, auth_token: str) -> None:
        from google.cloud import tasks_v2

        self._client = tasks_v2.CloudTasksClient()
        self._path = self._client.queue_path(project, location, queue_name)
        self._worker_base_url = worker_base_url.rstrip("/")
        self._auth_token = auth_token

    def enqueue(self, job_id: str) -> None:
        from google.cloud import tasks_v2

        payload = json.dumps({"job_id": job_id}).encode()
        task = {
            "http_request": {
                "http_method": tasks_v2.HttpMethod.POST,
                "url": f"{self._worker_base_url}/internal/jobs/process",
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {self._auth_token}",
                },
                "body": base64.b64encode(payload),
            }
        }
        self._client.create_task(parent=self._path, task=task)
