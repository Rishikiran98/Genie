from __future__ import annotations

import re
import subprocess
import tempfile
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

from lean_env.parser import ParsedProofState, ProofStateParser


ResultState = Literal[
    "parseable_proof_state",
    "tactic_failure",
    "compile_import_failure",
    "timeout",
]
ErrorCategory = Literal["timeout", "unknown_identifier", "tactic_failed", "compile_failed", "other"]
ExecutorMode = Literal["batch", "session"]


@dataclass
class TacticResult:
    tactic: str
    success: bool
    next_state: ParsedProofState | None
    error: str | None
    proof_complete: bool
    latency_ms: int
    state: ResultState
    error_category: ErrorCategory | None
    stdout: str
    stderr: str
    raw_output: str


class LeanSession:
    """Future-ready abstraction for persistent Lean execution backends."""

    def setup_theorem(self, theorem: str) -> None:
        raise NotImplementedError

    def run_tactic(self, tactic: str, depth: int) -> TacticResult:
        raise NotImplementedError

    def close(self) -> None:
        return None


class BatchLeanSession(LeanSession):
    """Current file-based execution model that recompiles from scratch."""

    def __init__(self, lean_cmd: str, timeout_sec: int, parser: ProofStateParser):
        self.lean_cmd = lean_cmd
        self.timeout_sec = timeout_sec
        self.parser = parser
        self.theorem: str | None = None
        self.steps: list[str] = []

    def setup_theorem(self, theorem: str) -> None:
        self.theorem = theorem
        self.steps = []

    def run_tactic(self, tactic: str, depth: int) -> TacticResult:
        if self.theorem is None:
            raise RuntimeError("setup_theorem must be called before run_tactic")

        self.steps.append(tactic)
        content = self._build_file(self.theorem, self.steps)

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
            except subprocess.TimeoutExpired as err:
                latency_ms = int((time.time() - start) * 1000)
                stdout = (err.stdout or "") if isinstance(err.stdout, str) else ""
                stderr = (err.stderr or "") if isinstance(err.stderr, str) else ""
                raw_output = self._join_output(stdout, stderr)
                self.steps.pop()
                return TacticResult(
                    tactic=tactic,
                    success=False,
                    next_state=None,
                    error="Lean timeout",
                    proof_complete=False,
                    latency_ms=latency_ms,
                    state="timeout",
                    error_category="timeout",
                    stdout=stdout,
                    stderr=stderr,
                    raw_output=raw_output,
                )

            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            raw_output = self._join_output(stdout, stderr)
            state = self.parser.parse(raw_output, depth=depth)

            result_state = self._classify_result_state(proc.returncode, state.errors)
            success = result_state == "parseable_proof_state"
            if not success:
                self.steps.pop()

            proof_complete = success and state.goal == ""
            error = None if success else (state.errors[-1] if state.errors else "Lean compilation/tactic error")

            return TacticResult(
                tactic=tactic,
                success=success,
                next_state=state,
                error=error,
                proof_complete=proof_complete,
                latency_ms=latency_ms,
                state=result_state,
                error_category=None if success else self._categorize_error(raw_output),
                stdout=stdout,
                stderr=stderr,
                raw_output=raw_output,
            )

    @staticmethod
    def _build_file(theorem: str, tactics: list[str]) -> str:
        tactic_block = "\n  ".join(tactics) if tactics else ""
        return f"""import Mathlib\n\n{theorem}\n  {tactic_block}\n"""

    @staticmethod
    def _join_output(stdout: str, stderr: str) -> str:
        if stdout and stderr:
            return f"{stdout}\n{stderr}"
        return stdout or stderr

    @staticmethod
    def _classify_result_state(returncode: int, errors: list[str]) -> ResultState:
        if returncode == 0:
            return "parseable_proof_state"

        if any(BatchLeanSession._looks_like_tactic_failure(e) for e in errors):
            return "tactic_failure"

        return "compile_import_failure"

    @staticmethod
    def _looks_like_tactic_failure(error_line: str) -> bool:
        msg = error_line.lower()
        tactic_patterns = (
            r"\btactic\b",
            r"no goals to be solved",
            r"unsolved goals",
            r"failed to synthesize",
            r"did not close goal",
        )
        return any(re.search(pattern, msg) for pattern in tactic_patterns)

    @staticmethod
    def _categorize_error(output: str) -> ErrorCategory:
        msg = output.lower()
        if "unknown identifier" in msg:
            return "unknown_identifier"
        if "timeout" in msg:
            return "timeout"
        if "tactic" in msg or "unsolved goals" in msg or "no goals" in msg:
            return "tactic_failed"
        if "error:" in msg:
            return "compile_failed"
        return "other"


class SessionLeanSession(LeanSession):
    """Stub implementation for future persistent Lean/LSP execution."""

    def __init__(self, lean_cmd: str, timeout_sec: int, parser: ProofStateParser):
        self.lean_cmd = lean_cmd
        self.timeout_sec = timeout_sec
        self.parser = parser
        self.theorem: str | None = None

    def setup_theorem(self, theorem: str) -> None:
        self.theorem = theorem

    def run_tactic(self, tactic: str, depth: int) -> TacticResult:
        return TacticResult(
            tactic=tactic,
            success=False,
            next_state=None,
            error="Session mode is not implemented yet",
            proof_complete=False,
            latency_ms=0,
            state="compile_import_failure",
            error_category="other",
            stdout="",
            stderr="Session mode is not implemented yet",
            raw_output="Session mode is not implemented yet",
        )


class LeanExecutor:
    def __init__(self, lean_cmd: str = "lean", timeout_sec: int = 5, mode: ExecutorMode = "batch"):
        self.lean_cmd = lean_cmd
        self.timeout_sec = timeout_sec
        self.parser = ProofStateParser()
        self.mode = mode
        self._session = self._create_session(mode)

    def _create_session(self, mode: ExecutorMode) -> LeanSession:
        if mode == "session":
            return SessionLeanSession(self.lean_cmd, self.timeout_sec, self.parser)
        return BatchLeanSession(self.lean_cmd, self.timeout_sec, self.parser)

    def begin_theorem(self, theorem: str) -> None:
        self._session.setup_theorem(theorem)

    def run_tactic(self, theorem: str, previous_steps: list[str], tactic: str, depth: int) -> TacticResult:
        # Backward-compatible stateless API.
        self.begin_theorem(theorem)
        for step in previous_steps:
            _ = self._session.run_tactic(step, depth=depth)
        return self._session.run_tactic(tactic, depth=depth)

    def step_tactic(self, tactic: str, depth: int) -> TacticResult:
        # Incremental API for session-like usage.
        return self._session.run_tactic(tactic, depth=depth)
