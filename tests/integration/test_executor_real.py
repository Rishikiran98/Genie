import shutil
import unittest

from lean_env.executor import LeanExecutor


@unittest.skipUnless(shutil.which("lean"), "Lean binary is not available in PATH")
class TestExecutorRealLeanOptional(unittest.TestCase):
    def test_real_lean_solves_simple_theorem(self):
        executor = LeanExecutor(timeout_sec=10)
        theorem = "theorem ci_smoke_true : True := by"
        result = executor.run_tactic(theorem=theorem, previous_steps=[], tactic="trivial", depth=0)

        self.assertTrue(result.success)
        self.assertTrue(result.proof_complete)


if __name__ == "__main__":
    unittest.main()
