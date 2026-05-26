from __future__ import annotations


def proof_success_rate(results: list[bool]) -> float:
    return (sum(1 for r in results if r) / len(results)) if results else 0.0
