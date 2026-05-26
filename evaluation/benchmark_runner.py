from __future__ import annotations

from evaluation.metrics import proof_success_rate

LATEST_REPORT_NAME = "latest_benchmark_report.json"


def run_benchmark(outcomes: list[bool]) -> dict:
    return {
        "report_name": LATEST_REPORT_NAME,
        "proof_success_rate": proof_success_rate(outcomes),
        "solved": sum(1 for x in outcomes if x),
        "total": len(outcomes),
    }
