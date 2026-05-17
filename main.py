from __future__ import annotations

from lean_env.executor import LeanExecutor
from memory.pgvector_store import InMemoryVectorStore
from memory.retrieval import RetrievalEngine
from policy_model.tactic_generator import TacticGenerator
from search.beam_search import BeamSearchProver, SearchConfig
from utils.run_logger import JsonlRunLogger


def main() -> None:
    theorem = "theorem add_zero (n : Nat) : n + 0 = n := by"
    initial_goal = "n + 0 = n"

    executor = LeanExecutor()
    generator = TacticGenerator()
    store = InMemoryVectorStore()
    retrieval = RetrievalEngine(store)
    logger = JsonlRunLogger(theorem=theorem)

    prover = BeamSearchProver(
        executor=executor,
        generator=generator,
        config=SearchConfig(beam_width=3, max_depth=8, candidates_per_node=4),
    )

    result = prover.prove(theorem=theorem, initial_goal=initial_goal, retrieve_fn=retrieval.retrieve, logger=logger)
    if result.proof:
        print("Solved theorem with tactics:", result.proof.history)
    else:
        print("Failed to solve theorem within search limits.")

    logger.log_final(
        outcome=result.status,
        extra={
            "explored_nodes": result.explored_nodes,
            "failed_tactics": result.failed_tactics,
            "best_partial_branch": result.best_partial_branch,
            "log_path": logger.path,
        },
    )
    print(f"Run log written to {logger.path}")


if __name__ == "__main__":
    main()
