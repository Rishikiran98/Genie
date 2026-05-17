from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from evaluation.metrics import (
    average_depth,
    invalid_tactic_rate,
    mean_latency_per_theorem,
    median_depth,
    proof_success_rate,
    timeout_rate,
)


@dataclass(frozen=True)
class TheoremResult:
    theorem: str
    solved: bool
    depth: int
    invalid_tactics: int
    total_tactics: int
    timed_out: bool
    latency_s: float


DEFAULT_CURATED_THEOREMS_PATH = Path("datasets/benchmarks/curated_theorems.json")
BASELINE_METRICS_PATH = Path("datasets/benchmarks/baseline_run.json")
THRESHOLDS_PATH = Path("datasets/benchmarks/regression_thresholds.json")


def load_curated_results(path: Path = DEFAULT_CURATED_THEOREMS_PATH) -> list[TheoremResult]:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)

    return [TheoremResult(**entry) for entry in payload["theorems"]]


def run_benchmark_from_results(results: list[TheoremResult]) -> dict[str, Any]:
    solved = [r.solved for r in results]
    depths = [r.depth for r in results]
    invalid_tactics = [r.invalid_tactics for r in results]
    total_tactics = [r.total_tactics for r in results]
    timed_out = [r.timed_out for r in results]
    latencies = [r.latency_s for r in results]

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


def run_benchmark(curated_path: Path = DEFAULT_CURATED_THEOREMS_PATH) -> dict[str, Any]:
    return run_benchmark_from_results(load_curated_results(curated_path))


def write_baseline_artifact(
    curated_path: Path = DEFAULT_CURATED_THEOREMS_PATH,
    baseline_path: Path = BASELINE_METRICS_PATH,
) -> dict[str, Any]:
    results = load_curated_results(curated_path)
    metrics = run_benchmark_from_results(results)
    payload = {
        "benchmark": "curated_theorems_v1",
        "theorem_count": len(results),
        "metrics": metrics,
        "results": [asdict(r) for r in results],
    }
    baseline_path.parent.mkdir(parents=True, exist_ok=True)
    with baseline_path.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
        f.write("\n")
    return payload


def check_thresholds(
    metrics: dict[str, Any],
    thresholds_path: Path = THRESHOLDS_PATH,
) -> dict[str, bool]:
    with thresholds_path.open("r", encoding="utf-8") as f:
        thresholds = json.load(f)

    checks = {
        "solve_rate": metrics["solve_rate"] >= thresholds["min_solve_rate"],
        "avg_depth": metrics["avg_depth"] <= thresholds["max_avg_depth"],
        "median_depth": metrics["median_depth"] <= thresholds["max_median_depth"],
        "invalid_tactic_rate": metrics["invalid_tactic_rate"] <= thresholds["max_invalid_tactic_rate"],
        "timeout_rate": metrics["timeout_rate"] <= thresholds["max_timeout_rate"],
        "mean_latency_per_theorem_s": metrics["mean_latency_per_theorem_s"] <= thresholds[
            "max_mean_latency_per_theorem_s"
        ],
    }
    return checks


if __name__ == "__main__":
    baseline = write_baseline_artifact()
    checks = check_thresholds(baseline["metrics"])
    print(json.dumps({"metrics": baseline["metrics"], "checks": checks}, indent=2))
