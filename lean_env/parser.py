from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ParsedProofState:
    primary_goal: str | None
    goals: list[str]
    hypotheses: list[str]
    local_context: list[str]
    errors: list[str]
    warnings: list[str]
    depth: int
    raw_output: str

    @property
    def goal(self) -> str:
        return self.primary_goal or ""


class ProofStateParser:
    """Parse Lean stdout/stderr into structured proof state."""

    GOAL_PATTERN = re.compile(r"⊢\s*(.+)")

    def parse(self, output: str, depth: int = 0) -> ParsedProofState:
        goals = [g.strip() for g in self.GOAL_PATTERN.findall(output) if g.strip()]
        primary_goal = goals[-1] if goals else None

        lines = output.splitlines()
        errors = [line.strip() for line in lines if "error:" in line.lower()]
        warnings = [line.strip() for line in lines if "warning:" in line.lower()]

        hypotheses: list[str] = []
        local_context: list[str] = []
        for line in lines:
            s = line.strip()
            if not s:
                continue
            if s.startswith("case "):
                local_context.append(s)
                hypotheses = []  # keep only local hypotheses for active case block
                continue
            if s.startswith("⊢"):
                continue
            low = s.lower()
            if "error:" in low or "warning:" in low or low.startswith("info:"):
                continue
            if ":" in s and not s.startswith("/"):
                hypotheses.append(s)

        return ParsedProofState(
            primary_goal=primary_goal,
            goals=goals,
            hypotheses=hypotheses,
            local_context=local_context,
            errors=errors,
            warnings=warnings,
            depth=depth,
            raw_output=output,
        )
