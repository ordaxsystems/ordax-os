#!/usr/bin/env python3
"""Compose an OrdaX Local AI hardware probe and benchmark into one baseline report.

This tool does not start the backend, tune it, or alter release/runtime bytes. It
runs the existing bounded engineering probe + benchmark and emits a single JSON
record suitable for before/after tuning comparisons on the same target machine.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
HARDWARE_PROBE = ROOT / "tools/local-ai-hardware-probe/probe.py"
BENCHMARK = ROOT / "tools/local-ai-benchmark/benchmark.py"
SCHEMA = "prototype-ordax.local-ai-baseline/1"
HARDWARE_SCHEMA = "prototype-ordax.local-ai-hardware-probe/1"
BENCHMARK_SCHEMA = "prototype-ordax.local-ai-benchmark/1"
PRODUCT_INFERENCE_API_PATH = "/v1/chat/completions"


class BaselineError(RuntimeError):
    pass


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise BaselineError(f"cannot load baseline component: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def validate_hardware_result(value):
    if not isinstance(value, dict) or value.get("$schema") != HARDWARE_SCHEMA:
        raise BaselineError("hardware probe returned an incompatible result")
    if not isinstance(value.get("runtime_compatible"), bool):
        raise BaselineError("hardware probe omitted runtime compatibility")
    blockers = value.get("start_blockers")
    if not isinstance(blockers, list) or any(not isinstance(item, str) or not item for item in blockers):
        raise BaselineError("hardware probe returned invalid start blockers")
    if value["runtime_compatible"] and blockers:
        raise BaselineError("hardware probe returned contradictory compatibility state")
    if not value["runtime_compatible"] and not blockers:
        raise BaselineError("hardware probe returned incompatible state without a blocker")
    return value


def validate_benchmark_result(value):
    if not isinstance(value, dict) or value.get("$schema") != BENCHMARK_SCHEMA:
        raise BaselineError("benchmark returned an incompatible result")
    if value.get("engineId") != "llama.cpp":
        raise BaselineError("benchmark returned an unexpected engine identity")
    model_id = value.get("modelId")
    if not isinstance(model_id, str) or not model_id.strip() or len(model_id) > 160 or "\0" in model_id:
        raise BaselineError("benchmark returned an invalid model identity")
    if value.get("api_path") != PRODUCT_INFERENCE_API_PATH:
        raise BaselineError("benchmark did not measure the product inference API path")
    if value.get("release_gate") is not False or value.get("tuning_applied") is not False:
        raise BaselineError("benchmark result must remain non-promotional and untuned")
    summary = value.get("summary")
    if not isinstance(summary, dict):
        raise BaselineError("benchmark result is missing its summary")
    wall_rate = summary.get("median_wall_tokens_per_second")
    latency = summary.get("median_latency_ms")
    if not isinstance(wall_rate, (int, float)) or wall_rate <= 0:
        raise BaselineError("benchmark result has invalid wall throughput")
    if not isinstance(latency, (int, float)) or latency <= 0:
        raise BaselineError("benchmark result has invalid latency")
    return value


def build_baseline(
    *,
    base_url=None,
    runs=3,
    n_predict=32,
    timeout=120.0,
    expected_model=None,
):
    hardware_module = load_module(HARDWARE_PROBE, "ordax_local_ai_hardware_probe")
    benchmark_module = load_module(BENCHMARK, "ordax_local_ai_benchmark")
    # Benchmark owns the only production endpoint default. No second
    # localhost model URL is maintained by the baseline compositor.
    if base_url is None:
        base_url = benchmark_module.DEFAULT_BASE_URL

    try:
        hardware = validate_hardware_result(hardware_module.probe_system())
    except BaselineError:
        raise
    except Exception as exc:
        raise BaselineError(f"hardware probe failed: {exc}") from exc

    if hardware["runtime_compatible"] is not True:
        raise BaselineError(
            "hardware is incompatible with the pinned runtime: "
            + ",".join(hardware["start_blockers"])
        )

    try:
        benchmark = validate_benchmark_result(benchmark_module.benchmark(
            base_url,
            runs=runs,
            n_predict=n_predict,
            timeout=timeout,
            expected_model=expected_model,
        ))
    except BaselineError:
        raise
    except Exception as exc:
        raise BaselineError(f"benchmark failed: {exc}") from exc

    return {
        "$schema": SCHEMA,
        "hardware": hardware,
        "benchmark": benchmark,
        "comparison_policy": {
            "same_target_recommended": True,
            "single_variable_tuning_required": True,
            "release_gate": False,
            "runtime_bytes_modified": False,
        },
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=None)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--n-predict", type=int, default=32)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--expected-model")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    try:
        result = build_baseline(
            base_url=args.base_url,
            runs=args.runs,
            n_predict=args.n_predict,
            timeout=args.timeout,
            expected_model=args.expected_model,
        )
    except BaselineError as exc:
        parser.error(str(exc))

    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output is None:
        print(rendered, end="")
    else:
        args.output.write_text(rendered, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
