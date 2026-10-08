#!/usr/bin/env python3
"""Measure an already-running OrdaX local AI backend without changing runtime bytes.

This is an engineering benchmark, not a release gate. It only accepts an IPv4
loopback llama.cpp endpoint, performs one warmup followed by bounded deterministic
samples through the same OpenAI-compatible chat-completions path used by
ordax.local-ai/1, and emits machine-readable measurements for later tuning
comparisons.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request

SCHEMA = "prototype-ordax.local-ai-benchmark/1"
# Real product traffic enters the authenticated Native Host, not the protected
# raw llama.cpp port. The Host owns the ephemeral inference credential.
NATIVE_MODEL_BRIDGE_PATH = "/__ordax/native/local-ai"
DEFAULT_BASE_URL = "http://127.0.0.1:8765" + NATIVE_MODEL_BRIDGE_PATH
DEFAULT_PROMPT = "Reply with exactly: OK"
MAX_DISCOVERY_BYTES = 256 * 1024
MAX_COMPLETION_BYTES = 1024 * 1024
MAX_RUNS = 20
MAX_PREDICT_TOKENS = 256
MAX_TIMEOUT_SECONDS = 300.0


class BenchmarkError(RuntimeError):
    pass


def validate_base_url(value: str) -> str:
    if not isinstance(value, str):
        raise BenchmarkError("benchmark base URL must be a string")
    parsed = urllib.parse.urlsplit(value.strip())
    if (
        parsed.scheme != "http"
        or parsed.hostname != "127.0.0.1"
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in ("", "/", NATIVE_MODEL_BRIDGE_PATH)
        or parsed.query
        or parsed.fragment
    ):
        raise BenchmarkError("benchmark endpoint must be exact IPv4 loopback HTTP")
    try:
        port = parsed.port
    except ValueError as exc:
        raise BenchmarkError("benchmark endpoint port is invalid") from exc
    if port is None or not 1 <= port <= 65535:
        raise BenchmarkError("benchmark endpoint requires an explicit valid port")
    return f"http://127.0.0.1:{port}{parsed.path if parsed.path == NATIVE_MODEL_BRIDGE_PATH else ''}"


def validate_timeout(value: float) -> float:
    try:
        timeout = float(value)
    except (TypeError, ValueError) as exc:
        raise BenchmarkError("benchmark timeout is invalid") from exc
    if not 0.1 <= timeout <= MAX_TIMEOUT_SECONDS:
        raise BenchmarkError("benchmark timeout is outside its allowed bounds")
    return timeout


def read_bounded(response, max_bytes: int) -> bytes:
    raw_length = response.headers.get("Content-Length")
    if raw_length is not None:
        try:
            declared = int(raw_length)
        except ValueError as exc:
            raise BenchmarkError("benchmark response Content-Length is invalid") from exc
        if declared < 0 or declared > max_bytes:
            raise BenchmarkError("benchmark response exceeds its byte limit")

    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = response.read(min(64 * 1024, max_bytes + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > max_bytes:
            raise BenchmarkError("benchmark response exceeds its byte limit")
        chunks.append(chunk)
    return b"".join(chunks)


def request_json(base_url: str, path: str, *, timeout: float, payload=None, max_bytes: int):
    url = base_url + path
    data = None
    headers = {"Accept": "application/json"}
    method = "GET"
    if payload is not None:
        data = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["Content-Type"] = "application/json"
        method = "POST"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            if response.status < 200 or response.status >= 300:
                raise BenchmarkError(f"benchmark endpoint returned HTTP {response.status}")
            raw = read_bounded(response, max_bytes)
    except urllib.error.HTTPError as exc:
        raise BenchmarkError(f"benchmark endpoint returned HTTP {exc.code}") from exc
    except (urllib.error.URLError, TimeoutError, OSError) as exc:
        raise BenchmarkError(f"benchmark endpoint request failed: {exc}") from exc
    try:
        value = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkError("benchmark endpoint returned invalid JSON") from exc
    if not isinstance(value, dict):
        raise BenchmarkError("benchmark endpoint JSON root must be an object")
    return value


def discover_model(base_url: str, timeout: float) -> str:
    payload = request_json(
        base_url,
        "/v1/models",
        timeout=timeout,
        max_bytes=MAX_DISCOVERY_BYTES,
    )
    models = payload.get("data")
    if not isinstance(models, list) or len(models) != 1 or not isinstance(models[0], dict):
        raise BenchmarkError("benchmark requires exactly one active local model")
    model_id = models[0].get("id")
    if not isinstance(model_id, str) or not model_id.strip() or len(model_id) > 160 or "\0" in model_id:
        raise BenchmarkError("benchmark model identity is invalid")
    return model_id.strip()


def run_sample(base_url: str, *, model_id: str, timeout: float, n_predict: int, prompt: str):
    started = time.perf_counter()
    payload = request_json(
        base_url,
        "/v1/chat/completions",
        timeout=timeout,
        max_bytes=MAX_COMPLETION_BYTES,
        payload={
            "model": model_id,
            "messages": [{"role": "user", "content": prompt}],
            "max_tokens": n_predict,
            # Strict Native bridge schema intentionally does not expose
            # arbitrary sampling arguments or action/tool capabilities.
            "stream": False,
        },
    )
    elapsed_seconds = time.perf_counter() - started

    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices or not isinstance(choices[0], dict):
        raise BenchmarkError("benchmark chat completion returned invalid choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise BenchmarkError("benchmark chat completion returned invalid message")
    content = message.get("content")
    if not isinstance(content, str) or not content.strip():
        raise BenchmarkError("benchmark chat completion returned empty content")

    usage = payload.get("usage")
    if not isinstance(usage, dict):
        raise BenchmarkError("benchmark chat completion returned invalid usage")
    tokens = usage.get("completion_tokens")
    if not isinstance(tokens, int) or not 0 < tokens <= n_predict:
        raise BenchmarkError("benchmark chat completion returned invalid token count")

    wall_tokens_per_second = tokens / elapsed_seconds if elapsed_seconds > 0 else 0.0
    timings = payload.get("timings")
    server_tokens_per_second = None
    if isinstance(timings, dict):
        candidate = timings.get("predicted_per_second")
        if isinstance(candidate, (int, float)) and candidate > 0:
            server_tokens_per_second = float(candidate)
    return {
        "latency_ms": round(elapsed_seconds * 1000.0, 3),
        "tokens_predicted": tokens,
        "wall_tokens_per_second": round(wall_tokens_per_second, 3),
        "server_tokens_per_second": (
            round(server_tokens_per_second, 3)
            if server_tokens_per_second is not None
            else None
        ),
    }


def benchmark(
    base_url=DEFAULT_BASE_URL,
    *,
    runs=3,
    n_predict=32,
    timeout=120.0,
    expected_model=None,
    prompt=DEFAULT_PROMPT,
):
    base_url = validate_base_url(base_url)
    timeout = validate_timeout(timeout)
    if not isinstance(runs, int) or not 1 <= runs <= MAX_RUNS:
        raise BenchmarkError("benchmark runs are outside their allowed bounds")
    if not isinstance(n_predict, int) or not 1 <= n_predict <= MAX_PREDICT_TOKENS:
        raise BenchmarkError("benchmark token budget is outside its allowed bounds")
    if not isinstance(prompt, str) or not prompt.strip() or len(prompt) > 1024 or "\0" in prompt:
        raise BenchmarkError("benchmark prompt is outside its allowed bounds")

    model_id = discover_model(base_url, timeout)
    if expected_model is not None and model_id != expected_model:
        raise BenchmarkError(
            f"benchmark active model mismatch: expected={expected_model} actual={model_id}"
        )

    # Warmup is deliberately excluded from reported samples so model-load/cache
    # effects do not masquerade as steady-state inference throughput.
    run_sample(
        base_url,
        model_id=model_id,
        timeout=timeout,
        n_predict=n_predict,
        prompt=prompt,
    )
    samples = [
        run_sample(
            base_url,
            model_id=model_id,
            timeout=timeout,
            n_predict=n_predict,
            prompt=prompt,
        )
        for _ in range(runs)
    ]

    server_rates = [
        sample["server_tokens_per_second"]
        for sample in samples
        if sample["server_tokens_per_second"] is not None
    ]
    return {
        "$schema": SCHEMA,
        "engineId": "llama.cpp",
        "modelId": model_id,
        "endpoint": base_url,
        "api_path": "/v1/chat/completions",
        "warmup_runs": 1,
        "measured_runs": runs,
        "n_predict": n_predict,
        "samples": samples,
        "summary": {
            "median_latency_ms": round(
                statistics.median(sample["latency_ms"] for sample in samples), 3
            ),
            "median_wall_tokens_per_second": round(
                statistics.median(sample["wall_tokens_per_second"] for sample in samples), 3
            ),
            "median_server_tokens_per_second": (
                round(statistics.median(server_rates), 3) if server_rates else None
            ),
        },
        "release_gate": False,
        "tuning_applied": False,
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--n-predict", type=int, default=32)
    parser.add_argument("--timeout", type=float, default=120.0)
    parser.add_argument("--expected-model")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args(argv)

    try:
        result = benchmark(
            args.base_url,
            runs=args.runs,
            n_predict=args.n_predict,
            timeout=args.timeout,
            expected_model=args.expected_model,
        )
    except BenchmarkError as exc:
        parser.error(str(exc))

    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output is not None:
        args.output.write_text(rendered, encoding="utf-8")
    else:
        print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
