from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Protocol

from policy_model.prompt_builder import build_tactic_prompt


class LLMClient(Protocol):
    def complete(self, prompt: str) -> str: ...


@dataclass
class HeuristicFallbackClient:
    def complete(self, prompt: str) -> str:
        _ = prompt
        return json.dumps({"tactics": ["simp", "rfl", "aesop", "induction n <;> simp"]})


class TacticGenerator:
    def __init__(self, client: LLMClient | None = None):
        self.client = client or HeuristicFallbackClient()

    def generate(self, state: dict, retrieved_traces: list[dict] | None = None, k: int = 5) -> list[str]:
        prompt = build_tactic_prompt(state, retrieved_traces)
        raw = self.client.complete(prompt)
        try:
            parsed = json.loads(raw)
            tactics = parsed.get("tactics", [])
            tactics = [t.strip() for t in tactics if isinstance(t, str) and t.strip()]
        except json.JSONDecodeError:
            tactics = ["simp", "rfl"]

        uniq: list[str] = []
        seen = set()
        for t in tactics:
            if t not in seen:
                seen.add(t)
                uniq.append(t)
        return uniq[:k]
