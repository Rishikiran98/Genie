from __future__ import annotations

import os

from memory.pgvector_store import InMemoryVectorStore, PgVectorStore


class RetrievalEngine:
    def __init__(self, store: PgVectorStore | InMemoryVectorStore | None = None):
        self.store = store or self._default_store()

    @staticmethod
    def _default_store() -> PgVectorStore | InMemoryVectorStore:
        dsn = os.getenv("GENIE_PGVECTOR_DSN")
        if dsn:
            try:
                return PgVectorStore(dsn=dsn)
            except RuntimeError:
                pass
        return InMemoryVectorStore()

    def retrieve(self, state: dict, top_k: int = 5) -> list[dict]:
        goal = state.get("goal", "")
        success = state.get("success")
        theorem_family_tags = state.get("theorem_family_tags")
        return self.store.query_similar(
            goal=goal,
            top_k=top_k,
            success=success,
            theorem_family_tags=theorem_family_tags,
        )
