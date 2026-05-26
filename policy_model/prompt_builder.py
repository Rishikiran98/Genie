from __future__ import annotations

from typing import Any


def build_tactic_prompt(state: dict[str, Any], retrieved_traces: list[dict[str, Any]] | None = None) -> str:
    retrieved_traces = retrieved_traces or []
    examples = "\n".join(f"- {t.get('tactic', '')} => {t.get('goal', '')}" for t in retrieved_traces[:5])
    return (
        "You are a Lean tactic generator. Return JSON with key 'tactics' as list of candidate tactics.\n"
        f"Current goal: {state.get('goal', '')}\n"
        f"Hypotheses: {state.get('hypotheses', [])}\n"
        f"Previous steps: {state.get('previous_steps', [])}\n"
        f"Retrieved examples:\n{examples}\n"
        "Prefer valid, short Lean tactics."
    )
