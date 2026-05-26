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
