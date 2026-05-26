from __future__ import annotations

import hashlib
import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from time import perf_counter
from typing import Any


@dataclass
class RunEvent:
    timestamp: str
    theorem_id: str
    event_type: str
    payload: dict[str, Any]


class JsonlRunLogger:
    def __init__(self, theorem: str, run_dir: str = "datasets/runs") -> None:
        os.makedirs(run_dir, exist_ok=True)
        self.theorem_id = self._hash_text(theorem)
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S.%fZ")
        self.path = os.path.join(run_dir, f"run_{ts}_{self.theorem_id[:8]}.jsonl")
        self._start = perf_counter()

    @staticmethod
    def _hash_text(text: str) -> str:
        return hashlib.sha256(text.encode("utf-8")).hexdigest()

    def state_snapshot_hash(self, goal: str, hypotheses: list[str], history: list[str]) -> str:
        snapshot = {
            "goal": goal,
            "hypotheses": sorted(hypotheses),
            "history": history,
        }
        canonical = json.dumps(snapshot, sort_keys=True, separators=(",", ":"))
        return self._hash_text(canonical)

    def log(self, event_type: str, payload: dict[str, Any]) -> None:
        event = RunEvent(
            timestamp=datetime.now(timezone.utc).isoformat(),
            theorem_id=self.theorem_id,
            event_type=event_type,
            payload=payload,
        )
        with open(self.path, "a", encoding="utf-8") as f:
            f.write(json.dumps(asdict(event), separators=(",", ":")) + "\n")

    def log_final(self, outcome: str, extra: dict[str, Any] | None = None) -> None:
        payload = {
            "final_outcome": outcome,
            "latency_seconds": perf_counter() - self._start,
        }
        if extra:
            payload.update(extra)
        self.log("final", payload)
