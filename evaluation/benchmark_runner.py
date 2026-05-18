from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

if __package__ in {None, ""}:
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from evaluation.metrics import compute_metrics


@dataclass(frozen=True)
class TheoremResult:
    theorem: str
    solved: bool
    depth: int
    invalid_tactics: int
    total_tactics: int
    timed_out: bool
    latency_s: float


DEFAULT_CONFIG_PATH = Path("configs/benchmark.yaml")
LATEST_REPORT_NAME = "latest_benchmark.json"


def load_simple_yaml(path: Path) -> dict[str, Any]:
    data: dict[str, Any] = {}
    with path.open("r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            key, value = [x.strip() for x in line.split(":", 1)]
            if value.lower() in {"true", "false"}:
                data[key] = value.lower() == "true"
            else:
                try:
                    data[key] = int(value) if value.isdigit() else float(value)
                except ValueError:
                    data[key] = value.strip().strip('"').strip("'")
    return data


def load_curated_results(path: Path) -> list[TheoremResult]:
    with path.open("r", encoding="utf-8") as f:
        payload = json.load(f)
    return [TheoremResult(**entry) for entry in payload["theorems"]]


def run_benchmark_from_results(results: list[TheoremResult]) -> dict[str, Any]:
    return compute_metrics([asdict(r) for r in results])


def check_thresholds(metrics: dict[str, Any], thresholds_path: Path) -> dict[str, bool]:
    with thresholds_path.open("r", encoding="utf-8") as f:
        thresholds = json.load(f)

    return {
        "solve_rate": metrics["solve_rate"] >= thresholds["min_solve_rate"],
        "avg_depth": metrics["avg_depth"] <= thresholds["max_avg_depth"],
        "median_depth": metrics["median_depth"] <= thresholds["max_median_depth"],
        "invalid_tactic_rate": metrics["invalid_tactic_rate"] <= thresholds["max_invalid_tactic_rate"],
        "timeout_rate": metrics["timeout_rate"] <= thresholds["max_timeout_rate"],
        "mean_latency_per_theorem_s": metrics["mean_latency_per_theorem_s"] <= thresholds[
            "max_mean_latency_per_theorem_s"
        ],
    }


def compare_to_baseline(metrics: dict[str, Any], baseline_path: Path) -> dict[str, float]:
    with baseline_path.open("r", encoding="utf-8") as f:
        baseline = json.load(f)["metrics"]

    return {
        "solve_rate_delta": metrics["solve_rate"] - baseline["solve_rate"],
        "avg_depth_delta": metrics["avg_depth"] - baseline["avg_depth"],
        "median_depth_delta": metrics["median_depth"] - baseline["median_depth"],
        "invalid_tactic_rate_delta": metrics["invalid_tactic_rate"] - baseline["invalid_tactic_rate"],
        "timeout_rate_delta": metrics["timeout_rate"] - baseline["timeout_rate"],
        "mean_latency_per_theorem_s_delta": metrics["mean_latency_per_theorem_s"]
        - baseline["mean_latency_per_theorem_s"],
    }


def build_human_summary(report: dict[str, Any]) -> str:
    m = report["metrics"]
    c = report["threshold_checks"]
    status = "PASS" if all(c.values()) else "FAIL"
    return "\n".join(
        [
            f"Benchmark: {report['benchmark']}",
            f"Status: {status}",
            f"Solved: {m['solved']}/{m['total']} ({m['solve_rate']:.1%})",
            f"Depth (avg/median): {m['avg_depth']:.2f}/{m['median_depth']:.2f}",
            f"Invalid tactic rate: {m['invalid_tactic_rate']:.2%}",
            f"Timeout rate: {m['timeout_rate']:.2%}",
            f"Mean latency/theorem: {m['mean_latency_per_theorem_s']:.3f}s",
        ]
    )


def _write_json_report(report: dict[str, Any], output_path: Path) -> None:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
        f.write("\n")


def run_benchmark(
    config_path: Path = DEFAULT_CONFIG_PATH,
    *,
    suite_path: Path | None = None,
    output_path: Path | None = None,
) -> dict[str, Any]:
    config = load_simple_yaml(config_path)
    suite_path = suite_path or Path(config["suite_path"])
    baseline_path = Path(config["baseline_path"])
    thresholds_path = Path(config["thresholds_path"])

    results = load_curated_results(suite_path)
    metrics = run_benchmark_from_results(results)
    threshold_checks = check_thresholds(metrics, thresholds_path)
    baseline_delta = compare_to_baseline(metrics, baseline_path)

    report = {
        "benchmark": config.get("benchmark_name", "curated_theorems"),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "theorem_count": len(results),
        "metrics": metrics,
        "threshold_checks": threshold_checks,
        "all_thresholds_passed": all(threshold_checks.values()),
        "baseline_delta": baseline_delta,
        "results": [asdict(r) for r in results],
    }
    report["summary"] = build_human_summary(report)

    report_output_path = output_path or Path(config["report_output_path"])
    _write_json_report(report, report_output_path)

    latest_report_path = report_output_path.with_name(LATEST_REPORT_NAME)
    if latest_report_path != report_output_path:
        _write_json_report(report, latest_report_path)

    return report


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the curated theorem benchmark suite.")
    parser.add_argument(
        "--config",
        type=Path,
        default=DEFAULT_CONFIG_PATH,
        help="Path to the benchmark YAML config file.",
    )
    parser.add_argument(
        "--dataset",
        type=Path,
        default=None,
        help="Optional benchmark dataset path overriding the config suite_path.",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Optional JSON report path overriding the config report_output_path.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    benchmark_report = run_benchmark(args.config, suite_path=args.dataset, output_path=args.output)
    print(benchmark_report["summary"])


if __name__ == "__main__":
    main()
