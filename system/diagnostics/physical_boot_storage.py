#!/usr/bin/env python3
"""Collect bounded read-only kernel evidence for physical storage boot delays.

The collector reads the existing kernel ring buffer, keeps only storage-related
records, and emits observational JSON. It never changes kernel parameters,
module state, devices, filesystems, or storage contents and never produces a
hardware compatibility verdict.
"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import stat
import sys

SCHEMA = "ordax.physical-boot-storage-probe/1"
MAX_RECORDS = 512
MAX_TOTAL_BYTES = 256 * 1024
MAX_RECORD_BYTES = 4096
MAX_MESSAGE_CHARS = 512

_KMSG_HEADER = re.compile(
    r"^(?P<priority>[0-9]+),(?P<sequence>[0-9]+),(?P<timestamp_us>[0-9]+),(?P<flags>[^;]*);(?P<message>.*)$"
)
_ATA_PORT = re.compile(r"\bata(?P<port>[0-9]+)(?:\.[0-9]+)?\b", re.IGNORECASE)
_STORAGE_PATTERNS = (
    ("ahci", re.compile(r"\bahci\b", re.IGNORECASE)),
    ("ata", re.compile(r"\b(?:ata[0-9]+|libata)\b", re.IGNORECASE)),
    ("nvme", re.compile(r"\bnvme(?:[0-9]|:)\w*", re.IGNORECASE)),
    ("usb-storage", re.compile(r"\b(?:usb-storage|uas)\b", re.IGNORECASE)),
    ("scsi", re.compile(r"\b(?:scsi|sd[a-z][0-9]*)\b", re.IGNORECASE)),
)


def _sanitize_message(value: str) -> str:
    cleaned = "".join(character if character.isprintable() else " " for character in value)
    return " ".join(cleaned.split())[:MAX_MESSAGE_CHARS]


def _classify(message: str) -> str | None:
    for category, pattern in _STORAGE_PATTERNS:
        if pattern.search(message):
            return category
    return None


def parse_kmsg_record(raw: bytes) -> dict | None:
    text = raw.decode("utf-8", errors="replace").splitlines()[0] if raw else ""
    match = _KMSG_HEADER.match(text)
    if match is None:
        return None
    message = _sanitize_message(match.group("message"))
    category = _classify(message)
    if category is None:
        return None
    ata_match = _ATA_PORT.search(message)
    priority_value = int(match.group("priority"))
    return {
        "sequence": int(match.group("sequence")),
        "timestampMilliseconds": int(match.group("timestamp_us")) // 1000,
        "kernelSeverity": priority_value & 7,
        "category": category,
        "ataPort": int(ata_match.group("port")) if ata_match else None,
        "message": message,
    }


def read_kernel_records(path: Path, max_records: int = MAX_RECORDS) -> tuple[list[bytes], bool]:
    if not 1 <= max_records <= MAX_RECORDS:
        raise ValueError(f"max-records must be between 1 and {MAX_RECORDS}")
    descriptor = os.open(path, os.O_RDONLY | os.O_NONBLOCK)
    records: list[bytes] = []
    total_bytes = 0
    truncated = False
    try:
        mode = os.fstat(descriptor).st_mode
        if stat.S_ISREG(mode):
            data = os.read(descriptor, MAX_TOTAL_BYTES + 1)
            if len(data) > MAX_TOTAL_BYTES:
                data = data[:MAX_TOTAL_BYTES]
                truncated = True
            lines = data.splitlines()
            if len(lines) > max_records:
                lines = lines[:max_records]
                truncated = True
            records.extend(lines)
            return records, truncated

        try:
            os.lseek(descriptor, 0, os.SEEK_SET)
        except OSError:
            pass
        while len(records) < max_records and total_bytes < MAX_TOTAL_BYTES:
            try:
                raw = os.read(descriptor, MAX_RECORD_BYTES)
            except BlockingIOError:
                break
            if not raw:
                break
            total_bytes += len(raw)
            if total_bytes > MAX_TOTAL_BYTES:
                truncated = True
                break
            records.append(raw)
        if len(records) == max_records:
            truncated = True
        return records, truncated
    finally:
        os.close(descriptor)


def summarize(events: list[dict]) -> dict:
    timestamps = [event["timestampMilliseconds"] for event in events]
    overall_gap = max(
        (later - earlier for earlier, later in zip(timestamps, timestamps[1:])),
        default=None,
    )
    per_port: dict[int, list[int]] = {}
    for event in events:
        port = event.get("ataPort")
        if port is not None:
            per_port.setdefault(port, []).append(event["timestampMilliseconds"])
    ports = []
    for port, values in sorted(per_port.items()):
        ports.append(
            {
                "ataPort": port,
                "eventCount": len(values),
                "firstTimestampMilliseconds": values[0],
                "lastTimestampMilliseconds": values[-1],
                "largestConsecutiveGapMilliseconds": max(
                    (later - earlier for earlier, later in zip(values, values[1:])),
                    default=None,
                ),
            }
        )
    return {
        "storageEventCount": len(events),
        "firstTimestampMilliseconds": timestamps[0] if timestamps else None,
        "lastTimestampMilliseconds": timestamps[-1] if timestamps else None,
        "largestConsecutiveStorageGapMilliseconds": overall_gap,
        "ataPorts": ports,
    }


def runtime_context() -> dict:
    digest = os.environ.get("ORDAX_PROOF_RUNTIME_SHA256", "").strip()
    return {
        "distributionProfile": os.environ.get("ORDAX_PROOF_PROFILE") or None,
        "runtimeMode": os.environ.get("ORDAX_PROOF_RUNTIME_MODE") or None,
        "evidenceScope": os.environ.get("ORDAX_PROOF_EVIDENCE_SCOPE") or None,
        "runtimeSha256": digest or None,
    }


def run_probe(kmsg_path: Path, max_records: int = MAX_RECORDS) -> dict:
    raw_records, truncated = read_kernel_records(kmsg_path, max_records=max_records)
    events = []
    for raw in raw_records:
        parsed = parse_kmsg_record(raw)
        if parsed is not None:
            events.append(parsed)
    events.sort(key=lambda event: (event["timestampMilliseconds"], event["sequence"]))
    return {
        "schema": SCHEMA,
        "status": "observed",
        "environmentAttestation": "unverified",
        "hardwareStorageVerdict": None,
        "networkAccess": False,
        "stateMutation": False,
        "kernelConfigurationMutation": False,
        "recordsRead": len(raw_records),
        "recordLimit": max_records,
        "inputTruncated": truncated,
        "runtimeContext": runtime_context(),
        "events": events,
        "summary": summarize(events),
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--max-records", type=int, default=MAX_RECORDS)
    parser.add_argument("--kmsg-path", type=Path, default=Path("/dev/kmsg"), help=argparse.SUPPRESS)
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = run_probe(args.kmsg_path, max_records=args.max_records)
    except (OSError, ValueError) as error:
        print(f"physical boot storage probe failed: {error}", file=sys.stderr)
        return 2
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
