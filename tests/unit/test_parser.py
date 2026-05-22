from pathlib import Path
import unittest

from lean_env.parser import ProofStateParser


FIXTURES = Path(__file__).resolve().parents[2] / "lean_env" / "fixtures"


class TestProofStateParserFromFixtures(unittest.TestCase):
    def setUp(self):
        self.parser = ProofStateParser()

    def _read(self, name: str) -> str:
        return (FIXTURES / name).read_text()

    def test_solved_proof_fixture(self):
        parsed = self.parser.parse(self._read("solved_proof.txt"), depth=2)
        self.assertIsNone(parsed.primary_goal)
        self.assertEqual(parsed.goals, [])
        self.assertEqual(parsed.hypotheses, [])
        self.assertEqual(parsed.local_context, [])
        self.assertEqual(parsed.warnings, ["warning: declaration uses 'sorry'"])
        self.assertEqual(parsed.errors, [])
        self.assertEqual(parsed.depth, 2)

    def test_one_goal_fixture(self):
        parsed = self.parser.parse(self._read("one_goal.txt"), depth=1)
        self.assertEqual(parsed.primary_goal, "y = x")
        self.assertEqual(parsed.goals, ["y = x"])
        self.assertEqual(parsed.hypotheses, ["α : Type", "x y : α", "h : x = y"])
        self.assertEqual(parsed.local_context, [])
        self.assertEqual(parsed.warnings, [])
        self.assertEqual(parsed.errors, [])

    def test_multiple_goals_fixture(self):
        parsed = self.parser.parse(self._read("multiple_goals.txt"))
        self.assertEqual(parsed.primary_goal, "n + 0 = n")
        self.assertEqual(parsed.goals, ["y = x", "n + 0 = n"])
        self.assertEqual(parsed.hypotheses, ["n : Nat", "h₁ : n > 0"])
        self.assertEqual(parsed.local_context, ["case right"])
        self.assertEqual(parsed.warnings, [])
        self.assertEqual(parsed.errors, [])

    def test_tactic_error_fixture(self):
        parsed = self.parser.parse(self._read("tactic_error.txt"))
        self.assertEqual(parsed.primary_goal, "x = x")
        self.assertEqual(parsed.goals, ["x = x"])
        self.assertEqual(parsed.hypotheses, ["α : Type", "x : α"])
        self.assertEqual(parsed.local_context, [])
        self.assertEqual(parsed.warnings, ["warning: try `simp?` to inspect simplification lemmas"])
        self.assertEqual(parsed.errors, ["error: tactic 'simp' failed, did not simplify goal"])

    def test_compile_import_error_fixture(self):
        parsed = self.parser.parse(self._read("compile_import_error.txt"))
        self.assertIsNone(parsed.primary_goal)
        self.assertEqual(parsed.goals, [])
        self.assertEqual(parsed.hypotheses, [])
        self.assertEqual(parsed.local_context, [])
        self.assertEqual(parsed.warnings, ["warning: failed to find source for imported module"])
        self.assertEqual(parsed.errors, ["/home/user/project/Main.lean:1:0: error: unknown module prefix 'Mathlib'"])


if __name__ == "__main__":
    unittest.main()
