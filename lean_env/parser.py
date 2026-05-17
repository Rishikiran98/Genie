from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass
class ParsedProofState:
    goal: str
    active_goals: list[str]
    primary_goal: str
    hypotheses: list[str]
    local_context: list[str]
    goal_contexts: list[dict[str, list[str] | str]]
    errors: list[str]
    warnings: list[str]
    depth: int
    raw_output: str


class ProofStateParser:
    """Parse Lean stdout/stderr into structured proof state."""

    GOAL_PATTERN = re.compile(r"⊢\s*(.+)")
    HYPOTHESIS_PATTERN = re.compile(
        r"^(?:[A-Za-z_][\w'₀-₉]*\s*)+\s*:\s*.+$"
    )

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

            if self.HYPOTHESIS_PATTERN.match(s):
                current_hypotheses.append(s)

        active_goals = [item["goal"] for item in goal_contexts]
        primary_goal = active_goals[-1] if active_goals else ""

        errors = [line.strip() for line in lines if "error:" in line.lower()]
        warnings = [line.strip() for line in lines if "warning:" in line.lower()]

        return ParsedProofState(
            goal=primary_goal,
            active_goals=active_goals,
            primary_goal=primary_goal,
            hypotheses=goal_contexts[-1]["hypotheses"] if goal_contexts else [],
            local_context=goal_contexts[-1]["local_context"] if goal_contexts else [],
            goal_contexts=goal_contexts,
            errors=errors,
            warnings=warnings,
            depth=depth,
            raw_output=output,
        )
