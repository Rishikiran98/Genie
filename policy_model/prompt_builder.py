from __future__ import annotations

from typing import Any


TACTIC_RESPONSE_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": ["tactics"],
    "properties": {
        "tactics": {
            "type": "array",
            "minItems": 1,
            "maxItems": 32,
            "items": {"type": "string", "minLength": 1, "maxLength": 256},
        }
    },
}


def build_tactic_prompt(state: dict[str, Any], retrieved_traces: list[dict[str, Any]] | None = None) -> str:
    retrieved_traces = retrieved_traces or []
    examples = "\n".join(f"- {t.get('tactic', '')} => {t.get('goal', '')}" for t in retrieved_traces[:5])
    return (
        "You are a Lean tactic generator.\n"
        "Return ONLY JSON matching this strict schema (no markdown, no prose):\n"
        f"{TACTIC_RESPONSE_SCHEMA}\n"
        "Rules:\n"
        "- Keep tactics concise and executable in Lean.\n"
        "- Prefer high-probability next steps for the current goal.\n"
        "- Do not include explanations.\n"
        f"Current goal: {state.get('goal', '')}\n"
        f"Hypotheses: {state.get('hypotheses', [])}\n"
        f"Previous steps: {state.get('previous_steps', [])}\n"
        f"Retrieved examples:\n{examples}\n"
    )
