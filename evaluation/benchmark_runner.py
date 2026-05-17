from __future__ import annotations

from evaluation.metrics import proof_success_rate


def run_benchmark(outcomes: list[bool]) -> dict:
    return {
        "proof_success_rate": proof_success_rate(outcomes),
        "solved": sum(1 for x in outcomes if x),
        "total": len(outcomes),
    }
