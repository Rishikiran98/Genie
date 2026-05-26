from __future__ import annotations

import os
import re
import subprocess
import tempfile
import time
import uuid
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
ErrorCategory = Literal["timeout", "parse_error", "compile_error", "tactic_error", "internal_error"]
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


@dataclass
class ExecutorConfig:
    lean_cmd: str = "lean"
    timeout_sec: int = 5
    max_retries: int = 1
    retry_backoff_sec: float = 0.05
    working_dir: str | None = None
    isolated_env: dict[str, str] | None = None


class SessionLeanExecutor:
    """Stable session-style interface for theorem/tactic lifecycle."""

    def start_theorem(self, theorem_text: str) -> str | TacticResult:
        raise NotImplementedError

    def apply_tactic(self, session_id: str, tactic: str, depth: int = 0) -> TacticResult:
        raise NotImplementedError

    def close(self, session_id: str) -> None:
        raise NotImplementedError


class BatchLeanExecutor(SessionLeanExecutor):
    """Temp-file based execution model that recompiles from scratch."""

    def __init__(self, config: ExecutorConfig, parser: ProofStateParser):
        self.config = config
        self.parser = parser
        self._sessions: dict[str, tuple[str, list[str]]] = {}

    def start_theorem(self, theorem_text: str) -> str:
        session_id = str(uuid.uuid4())
        self._sessions[session_id] = (theorem_text, [])
        return session_id

    def apply_tactic(self, session_id: str, tactic: str, depth: int = 0) -> TacticResult:
        theorem, steps = self._get_session(session_id)
        steps.append(tactic)
        content = self._build_file(theorem, steps)

        start = time.time()
        exec_result = self._run_lean_with_retry(content)
        latency_ms = int((time.time() - start) * 1000)

        if exec_result["timed_out"]:
            steps.pop()
            return TacticResult(
                tactic=tactic,
                success=False,
                next_state=None,
                error="Lean timeout",
                proof_complete=False,
                latency_ms=latency_ms,
                state="timeout",
                error_category="timeout",
                stdout=exec_result["stdout"],
                stderr=exec_result["stderr"],
                raw_output=exec_result["raw_output"],
            )

        if exec_result["internal_error"]:
            steps.pop()
            return TacticResult(
                tactic=tactic,
                success=False,
                next_state=None,
                error=exec_result["internal_error"],
                proof_complete=False,
                latency_ms=latency_ms,
                state="compile_import_failure",
                error_category="internal_error",
                stdout=exec_result["stdout"],
                stderr=exec_result["stderr"],
                raw_output=exec_result["raw_output"],
            )

        raw_output = exec_result["raw_output"]
        state = self.parser.parse(raw_output, depth=depth)
        result_state = self._classify_result_state(exec_result["returncode"], state.errors)
        success = result_state == "parseable_proof_state"
        if not success:
            steps.pop()

        proof_complete = success and state.goal == ""
        error = None if success else (state.errors[-1] if state.errors else "Lean compilation/tactic error")
        error_category = None if success else self._categorize_error(raw_output)

        return TacticResult(
            tactic=tactic,
            success=success,
            next_state=state,
            error=error,
            proof_complete=proof_complete,
            latency_ms=latency_ms,
            state=result_state,
            error_category=error_category,
            stdout=exec_result["stdout"],
            stderr=exec_result["stderr"],
            raw_output=raw_output,
        )

    def close(self, session_id: str) -> None:
        self._sessions.pop(session_id, None)

    def _get_session(self, session_id: str) -> tuple[str, list[str]]:
        if session_id not in self._sessions:
            raise KeyError(f"Unknown Lean session_id: {session_id}")
        return self._sessions[session_id]

    def _run_lean_with_retry(self, content: str) -> dict[str, str | int | bool | None]:
        last_internal_error: str | None = None
        for attempt in range(self.config.max_retries + 1):
            outcome = self._run_lean_once(content)
            if outcome["timed_out"]:
                return outcome
            if not outcome["internal_error"]:
                return outcome
            last_internal_error = str(outcome["internal_error"])
            if attempt < self.config.max_retries:
                time.sleep(self.config.retry_backoff_sec)

        return {
            "stdout": "",
            "stderr": last_internal_error or "Unknown internal subprocess error",
            "raw_output": last_internal_error or "Unknown internal subprocess error",
            "returncode": 1,
            "timed_out": False,
            "internal_error": last_internal_error or "Unknown internal subprocess error",
        }

    def _run_lean_once(self, content: str) -> dict[str, str | int | bool | None]:
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
