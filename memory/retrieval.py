from __future__ import annotations

from memory.pgvector_store import InMemoryVectorStore


class RetrievalEngine:
    def __init__(self, store: InMemoryVectorStore):
        self.store = store

    def retrieve(self, state: dict, top_k: int = 5) -> list[dict]:
        goal = state.get("goal", "")
        return self.store.query_similar(goal=goal, top_k=top_k)
