import unittest

from search.scorer import score_transition


class TestScorerBehavior(unittest.TestCase):
    def test_success_incomplete_goal_penalizes_depth_and_open_goals(self):
        score = score_transition(success=True, proof_complete=False, depth=3, num_goals=2)
        self.assertEqual(score, -3.5)

    def test_failure_penalizes_depth(self):
        score = score_transition(success=False, proof_complete=False, depth=4, num_goals=1)
        self.assertEqual(score, -12.0)

    def test_proof_complete_rewards_and_depth_penalizes(self):
        score = score_transition(success=True, proof_complete=True, depth=6, num_goals=0)
        self.assertEqual(score, 97.0)

    def test_modifiers_apply_additively(self):
        score = score_transition(
            success=False,
            proof_complete=False,
            depth=1,
            num_goals=1,
            invalid_tactic=True,
            timed_out=True,
            repeated_transition=True,
            retrieval_similarity=0.5,
        )
        self.assertEqual(score, -42.5)


if __name__ == "__main__":
    unittest.main()
