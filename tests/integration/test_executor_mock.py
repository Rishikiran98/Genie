from dataclasses import dataclass
import unittest

from lean_env.parser import ParsedProofState
from search.beam_search import BeamSearchProver, SearchConfig


@dataclass
class FakeResult:
    success: bool
    next_state: ParsedProofState | None
    proof_complete: bool
    error: str | None = None
    timed_out: bool = False


class FakeExecutor:
    def __init__(self, table):
        self.table = table

    def run_tactic(self, theorem, previous_steps, tactic, depth):
        _ = theorem
        key = (tuple(previous_steps), tactic)
        value = self.table[key]
        if callable(value):
            return value(depth)
        return value


class FakeGenerator:
    def __init__(self, mapping):
        self.mapping = mapping

    def generate(self, state, retrieved_traces=None, k=5):
        _ = retrieved_traces
        _ = k
        return self.mapping[tuple(state["previous_steps"])]


def mk_state(goal: str, hyps=None):
    hyps = hyps or []
    return ParsedProofState(
        primary_goal=goal or None,
        goals=[goal] if goal else [],
        hypotheses=hyps,
        local_context=[],
        errors=[],
        warnings=[],
        depth=0,
        raw_output="",
    )


class TestExecutorWithMockedSearchLoop(unittest.TestCase):
    def test_branch_selection_prefers_highest_scoring_candidates(self):
        generator = FakeGenerator({(): ["slow", "good", "bad"], ("good",): ["finish"]})
        executor = FakeExecutor(
            {
                ((), "slow"): FakeResult(True, mk_state("⊢ A"), False),
                ((), "good"): FakeResult(True, mk_state(""), True),
                ((), "bad"): FakeResult(False, None, False, error="invalid"),
                (("good",), "finish"): FakeResult(True, mk_state(""), True),
            }
        )
        prover = BeamSearchProver(executor, generator, SearchConfig(beam_width=1, max_depth=3, candidates_per_node=3))
        result = prover.prove("theorem t : True := by", "⊢ True")

        self.assertEqual(result.status, "solved")
        self.assertEqual(result.best_partial, ["good"])
        self.assertEqual(result.invalid_count, 0)

    def test_early_stop_on_first_proof_complete(self):
        generator = FakeGenerator({(): ["finish", "other"]})
        executor = FakeExecutor(
            {
                ((), "finish"): FakeResult(True, mk_state(""), True),
                ((), "other"): FakeResult(True, mk_state("⊢ X"), False),
            }
        )
        prover = BeamSearchProver(executor, generator, SearchConfig(beam_width=2, max_depth=5, candidates_per_node=2))
        result = prover.prove("theorem t : True := by", "⊢ True")

        self.assertEqual(result.status, "solved")
        self.assertEqual(result.best_partial, ["finish"])
        self.assertIsNotNone(result.proof)


if __name__ == "__main__":
    unittest.main()
