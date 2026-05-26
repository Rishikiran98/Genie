from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ParsedProofState:
    primary_goal: str | None
    goals: list[str]
    hypotheses: list[str]
    local_context: list[str]
    warnings: list[str]
    errors: list[str]
    depth: int
    raw_output: str

    @property
    def goal(self) -> str:
        return self.primary_goal or ""

    @property
    def active_goals(self) -> list[str]:
        return self.goals


class ProofStateParser:
    """Parse Lean stdout/stderr into structured proof state."""

    GOAL_PATTERN = re.compile(r"⊢\s*(.+)")

    def parse(self, output: str, depth: int = 0) -> ParsedProofState:
        lines = output.splitlines()

        goal_contexts: list[dict[str, list[str] | str]] = []
        current_hypotheses: list[str] = []
        current_local_context: list[str] = []

        for line in lines:
            s = line.strip()
            if not s:
                continue

            lowered = s.lower()
            if "error:" in lowered or "warning:" in lowered:
                continue

            if s.startswith("case "):
                current_local_context.append(s)
                continue

            goal_match = self.GOAL_PATTERN.match(s)
            if goal_match:
                goal_contexts.append(
                    {
                        "goal": goal_match.group(1).strip(),
                        "hypotheses": current_hypotheses.copy(),
                        "local_context": current_local_context.copy(),
                    }
                )
                current_hypotheses.clear()
                current_local_context.clear()
                continue

            if ":" in s and not s.startswith("⊢") and not s.startswith("case "):
                current_hypotheses.append(s)

        goals = [item["goal"] for item in goal_contexts]
        primary_goal = goals[-1] if goals else None

        errors = [line.strip() for line in lines if "error:" in line.lower()]
        warnings = [line.strip() for line in lines if "warning:" in line.lower()]

        return ParsedProofState(
            primary_goal=primary_goal,
            goals=goals,
            hypotheses=goal_contexts[-1]["hypotheses"] if goal_contexts else [],
            local_context=goal_contexts[-1]["local_context"] if goal_contexts else [],
            errors=errors,
            warnings=warnings,
            depth=depth,
            raw_output=output,
        )
