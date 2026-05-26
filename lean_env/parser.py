from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ParsedProofState:
    goal: str
    hypotheses: list[str]
    local_context: list[str]
    errors: list[str]
    depth: int
    raw_output: str


class ProofStateParser:
    """Parse Lean stdout/stderr into structured proof state."""

    GOAL_PATTERN = re.compile(r"⊢\s*(.+)")

    def parse(self, output: str, depth: int = 0) -> ParsedProofState:
        goals = self.GOAL_PATTERN.findall(output)
        goal = goals[-1].strip() if goals else ""

        errors = [line.strip() for line in output.splitlines() if "error:" in line.lower()]

        hypotheses: list[str] = []
        local_context: list[str] = []
        for line in output.splitlines():
            s = line.strip()
            if s.startswith("case "):
                local_context.append(s)
            elif ":" in s and not s.startswith("⊢") and "error:" not in s.lower():
                hypotheses.append(s)

        return ParsedProofState(
            goal=goal,
            hypotheses=hypotheses,
            local_context=local_context,
            errors=errors,
            depth=depth,
            raw_output=output,
        )
