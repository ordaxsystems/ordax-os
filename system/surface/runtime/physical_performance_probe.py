#!/usr/bin/env python3
"""Collect bounded, read-only Linux runtime evidence for physical Surface profiling.

This tool intentionally does not classify performance as PASS/FAIL. It samples
kernel/process counters that can explain physical responsiveness issues and emits
one JSON document to stdout. It performs no network access and writes no files.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys
import time

SCHEMA = "ordax.physical-surface-performance-probe/1"
MAX_SAMPLES = 600
MIN_INTERVAL_SECONDS = 0.1
MAX_INTERVAL_SECONDS = 10.0
PAGE_SIZE = os.sysconf("SC_PAGE_SIZE")
CLOCK_TICKS_PER_SECOND = os.sysconf("SC_CLK_TCK")
# Linux /proc/diskstats reports sector counts in 512-byte sectors regardless of
# the device's physical/logical sector size.
SECTOR_BYTES = 512

_ROLE_MATCHERS = (
    ("native-host", ("native_host_server.py",)),
    ("chromium", ("chromium", "chrome")),
    ("surface-launcher", ("ordax-surface",)),
    ("local-ai", ("llama-server", "ordax-local-ai")),
)


def _read_text(path: Path, limit: int = 256 * 1024) -> str | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.read(limit)
    except OSError:
        return None


def _parse_kib(value: str) -> int:
    match = re.fullmatch(r"([0-9]+)\s+kB", value.strip())
    if not match:
        raise ValueError(f"invalid /proc memory value: {value!r}")
    return int(match.group(1)) * 1024


def read_memory(proc_root: Path) -> dict | None:
    text = _read_text(proc_root / "meminfo")
    if text is None:
        return None
    fields = {}
    for line in text.splitlines():
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        if key in {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}:
            fields[key] = _parse_kib(value)
    required = {"MemTotal", "MemAvailable", "SwapTotal", "SwapFree"}
    if set(fields) != required:
        return None
    return {
        "totalBytes": fields["MemTotal"],
        "availableBytes": fields["MemAvailable"],
        "swapTotalBytes": fields["SwapTotal"],
        "swapFreeBytes": fields["SwapFree"],
    }


def read_load(proc_root: Path) -> dict | None:
    text = _read_text(proc_root / "loadavg", 4096)
    if text is None:
        return None
    fields = text.split()
    if len(fields) < 3:
        return None
    try:
        return {
            "oneMinute": float(fields[0]),
            "fiveMinutes": float(fields[1]),
            "fifteenMinutes": float(fields[2]),
        }
    except ValueError:
        return None


def read_cpu(proc_root: Path) -> dict | None:
    text = _read_text(proc_root / "stat", 64 * 1024)
    if text is None:
        return None
    first = text.splitlines()[0].split() if text.splitlines() else []
    if len(first) < 6 or first[0] != "cpu":
        return None
    try:
        values = [int(value) for value in first[1:]]
    except ValueError:
        return None
    total = sum(values)
    idle = values[3] if len(values) > 3 else 0
    iowait = values[4] if len(values) > 4 else 0
    return {"totalTicks": total, "idleTicks": idle, "ioWaitTicks": iowait}


def _parse_psi_line(line: str) -> dict | None:
    fields = line.split()
    if not fields or fields[0] != "some":
        return None
    result = {}
    for field in fields[1:]:
        if "=" not in field:
            continue
        key, value = field.split("=", 1)
        if key in {"avg10", "avg60", "avg300"}:
            try:
                result[key] = float(value)
            except ValueError:
                return None
        elif key == "total":
            try:
                result[key] = int(value)
            except ValueError:
                return None
    return result if {"avg10", "avg60", "avg300", "total"}.issubset(result) else None


def read_pressure(proc_root: Path) -> dict:
    result = {}
    for resource in ("cpu", "memory", "io"):
        text = _read_text(proc_root / "pressure" / resource, 4096)
        some = None
        if text is not None:
            for line in text.splitlines():
                some = _parse_psi_line(line)
                if some is not None:
                    break
        result[resource] = some
    return result


def read_block_devices(proc_root: Path) -> list[dict]:
    text = _read_text(proc_root / "diskstats")
    if text is None:
        return []
    devices = []
    for line in text.splitlines():
        fields = line.split()
        if len(fields) < 14:
            continue
        name = fields[2]
        if name.startswith(("loop", "ram", "zram", "dm-")):
            continue
        try:
            reads = int(fields[3])
            sectors_read = int(fields[5])
            read_ms = int(fields[6])
            writes = int(fields[7])
            sectors_written = int(fields[9])
            write_ms = int(fields[10])
            io_ms = int(fields[12])
        except ValueError:
            continue
        devices.append(
            {
                "name": name,
                "readsCompleted": reads,
                "bytesRead": sectors_read * SECTOR_BYTES,
                "readMilliseconds": read_ms,
                "writesCompleted": writes,
                "bytesWritten": sectors_written * SECTOR_BYTES,
                "writeMilliseconds": write_ms,
                "ioMilliseconds": io_ms,
            }
        )
    return devices


def _role_for_cmdline(cmdline: str) -> str | None:
    lowered = cmdline.lower()
    for role, needles in _ROLE_MATCHERS:
        if any(needle in lowered for needle in needles):
            return role
    return None


def read_process_roles(proc_root: Path) -> dict:
    aggregates = {
        role: {"processCount": 0, "rssBytes": 0, "cpuTicks": 0}
        for role, _needles in _ROLE_MATCHERS
    }
    try:
        entries = list(proc_root.iterdir())
    except OSError:
        return aggregates
    for entry in entries:
        if not entry.name.isdigit():
            continue
        try:
            raw_cmdline = (entry / "cmdline").read_bytes()[:16 * 1024]
        except OSError:
            continue
        cmdline = raw_cmdline.replace(b"\0", b" ").decode("utf-8", errors="replace")
        role = _role_for_cmdline(cmdline)
        if role is None:
            continue
        stat_text = _read_text(entry / "stat", 16 * 1024)
        if not stat_text:
            continue
        close_paren = stat_text.rfind(")")
        if close_paren < 0:
            continue
        fields = stat_text[close_paren + 2 :].split()
        # /proc/<pid>/stat fields after comm start at field 3 (state).
        try:
            utime = int(fields[11])
            stime = int(fields[12])
            rss_pages = int(fields[21])
        except (IndexError, ValueError):
            continue
        aggregate = aggregates[role]
        aggregate["processCount"] += 1
        aggregate["rssBytes"] += max(0, rss_pages) * PAGE_SIZE
        aggregate["cpuTicks"] += max(0, utime) + max(0, stime)
    return aggregates


def collect_sample(proc_root: Path, monotonic_seconds: float) -> dict:
    uptime_text = _read_text(proc_root / "uptime", 4096)
    uptime = None
    if uptime_text:
        try:
            uptime = float(uptime_text.split()[0])
        except (IndexError, ValueError):
            uptime = None
    return {
        "elapsedMilliseconds": round(monotonic_seconds * 1000),
        "uptimeSeconds": uptime,
        "load": read_load(proc_root),
        "memory": read_memory(proc_root),
        "cpu": read_cpu(proc_root),
        "pressure": read_pressure(proc_root),
        "blockDevices": read_block_devices(proc_root),
        "processRoles": read_process_roles(proc_root),
    }


def _delta(first: int | float | None, last: int | float | None) -> int | float | None:
    if first is None or last is None:
        return None
    return last - first


def summarize(samples: list[dict]) -> dict:
    first = samples[0]
    last = samples[-1]
    first_cpu = first.get("cpu") or {}
    last_cpu = last.get("cpu") or {}
    cpu_total = _delta(first_cpu.get("totalTicks"), last_cpu.get("totalTicks"))
    cpu_idle = _delta(first_cpu.get("idleTicks"), last_cpu.get("idleTicks"))
    cpu_iowait = _delta(first_cpu.get("ioWaitTicks"), last_cpu.get("ioWaitTicks"))
    busy_ratio = None
    io_wait_ratio = None
    if isinstance(cpu_total, (int, float)) and cpu_total > 0:
        busy_ratio = round(max(0.0, 1.0 - (cpu_idle or 0) / cpu_total), 6)
        io_wait_ratio = round(max(0.0, (cpu_iowait or 0) / cpu_total), 6)

    first_devices = {device["name"]: device for device in first.get("blockDevices", [])}
    last_devices = {device["name"]: device for device in last.get("blockDevices", [])}
    device_deltas = []
    for name in sorted(set(first_devices) & set(last_devices)):
        before = first_devices[name]
        after = last_devices[name]
        device_deltas.append(
            {
                "name": name,
                "bytesRead": max(0, after["bytesRead"] - before["bytesRead"]),
                "bytesWritten": max(0, after["bytesWritten"] - before["bytesWritten"]),
                "readMilliseconds": max(0, after["readMilliseconds"] - before["readMilliseconds"]),
                "writeMilliseconds": max(0, after["writeMilliseconds"] - before["writeMilliseconds"]),
                "ioMilliseconds": max(0, after["ioMilliseconds"] - before["ioMilliseconds"]),
            }
        )

    role_deltas = {}
    for role, _needles in _ROLE_MATCHERS:
        before = first["processRoles"][role]
        after = last["processRoles"][role]
        cpu_ticks_delta = max(0, after["cpuTicks"] - before["cpuTicks"])
        role_deltas[role] = {
            "processCountStart": before["processCount"],
            "processCountEnd": after["processCount"],
            "rssBytesStart": before["rssBytes"],
            "rssBytesEnd": after["rssBytes"],
            "rssBytesGrowth": after["rssBytes"] - before["rssBytes"],
            "cpuTicksDelta": cpu_ticks_delta,
            "cpuSecondsDelta": round(cpu_ticks_delta / CLOCK_TICKS_PER_SECOND, 6),
        }

    return {
        "cpuBusyRatio": busy_ratio,
        "cpuIoWaitRatio": io_wait_ratio,
        "blockDeviceDeltas": device_deltas,
        "processRoleDeltas": role_deltas,
    }


def logical_cpu_count() -> int | None:
    value = os.cpu_count()
    return value if isinstance(value, int) and value > 0 else None


def run_probe(proc_root: Path, sample_count: int, interval_seconds: float) -> dict:
    if not 1 <= sample_count <= MAX_SAMPLES:
        raise ValueError(f"samples must be between 1 and {MAX_SAMPLES}")
    if not MIN_INTERVAL_SECONDS <= interval_seconds <= MAX_INTERVAL_SECONDS:
        raise ValueError(
            f"interval-seconds must be between {MIN_INTERVAL_SECONDS} and {MAX_INTERVAL_SECONDS}"
        )
    started = time.monotonic()
    samples = []
    for index in range(sample_count):
        samples.append(collect_sample(proc_root, time.monotonic() - started))
        if index + 1 < sample_count:
            time.sleep(interval_seconds)
    return {
        "schema": SCHEMA,
        "status": "observed",
        "environmentAttestation": "unverified",
        "physicalPerformanceVerdict": None,
        "networkAccess": False,
        "stateMutation": False,
        "samplesRequested": sample_count,
        "intervalSeconds": interval_seconds,
        "logicalCpuCount": logical_cpu_count(),
        "measurementUnits": {
            "pageSizeBytes": PAGE_SIZE,
            "clockTicksPerSecond": CLOCK_TICKS_PER_SECOND,
            "diskStatSectorBytes": SECTOR_BYTES,
        },
        "samples": samples,
        "summary": summarize(samples),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--samples", type=int, default=60)
    parser.add_argument("--interval-seconds", type=float, default=1.0)
    parser.add_argument("--proc-root", type=Path, default=Path("/proc"), help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = run_probe(args.proc_root, args.samples, args.interval_seconds)
    except (OSError, ValueError) as error:
        print(f"physical performance probe failed: {error}", file=sys.stderr)
        return 2
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
