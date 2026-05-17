from pathlib import Path
import unittest

from lean_env.parser import ProofStateParser


FIXTURES = Path(__file__).resolve().parents[1] / "lean_env" / "fixtures" / "parser"


class TestProofStateParserFromFixtures(unittest.TestCase):
    def setUp(self):
        self.parser = ProofStateParser()

    def _read(self, name: str) -> str:
        return (FIXTURES / name).read_text()

    def test_success_no_goals(self):
        parsed = self.parser.parse(self._read("success_no_goals.txt"), depth=2)
        self.assertEqual(parsed.goal, "")
        self.assertEqual(parsed.active_goals, [])
        self.assertEqual(parsed.errors, [])
        self.assertEqual(parsed.depth, 2)

    def test_one_goal_with_hypotheses(self):
        parsed = self.parser.parse(self._read("one_goal.txt"), depth=1)
        self.assertEqual(parsed.goal, "y = x")
        self.assertEqual(parsed.primary_goal, "y = x")
        self.assertEqual(parsed.hypotheses, ["x y : α", "h : x = y"])
        self.assertEqual(parsed.local_context, [])

    def test_multiple_goals_and_goal_contexts(self):
        parsed = self.parser.parse(self._read("multiple_goals.txt"))
        self.assertEqual(parsed.active_goals, ["y = x", "n + 0 = n"])
        self.assertEqual(len(parsed.goal_contexts), 2)
        self.assertEqual(parsed.goal_contexts[0]["hypotheses"], ["x y : α", "h : x = y"])
        self.assertEqual(parsed.goal_contexts[1]["hypotheses"], ["n : Nat", "h₁ : n > 0"])

    def test_tactic_error_and_import_compile_error_are_collected(self):
        tactic_err = self.parser.parse(self._read("tactic_error.txt"))
        import_err = self.parser.parse(self._read("import_compile_error.txt"))

        self.assertTrue(tactic_err.errors)
        self.assertIn("error:", tactic_err.errors[0].lower())
        self.assertTrue(import_err.errors)
        self.assertIn("error:", import_err.errors[0].lower())


if __name__ == "__main__":
    unittest.main()
