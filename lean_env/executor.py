from __future__ import annotations

import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path

from lean_env.parser import ParsedProofState, ProofStateParser


@dataclass
class TacticResult:
    tactic: str
    success: bool
    next_state: ParsedProofState | None
    error: str | None
    proof_complete: bool
    latency_ms: int


class LeanExecutor:
    def __init__(self, lean_cmd: str = "lean", timeout_sec: int = 5):
        self.lean_cmd = lean_cmd
        self.timeout_sec = timeout_sec
        self.parser = ProofStateParser()

    def _build_file(self, theorem: str, tactics: list[str]) -> str:
        tactic_block = "\n  ".join(tactics) if tactics else ""
        return f"""import Mathlib\n\n{theorem}\n  {tactic_block}\n"""

    def run_tactic(self, theorem: str, previous_steps: list[str], tactic: str, depth: int) -> TacticResult:
        steps = [*previous_steps, tactic]
        content = self._build_file(theorem, steps)

        with tempfile.TemporaryDirectory() as tmpdir:
            lean_file = Path(tmpdir) / "Scratch.lean"
            lean_file.write_text(content)

            start = time.time()
            try:
                proc = subprocess.run(
                    [self.lean_cmd, str(lean_file)],
                    capture_output=True,
                    text=True,
                    timeout=self.timeout_sec,
                )
                latency_ms = int((time.time() - start) * 1000)
            except subprocess.TimeoutExpired:
                return TacticResult(
                    tactic=tactic,
                    success=False,
                    next_state=None,
                    error="Lean timeout",
                    proof_complete=False,
                    latency_ms=int((time.time() - start) * 1000),
                )

            output = (proc.stdout or "") + "\n" + (proc.stderr or "")
            state = self.parser.parse(output, depth=depth)

            success = proc.returncode == 0
            proof_complete = success and state.goal == ""
            error = None if success else (state.errors[-1] if state.errors else "Lean compilation/tactic error")

            return TacticResult(
                tactic=tactic,
                success=success,
                next_state=state,
                error=error,
                proof_complete=proof_complete,
                latency_ms=latency_ms,
            )
