#!/usr/bin/env python3
"""Bounded read-only benchmark of an already running OrdaX local AI backend.

No process spawning, model download, mutable system action, credential logging,
or remote endpoint. This measures client-visible generation, not model quality.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import json
import math
import os
from pathlib import Path
import stat
import statistics
import time
from urllib.parse import urlsplit
from http.client import HTTPConnection

SCHEMA = "ordax.intelligence-local-benchmark/1"
MAX_RESPONSE_BYTES = 1024 * 1024
DEFAULT_PROMPT = "Briefly explain why the sky appears blue."


class BenchmarkError(ValueError):
    pass


def completion_url(endpoint: str) -> str:
    try:
        url = urlsplit(endpoint)
        port = url.port
    except ValueError as exc:
        raise BenchmarkError("invalid local inference endpoint") from exc
    if (url.scheme != "http" or url.hostname != "127.0.0.1"
            or port is None or not 1 <= port <= 65535 or url.username
            or url.password or url.path not in ("", "/") or url.query
            or url.fragment or url.netloc != f"127.0.0.1:{port}"):
        raise BenchmarkError("endpoint must be literal http://127.0.0.1:PORT")
    return f"http://127.0.0.1:{port}/v1/chat/completions"


def read_key(path: Path) -> str:
    # O_NOFOLLOW and fstat apply to the *opened descriptor*, preventing
    # a symlink swap between an existence check and secret-file reading.
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as exc:
        raise BenchmarkError("API key must be an accessible non-symlink file") from exc
    with os.fdopen(descriptor, "rb") as handle:
        info = os.fstat(handle.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_mode & 0o077:
            raise BenchmarkError("API key file must be private regular file (mode 0600)")
        raw = handle.read(2050)
    if len(raw) > 2049:
        raise BenchmarkError("API key exceeds byte limit")
    try:
        key = raw.decode("ascii").strip()
    except UnicodeDecodeError as exc:
        raise BenchmarkError("API key encoding is invalid") from exc
    if not 1 <= len(key) <= 2048 or any(ord(ch) < 33 or ord(ch) > 126 for ch in key):
        raise BenchmarkError("API key is invalid")
    return key


def process_snapshot(pid: int | None) -> dict | None:
    if pid is None:
        return None
    stat_path = Path(f"/proc/{pid}/stat")
    status_path = Path(f"/proc/{pid}/status")
    if not stat_path.is_file() or not status_path.is_file():
        raise BenchmarkError("selected local process is not available under /proc")
    record = stat_path.read_text(encoding="utf-8")
    if ") " not in record:
        raise BenchmarkError("invalid /proc process record")
    fields = record.rsplit(") ", 1)[1].split()
    if len(fields) < 13:
        raise BenchmarkError("incomplete /proc process record")
    ticks = os_clock_ticks()
    cpu = (int(fields[11]) + int(fields[12])) / ticks
    details = {}
    for line in status_path.read_text(encoding="utf-8").splitlines():
        if line.startswith(("VmRSS:", "VmHWM:")):
            label, value = line.split(":", 1)
            parts = value.split()
            if len(parts) == 2 and parts[1] == "kB":
                details[label] = int(parts[0]) * 1024
    return {"cpu_seconds": cpu, "rss_bytes": details.get("VmRSS"), "lifetime_hwm_bytes": details.get("VmHWM")}


def os_clock_ticks() -> int:
    return os.sysconf("SC_CLK_TCK")


def perform_request(url: str, model: str, prompt: str, key: str, tokens: int, timeout: int) -> tuple[float, int]:
    payload = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "max_tokens": tokens,
        "temperature": 0,
        "stream": False,
    }, separators=(",", ":")).encode("utf-8")
    # Use a direct HTTPConnection, never an environment proxy, URL redirect
    # handler or third-party transport capable of forwarding the API key.
    address = urlsplit(url)
    connection = HTTPConnection("127.0.0.1", address.port, timeout=timeout)
    started = time.perf_counter()
    try:
        connection.request("POST", "/v1/chat/completions", body=payload, headers={
            "Content-Type": "application/json",
            "Authorization": "Bearer " + key,
        })
        response = connection.getresponse()
        if response.status != 200:
            raise BenchmarkError("local backend returned a non-success status")
        size = response.getheader("content-length")
        if size and size.isdecimal() and int(size) > MAX_RESPONSE_BYTES:
            raise BenchmarkError("inference response exceeds byte limit")
        raw = response.read(MAX_RESPONSE_BYTES + 1)
    finally:
        connection.close()
    elapsed = time.perf_counter() - started
    if len(raw) > MAX_RESPONSE_BYTES:
        raise BenchmarkError("inference response exceeds byte limit")
    try:
        body = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise BenchmarkError("inference response is invalid JSON") from exc
    choices = body.get("choices") if isinstance(body, dict) else None
    if (body.get("model") != model or not isinstance(choices, list)
            or len(choices) != 1 or not isinstance(choices[0], dict)):
        raise BenchmarkError("local model identity or completion envelope mismatch")
    item = choices[0]
    msg = item.get("message")
    if (item.get("finish_reason") != "stop" or not isinstance(msg, dict)
            or msg.get("role") != "assistant"
            or not isinstance(msg.get("content"), str) or not msg["content"].strip()
            or "tool_calls" in msg or "function_call" in msg
            or "tool_calls" in item or "function_call" in item):
        raise BenchmarkError("incomplete or authority-bearing completion")
    usage = body.get("usage")
    count = usage.get("completion_tokens") if isinstance(usage, dict) else None
    if type(count) is not int or not 0 < count <= tokens:
        raise BenchmarkError("missing or invalid measured completion token count")
    return elapsed, count


def percentile(values: list[float], percent: float) -> float:
    ordered = sorted(values)
    index = (len(ordered) - 1) * percent
    low = math.floor(index)
    high = math.ceil(index)
    return ordered[low] + (ordered[high] - ordered[low]) * (index - low)


def benchmark(*, endpoint: str, model: str, api_key_file: Path, prompt: str = DEFAULT_PROMPT,
              samples: int = 5, warmups: int = 1, max_tokens: int = 64,
              timeout: int = 120, pid: int | None = None) -> dict:
    url = completion_url(endpoint)
    if not isinstance(model, str) or not 1 <= len(model) <= 160 or "\0" in model:
        raise BenchmarkError("model ID is invalid")
    if not isinstance(prompt, str) or not 1 <= len(prompt) <= 8192 or "\0" in prompt:
        raise BenchmarkError("benchmark prompt is invalid")
    if not 1 <= samples <= 50 or not 0 <= warmups <= 10:
        raise BenchmarkError("sample or warmup count exceeds bound")
    if not 1 <= max_tokens <= 2048 or not 5 <= timeout <= 300:
        raise BenchmarkError("token or timeout limit exceeds bound")
    if pid is not None and pid <= 0:
        raise BenchmarkError("process PID must be positive")
    key = read_key(api_key_file)
    # Warmup results are deliberately omitted from the measured window.
    for _ in range(warmups):
        perform_request(url, model, prompt, key, max_tokens, timeout)
    cpu_before = process_snapshot(pid)
    latency = []
    token_counts = []
    snapshots = [cpu_before] if cpu_before else []
    for _ in range(samples):
        duration, count = perform_request(url, model, prompt, key, max_tokens, timeout)
        latency.append(duration)
        token_counts.append(count)
        snapshot = process_snapshot(pid)
        if snapshot:
            snapshots.append(snapshot)
    cpu_after = snapshots[-1] if snapshots else None
    rss_values = [r["rss_bytes"] for r in snapshots if r["rss_bytes"] is not None]
    return {
        "schema": SCHEMA,
        "measured_at_utc": datetime.now(timezone.utc).isoformat(),
        "evidence": "real-loopback-http-client",
        "hardware_performance_qualified": False,
        "engine_backend_authenticated": True,
        "model_id": model,
        "warmup_requests": warmups,
        "samples": samples,
        "max_output_tokens_requested": max_tokens,
        "latency_ms": {
            "mean": round(statistics.mean(latency) * 1000, 2),
            "p50": round(percentile(latency, 0.5) * 1000, 2),
            "p95": round(percentile(latency, 0.95) * 1000, 2),
        },
        "completion_tokens_total": sum(token_counts),
        "end_to_end_effective_tokens_per_second": round(sum(token_counts) / sum(latency), 2),
        "selected_process_cpu_seconds": round(cpu_after["cpu_seconds"] - cpu_before["cpu_seconds"], 3)
            if cpu_after and cpu_before else None,
        "sampled_rss_mib_max": round(max(rss_values) / (1024 ** 2), 2) if rss_values else None,
        "process_lifetime_hwm_mib": round(cpu_after["lifetime_hwm_bytes"] / (1024 ** 2), 2)
            if cpu_after and cpu_after["lifetime_hwm_bytes"] is not None else None,
        "is_real_model_quality_test": False,
        "is_buildroot_abi_proof": False,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--endpoint", default="http://127.0.0.1:17865")
    parser.add_argument("--model", required=True)
    parser.add_argument("--api-key-file", type=Path, required=True)
    parser.add_argument("--samples", type=int, default=5)
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--max-tokens", type=int, default=64)
    parser.add_argument("--timeout", type=int, default=120)
    parser.add_argument("--pid", type=int)
    args = parser.parse_args()
    try:
        result = benchmark(endpoint=args.endpoint, model=args.model, api_key_file=args.api_key_file,
                           samples=args.samples, warmups=args.warmups,
                           max_tokens=args.max_tokens, timeout=args.timeout, pid=args.pid)
    except (BenchmarkError, OSError, ValueError) as exc:
        parser.exit(2, f"benchmark failed: {exc}\n")
    print(json.dumps(result, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
