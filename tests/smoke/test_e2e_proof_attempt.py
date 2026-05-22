from dataclasses import dataclass
import unittest

from search.beam_search import BeamSearchProver, SearchConfig


@dataclass
class StubState:
    goal: str
    hypotheses: list[str]


class DeterministicStubGenerator:
    def generate(self, state, retrieved_traces=None, k=5):
        _ = retrieved_traces
        _ = k
        if state["previous_steps"]:
            return ["noop"]
        return ["finish"]


class DeterministicStubExecutor:
    def run_tactic(self, theorem, previous_steps, tactic, depth):
        _ = theorem
        _ = depth
        success = tactic == "finish" and len(previous_steps) == 0
        next_state = StubState(goal="" if success else "⊢ True", hypotheses=[])
        return type(
            "Result",
            (),
            {
                "success": success,
                "next_state": next_state,
                "proof_complete": success,
                "error": None if success else "stub failure",
                "timed_out": False,
            },
        )()


class TestEndToEndProofAttemptSmoke(unittest.TestCase):
    def test_stubbed_end_to_end_proof_attempt_is_deterministic(self):
        prover = BeamSearchProver(
            executor=DeterministicStubExecutor(),
            generator=DeterministicStubGenerator(),
            config=SearchConfig(beam_width=1, max_depth=2, candidates_per_node=1),
        )

        result = prover.prove("theorem smoke : True := by", "⊢ True")

        self.assertEqual(result.status, "solved")
        self.assertEqual(result.best_partial, ["finish"])
        self.assertEqual(result.invalid_count, 0)


if __name__ == "__main__":
    unittest.main()
