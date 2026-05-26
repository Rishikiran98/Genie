from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Any

from service.models import JobRecord


class JobStore(ABC):
    @abstractmethod
    def create(self, job: JobRecord) -> None: ...

    @abstractmethod
    def get(self, job_id: str) -> JobRecord | None: ...

    @abstractmethod
    def update(self, job_id: str, **fields: Any) -> None: ...


class InMemoryJobStore(JobStore):
    def __init__(self) -> None:
        self._jobs: dict[str, JobRecord] = {}

    def create(self, job: JobRecord) -> None:
        self._jobs[job.job_id] = job

    def get(self, job_id: str) -> JobRecord | None:
        return self._jobs.get(job_id)

    def update(self, job_id: str, **fields: Any) -> None:
        current = self._jobs[job_id]
        self._jobs[job_id] = current.model_copy(update=fields)


class FirestoreJobStore(JobStore):
    def __init__(self, collection: str = "jobs") -> None:
        from google.cloud import firestore

        self._client = firestore.Client()
        self._collection = self._client.collection(collection)

    def create(self, job: JobRecord) -> None:
        self._collection.document(job.job_id).set(job.model_dump())

    def get(self, job_id: str) -> JobRecord | None:
        doc = self._collection.document(job_id).get()
        if not doc.exists:
            return None
        return JobRecord.model_validate(doc.to_dict())

    def update(self, job_id: str, **fields: Any) -> None:
        self._collection.document(job_id).update(fields)
