from __future__ import annotations

import importlib.util
from pathlib import Path
import types
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools/local-ai-baseline/report.py"
SPEC = importlib.util.spec_from_file_location("ordax_local_ai_baseline", MODULE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError("cannot load local AI baseline reporter")
BASELINE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BASELINE)


class LocalAiBaselineTests(unittest.TestCase):
    def modules(self, *, compatible=True, benchmark_error=None):
        hardware = types.SimpleNamespace(
            probe_system=lambda: {
                "$schema": "prototype-ordax.local-ai-hardware-probe/1",
                "runtime_compatible": compatible,
                "start_blockers": [] if compatible else ["runtime-artifact-architecture-mismatch"],
                "architecture": "x86_64" if compatible else "aarch64",
            }
        )

        def benchmark(*args, **kwargs):
            if benchmark_error is not None:
                raise benchmark_error
            return {
                "$schema": "prototype-ordax.local-ai-benchmark/1",
                "engineId": "llama.cpp",
                "modelId": "qwen-test",
                "api_path": "/v1/chat/completions",
                "summary": {
                    "median_latency_ms": 250.0,
                    "median_wall_tokens_per_second": 12.5,
                },
                "release_gate": False,
                "tuning_applied": False,
            }

        benchmark_module = types.SimpleNamespace(
            benchmark=benchmark,
            DEFAULT_BASE_URL="http://127.0.0.1:8765/__ordax/native/local-ai",
        )
        return hardware, benchmark_module

    def test_composes_probe_and_benchmark_without_claiming_release_or_tuning(self):
        hardware, benchmark = self.modules()
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            result = BASELINE.build_baseline(
                base_url="http://127.0.0.1:17865",
                runs=4,
                n_predict=64,
                timeout=30.0,
                expected_model="qwen-test",
            )

        self.assertEqual(result["$schema"], "prototype-ordax.local-ai-baseline/1")
        self.assertTrue(result["hardware"]["runtime_compatible"])
        self.assertEqual(result["benchmark"]["modelId"], "qwen-test")
        self.assertEqual(result["benchmark"]["api_path"], "/v1/chat/completions")
        self.assertFalse(result["comparison_policy"]["release_gate"])
        self.assertFalse(result["comparison_policy"]["runtime_bytes_modified"])
        self.assertTrue(result["comparison_policy"]["single_variable_tuning_required"])

    def test_unset_baseline_endpoint_uses_benchmark_owner_not_duplicate_raw_port(self):
        hardware, benchmark = self.modules()
        captured = []

        def record(base_url, **kwargs):
            captured.append(base_url)
            return self.modules()[1].benchmark(base_url, **kwargs)

        benchmark.benchmark = record
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            BASELINE.build_baseline()
        self.assertEqual(captured, [benchmark.DEFAULT_BASE_URL])
        self.assertTrue(captured[0].endswith("/__ordax/native/local-ai"))

    def test_incompatible_hardware_fails_before_benchmark(self):
        hardware, benchmark = self.modules(compatible=False)
        benchmark_calls = []
        benchmark.benchmark = lambda *args, **kwargs: benchmark_calls.append((args, kwargs))
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            with self.assertRaisesRegex(
                BASELINE.BaselineError,
                "runtime-artifact-architecture-mismatch",
            ):
                BASELINE.build_baseline()
        self.assertEqual(benchmark_calls, [])

    def test_benchmark_failure_invalidates_the_baseline(self):
        hardware, benchmark = self.modules(benchmark_error=RuntimeError("backend unavailable"))
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            with self.assertRaisesRegex(BASELINE.BaselineError, "benchmark failed: backend unavailable"):
                BASELINE.build_baseline()

    def test_rejects_incompatible_hardware_schema(self):
        hardware, benchmark = self.modules()
        hardware.probe_system = lambda: {
            "$schema": "prototype-ordax.local-ai-hardware-probe/999",
            "runtime_compatible": True,
            "start_blockers": [],
        }
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            with self.assertRaisesRegex(BASELINE.BaselineError, "incompatible result"):
                BASELINE.build_baseline()

    def test_rejects_non_product_benchmark_api_path(self):
        hardware, benchmark = self.modules()
        result = benchmark.benchmark()
        result["api_path"] = "/completion"
        benchmark.benchmark = lambda *args, **kwargs: result
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            with self.assertRaisesRegex(BASELINE.BaselineError, "product inference API path"):
                BASELINE.build_baseline()

    def test_rejects_promotional_or_tuned_benchmark_result(self):
        hardware, benchmark = self.modules()
        benchmark.benchmark = lambda *args, **kwargs: {
            "$schema": "prototype-ordax.local-ai-benchmark/1",
            "engineId": "llama.cpp",
            "modelId": "qwen-test",
            "api_path": "/v1/chat/completions",
            "summary": {
                "median_latency_ms": 250.0,
                "median_wall_tokens_per_second": 12.5,
            },
            "release_gate": True,
            "tuning_applied": True,
        }
        with patch.object(BASELINE, "load_module", side_effect=[hardware, benchmark]):
            with self.assertRaisesRegex(BASELINE.BaselineError, "non-promotional and untuned"):
                BASELINE.build_baseline()


if __name__ == "__main__":
    unittest.main()
