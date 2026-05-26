from __future__ import annotations

import json
from pathlib import Path

from evaluation.metrics import proof_success_rate

LATEST_REPORT_NAME = "latest_benchmark_report.json"


def _read_simple_yaml(path: Path) -> dict[str, str]:
    data: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or ":" not in line:
            continue
        key, value = line.split(":", 1)
        data[key.strip()] = value.strip()
    return data


def _compute_metrics(theorems: list[dict]) -> dict[str, float]:
    solved_flags = [bool(t.get("solved", False)) for t in theorems]
    depths = [float(t.get("depth", 0.0)) for t in theorems]
    invalid = [float(t.get("invalid_tactics", 0.0)) for t in theorems]
    total = [float(t.get("total_tactics", 0.0)) for t in theorems]
    timed_out = [bool(t.get("timed_out", False)) for t in theorems]
    latencies = [float(t.get("latency_s", 0.0)) for t in theorems]

    n = len(theorems)
    if n == 0:
        return {
            "solve_rate": 0.0,
            "avg_depth": 0.0,
            "median_depth": 0.0,
            "invalid_tactic_rate": 0.0,
            "timeout_rate": 0.0,
            "mean_latency_per_theorem_s": 0.0,
        }

    sorted_depths = sorted(depths)
    mid = n // 2
    median_depth = sorted_depths[mid] if n % 2 == 1 else (sorted_depths[mid - 1] + sorted_depths[mid]) / 2.0
    invalid_tactic_rate = sum(invalid) / sum(total) if sum(total) > 0 else 0.0

    return {
        "solve_rate": proof_success_rate(solved_flags),
        "avg_depth": sum(depths) / n,
        "median_depth": median_depth,
        "invalid_tactic_rate": invalid_tactic_rate,
        "timeout_rate": sum(1 for t in timed_out if t) / n,
        "mean_latency_per_theorem_s": sum(latencies) / n,
    }


def _thresholds_pass(metrics: dict[str, float], thresholds: dict[str, float]) -> bool:
    return (
        metrics["solve_rate"] >= float(thresholds.get("min_solve_rate", 0.0))
        and metrics["avg_depth"] <= float(thresholds.get("max_avg_depth", float("inf")))
        and metrics["median_depth"] <= float(thresholds.get("max_median_depth", float("inf")))
        and metrics["invalid_tactic_rate"] <= float(thresholds.get("max_invalid_tactic_rate", float("inf")))
        and metrics["timeout_rate"] <= float(thresholds.get("max_timeout_rate", float("inf")))
        and metrics["mean_latency_per_theorem_s"] <= float(thresholds.get("max_mean_latency_per_theorem_s", float("inf")))
    )


def run_benchmark(config_or_outcomes) -> dict:
    if isinstance(config_or_outcomes, list):
        outcomes = config_or_outcomes
        return {
            "report_name": LATEST_REPORT_NAME,
            "proof_success_rate": proof_success_rate(outcomes),
            "solved": sum(1 for x in outcomes if x),
            "total": len(outcomes),
        }

    config_path = Path(config_or_outcomes)
    cfg = _read_simple_yaml(config_path)

    suite = json.loads(Path(cfg["suite_path"]).read_text(encoding="utf-8"))
    theorems = suite.get("theorems", [])
    metrics = _compute_metrics(theorems)

    thresholds = {}
    thresholds_path = cfg.get("thresholds_path")
    if thresholds_path:
        thresholds = json.loads(Path(thresholds_path).read_text(encoding="utf-8"))

    report = {
        "benchmark": cfg.get("benchmark_name", "benchmark"),
        "metrics": metrics,
        "all_thresholds_passed": _thresholds_pass(metrics, thresholds) if thresholds else True,
    }

    out_path = Path(cfg["report_output_path"])
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    latest_path = out_path.parent / LATEST_REPORT_NAME
    latest_path.write_text(json.dumps(report, indent=2), encoding="utf-8")

    return report
