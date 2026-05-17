from __future__ import annotations

from lean_env.executor import LeanExecutor
from memory.pgvector_store import InMemoryVectorStore
from memory.retrieval import RetrievalEngine
from policy_model.tactic_generator import TacticGenerator
from search.beam_search import BeamSearchProver, SearchConfig


def main() -> None:
    theorem = "theorem add_zero (n : Nat) : n + 0 = n := by"
    initial_goal = "n + 0 = n"

    executor = LeanExecutor()
    generator = TacticGenerator()
    store = InMemoryVectorStore()
    retrieval = RetrievalEngine(store)

    prover = BeamSearchProver(
        executor=executor,
        generator=generator,
        config=SearchConfig(beam_width=3, max_depth=8, candidates_per_node=4),
    )

    solved_node = prover.prove(theorem=theorem, initial_goal=initial_goal, retrieve_fn=retrieval.retrieve)
    if solved_node:
        print("Solved theorem with tactics:", solved_node.history)
    else:
        print("Failed to solve theorem within search limits.")


if __name__ == "__main__":
    main()
