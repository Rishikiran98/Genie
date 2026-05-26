from __future__ import annotations


def score_transition(success: bool, proof_complete: bool, depth: int, num_goals: int) -> float:
    if proof_complete:
        return 100.0 - 0.5 * depth
    if not success:
        return -10.0 - depth
    return -0.5 * depth - float(num_goals)
