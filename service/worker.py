from __future__ import annotations

from lean_env.executor import LeanExecutor
from memory.pgvector_store import InMemoryVectorStore
from memory.retrieval import RetrievalEngine
from policy_model.tactic_generator import TacticGenerator
from search.beam_search import BeamSearchProver, SearchConfig
from service.models import JobStatus
from service.store import JobStore


class ProofWorker:
    def __init__(self, store: JobStore) -> None:
        self._store = store

    def process_job(self, job_id: str) -> None:
        job = self._store.get(job_id)
        if not job:
            return
        self._store.update(job_id, status=JobStatus.running)

        try:
            executor = LeanExecutor()
            generator = TacticGenerator()
            retrieval = RetrievalEngine(InMemoryVectorStore())
            prover = BeamSearchProver(
                executor=executor,
                generator=generator,
                config=SearchConfig(
                    beam_width=3,
                    max_depth=job.max_depth,
                    candidates_per_node=4,
                    timeout_seconds=job.timeout_seconds,
                ),
            )
            result = prover.prove(job.theorem, job.initial_goal, retrieval.retrieve)
            payload = {
                "status": result.status,
                "proof": result.proof.history if result.proof else None,
                "nodes_expanded": result.nodes_expanded,
            }
            self._store.update(job_id, status=JobStatus.succeeded, result=payload)
        except Exception as exc:
            self._store.update(job_id, status=JobStatus.failed, error=str(exc))
