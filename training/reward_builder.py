from __future__ import annotations


def reward_for_transition(success: bool, proof_complete: bool) -> float:
    if proof_complete:
        return 1.0
    if success:
        return 0.1
    return -0.2
