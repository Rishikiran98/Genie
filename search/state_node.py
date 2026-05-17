from __future__ import annotations

from dataclasses import dataclass


@dataclass
class StateNode:
    goal: str
    hypotheses: list[str]
    history: list[str]
    depth: int
    score: float = 0.0
    done: bool = False

    @staticmethod
    def _normalize_text(text: str) -> str:
        return " ".join(text.split()).strip().lower()

    def normalized_state_hash(self) -> str:
        normalized_goal = self._normalize_text(self.goal)
        normalized_ctx = sorted(self._normalize_text(h) for h in self.hypotheses)
        return f"{normalized_goal}||{'|'.join(normalized_ctx)}"
