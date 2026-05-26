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


def compute_metrics(results: list[dict]) -> dict[str, float | int]:
    solved = [bool(r["solved"]) for r in results]
    depths = [int(r["depth"]) for r in results]
    invalid_tactics = [int(r["invalid_tactics"]) for r in results]
    total_tactics = [int(r["total_tactics"]) for r in results]
    timed_out = [bool(r["timed_out"]) for r in results]
    latencies = [float(r["latency_s"]) for r in results]

    return {
        "solve_rate": proof_success_rate(solved),
        "avg_depth": average_depth(depths),
        "median_depth": median_depth(depths),
        "invalid_tactic_rate": invalid_tactic_rate(invalid_tactics, total_tactics),
        "timeout_rate": timeout_rate(timed_out),
        "mean_latency_per_theorem_s": mean_latency_per_theorem(latencies),
        "solved": sum(1 for x in solved if x),
        "total": len(results),
    }
