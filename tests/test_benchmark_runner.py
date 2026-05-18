import json
from pathlib import Path
import tempfile
import unittest

from evaluation.benchmark_runner import LATEST_REPORT_NAME, run_benchmark


class TestBenchmarkRunnerReports(unittest.TestCase):
    def test_writes_configured_report_and_latest_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            suite = root / "suite.json"
            baseline = root / "baseline.json"
            thresholds = root / "thresholds.json"
            output = root / "runs" / "benchmark_report.json"
            config = root / "benchmark.yaml"

            theorem = {
                "theorem": "theorem t : True := by trivial",
                "solved": True,
                "depth": 1,
                "invalid_tactics": 0,
                "total_tactics": 1,
                "timed_out": False,
                "latency_s": 0.01,
            }
            suite.write_text(json.dumps({"theorems": [theorem]}), encoding="utf-8")
            baseline.write_text(
                json.dumps(
                    {
                        "metrics": {
                            "solve_rate": 1.0,
                            "avg_depth": 1.0,
                            "median_depth": 1.0,
                            "invalid_tactic_rate": 0.0,
                            "timeout_rate": 0.0,
                            "mean_latency_per_theorem_s": 0.01,
                        }
                    }
                ),
                encoding="utf-8",
            )
            thresholds.write_text(
                json.dumps(
                    {
                        "min_solve_rate": 1.0,
                        "max_avg_depth": 1.0,
                        "max_median_depth": 1.0,
                        "max_invalid_tactic_rate": 0.0,
                        "max_timeout_rate": 0.0,
                        "max_mean_latency_per_theorem_s": 0.01,
                    }
                ),
                encoding="utf-8",
            )
            config.write_text(
                "\n".join(
                    [
                        "benchmark_name: test_suite",
                        f"suite_path: {suite}",
                        f"baseline_path: {baseline}",
                        f"thresholds_path: {thresholds}",
                        f"report_output_path: {output}",
                    ]
                ),
                encoding="utf-8",
            )

            report = run_benchmark(config)

            latest = output.with_name(LATEST_REPORT_NAME)
            self.assertTrue(output.exists())
            self.assertTrue(latest.exists())
            self.assertEqual(json.loads(output.read_text()), json.loads(latest.read_text()))
            self.assertEqual(report["benchmark"], "test_suite")
            self.assertTrue(report["all_thresholds_passed"])


if __name__ == "__main__":
    unittest.main()
