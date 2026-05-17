from __future__ import annotations

from statistics import mean, median


def proof_success_rate(results: list[bool]) -> float:
    return (sum(1 for r in results if r) / len(results)) if results else 0.0


def invalid_tactic_rate(invalid_tactics: list[int], total_tactics: list[int]) -> float:
    invalid = sum(invalid_tactics)
    tactics = sum(total_tactics)
    return (invalid / tactics) if tactics else 0.0


def timeout_rate(timed_out: list[bool]) -> float:
    return (sum(1 for t in timed_out if t) / len(timed_out)) if timed_out else 0.0


def average_depth(depths: list[int]) -> float:
    return mean(depths) if depths else 0.0


def median_depth(depths: list[int]) -> float:
    return median(depths) if depths else 0.0


def mean_latency_per_theorem(latencies_s: list[float]) -> float:
    return mean(latencies_s) if latencies_s else 0.0
