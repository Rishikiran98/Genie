from __future__ import annotations


def reward_for_transition(success: bool, proof_complete: bool, *, is_negative: bool = False) -> float:
    if proof_complete:
        return 1.0
    if is_negative:
        return -0.5
    if success:
        return 0.1
    return -0.2


def collect_negative_tactics(transition: dict) -> list[str]:
    """Collect failed/negative tactics attached to a transition.

    Supported shapes:
    - transition["failed_tactics"] = ["rw [h]", ...]
    - transition["attempts"] = [{"tactic": "...", "success": False}, ...]
    """

    negatives: list[str] = []
    for tactic in transition.get("failed_tactics", []) or []:
        if isinstance(tactic, str) and tactic:
            negatives.append(tactic)

    for attempt in transition.get("attempts", []) or []:
        if not isinstance(attempt, dict):
            continue
        tactic = attempt.get("tactic")
        if isinstance(tactic, str) and tactic and attempt.get("success") is False:
            negatives.append(tactic)

    # Preserve order while deduplicating.
    seen: set[str] = set()
    out: list[str] = []
    for tactic in negatives:
        if tactic not in seen:
            out.append(tactic)
            seen.add(tactic)
    return out
