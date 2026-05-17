from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class TransitionRecord:
    state_text: str
    tactic: str
    success: bool
    next_state_text: str


@dataclass
class InMemoryVectorStore:
    records: list[TransitionRecord] = field(default_factory=list)

    def add_transition(self, rec: TransitionRecord) -> None:
        self.records.append(rec)

    def query_similar(self, goal: str, top_k: int = 5) -> list[dict]:
        # simple lexical overlap for MVP
        scored = []
        goal_terms = set(goal.split())
        for r in self.records:
            overlap = len(goal_terms.intersection(set(r.state_text.split())))
            scored.append((overlap, r))
        scored.sort(key=lambda x: x[0], reverse=True)
        return [{"goal": r.state_text, "tactic": r.tactic, "success": r.success} for _, r in scored[:top_k]]
