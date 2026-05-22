import os
import unittest
from unittest.mock import patch

from memory.pgvector_store import InMemoryVectorStore, PgVectorStore
from memory.retrieval import RetrievalEngine


class DummyStore:
    def __init__(self):
        self.calls = []

    def query_similar(self, **kwargs):
        self.calls.append(kwargs)
        return [{"goal": kwargs["goal"], "success": kwargs["success"]}]


class TestRetrievalAdapter(unittest.TestCase):
    def test_default_store_is_in_memory_when_no_dsn(self):
        with patch.dict(os.environ, {}, clear=True):
            engine = RetrievalEngine()
        self.assertIsInstance(engine.store, InMemoryVectorStore)

    def test_default_store_uses_pgvector_when_dsn_is_present(self):
        with patch.dict(os.environ, {"GENIE_PGVECTOR_DSN": "postgresql://example"}, clear=True):
            with patch.object(PgVectorStore, "__init__", return_value=None):
                engine = RetrievalEngine()
        self.assertIsInstance(engine.store, PgVectorStore)

    def test_retrieve_passes_filtering_arguments_to_store(self):
        store = DummyStore()
        engine = RetrievalEngine(store=store)
        results = engine.retrieve(
            {
                "goal": "⊢ True",
                "success": True,
                "theorem_family_tags": ["algebra", "group"],
            },
            top_k=3,
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(store.calls[0]["goal"], "⊢ True")
        self.assertEqual(store.calls[0]["top_k"], 3)
        self.assertTrue(store.calls[0]["success"])
        self.assertEqual(store.calls[0]["theorem_family_tags"], ["algebra", "group"])


if __name__ == "__main__":
    unittest.main()
