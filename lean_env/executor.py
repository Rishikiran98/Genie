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

            cmd = [self.config.lean_cmd, str(lean_file)]
            run_env = self.config.isolated_env if self.config.isolated_env is not None else os.environ.copy()
            cwd = self.config.working_dir or os.getcwd()

            try:
                proc = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=self.config.timeout_sec,
                    cwd=cwd,
                    env=run_env,
                    check=False,
                )
            except subprocess.TimeoutExpired as err:
                stdout = (err.stdout or "") if isinstance(err.stdout, str) else ""
                stderr = (err.stderr or "") if isinstance(err.stderr, str) else ""
                raw_output = self._join_output(stdout, stderr)
                return {
                    "stdout": stdout,
                    "stderr": stderr,
                    "raw_output": raw_output,
                    "returncode": 124,
                    "timed_out": True,
                    "internal_error": None,
                }
            except OSError as err:
                msg = f"Failed to execute Lean command: {err}"
                return {
                    "stdout": "",
                    "stderr": msg,
                    "raw_output": msg,
                    "returncode": 1,
                    "timed_out": False,
                    "internal_error": msg,
                }

            stdout = proc.stdout or ""
            stderr = proc.stderr or ""
            raw_output = self._join_output(stdout, stderr)
            return {
                "stdout": stdout,
                "stderr": stderr,
                "raw_output": raw_output,
                "returncode": proc.returncode,
                "timed_out": False,
                "internal_error": None,
            }

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
        if any(BatchLeanExecutor._looks_like_tactic_failure(e) for e in errors):
            return "tactic_failure"
        return "compile_import_failure"

    @staticmethod
    def _looks_like_tactic_failure(error_line: str) -> bool:
        msg = error_line.lower()
        tactic_patterns = (
            r"\\btactic\\b",
            r"no goals to be solved",
            r"unsolved goals",
            r"failed to synthesize",
            r"did not close goal",
        )
        return any(re.search(pattern, msg) for pattern in tactic_patterns)

    @staticmethod
    def _categorize_error(output: str) -> ErrorCategory:
        msg = output.lower()
        if "timeout" in msg:
            return "timeout"
        if "parse" in msg and "error" in msg:
            return "parse_error"
        if "tactic" in msg or "unsolved goals" in msg or "no goals" in msg:
            return "tactic_error"
        if "error:" in msg:
            return "compile_error"
        return "internal_error"


class LeanExecutor:
    def __init__(
        self,
        lean_cmd: str = "lean",
        timeout_sec: int = 5,
        mode: ExecutorMode = "batch",
        *,
        max_retries: int = 1,
        retry_backoff_sec: float = 0.05,
        working_dir: str | None = None,
        isolated_env: dict[str, str] | None = None,
    ):
        self.parser = ProofStateParser()
        self.mode = mode
        self.config = ExecutorConfig(
            lean_cmd=lean_cmd,
            timeout_sec=timeout_sec,
            max_retries=max_retries,
            retry_backoff_sec=retry_backoff_sec,
            working_dir=working_dir,
            isolated_env=isolated_env,
        )
        self._session_backend = self._create_session_backend(mode)
        self._default_session_id: str | None = None

    def _create_session_backend(self, mode: ExecutorMode) -> SessionLeanExecutor:
        # Session mode can wrap batch mode until a persistent Lean protocol is implemented.
        if mode in {"batch", "session"}:
            return BatchLeanExecutor(self.config, self.parser)
        raise ValueError(f"Unsupported executor mode: {mode}")

    def start_theorem(self, theorem_text: str) -> str | TacticResult:
        session_id = self._session_backend.start_theorem(theorem_text)
        if isinstance(session_id, str):
            self._default_session_id = session_id
        return session_id

    def apply_tactic(self, session_id: str, tactic: str, depth: int = 0) -> TacticResult:
        return self._session_backend.apply_tactic(session_id, tactic, depth=depth)

    def close(self, session_id: str) -> None:
        self._session_backend.close(session_id)
        if self._default_session_id == session_id:
            self._default_session_id = None

    # Backward-compatible aliases
    def begin_theorem(self, theorem: str) -> None:
        result = self.start_theorem(theorem)
        if isinstance(result, TacticResult):
            raise RuntimeError(result.error or "Failed to start theorem session")

    def run_tactic(self, theorem: str, previous_steps: list[str], tactic: str, depth: int) -> TacticResult:
        session_id = self.start_theorem(theorem)
        if isinstance(session_id, TacticResult):
            return session_id
        last_result: TacticResult | None = None
        for step in previous_steps:
            last_result = self.apply_tactic(session_id, step, depth=depth)
            if not last_result.success:
                self.close(session_id)
                return last_result
        result = self.apply_tactic(session_id, tactic, depth=depth)
        self.close(session_id)
        return result

    def step_tactic(self, tactic: str, depth: int) -> TacticResult:
        if self._default_session_id is None:
            raise RuntimeError("No active theorem session. Call start_theorem/begin_theorem first.")
        return self.apply_tactic(self._default_session_id, tactic, depth=depth)
