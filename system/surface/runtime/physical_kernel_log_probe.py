#!/usr/bin/env python3
"""Collect bounded ATA-related kernel log evidence from /dev/kmsg.

The collector opens /dev/kmsg read-only and non-blocking, scans a bounded amount
of the printk ring buffer, and emits only ATA/libata/AHCI/SATA records that also
match an explicit recovery/error/link event allowlist. Records carrying hardware
identity markers are deliberately excluded so model/serial/WWN data does not
become part of physical evidence by accident.
"""

from __future__ import annotations

import argparse
import errno
import json
import os
from pathlib import Path
import re
import sys
from typing import Iterable

SCHEMA = "ordax.physical-kernel-log-evidence/1"
KMSG_PATH = Path("/dev/kmsg")
MAX_SCANNED_RECORDS = 4096
MAX_SCANNED_BYTES = 4 * 1024 * 1024
MAX_RECORD_BYTES = 256 * 1024
MAX_OUTPUT_EVENTS = 128
MAX_MESSAGE_CHARS = 512

ATA_SCOPE = re.compile(
    r"(?:\bata[0-9]+(?:\.[0-9]+)?\b|\bahci\b|\blibata\b|\bsata\b)",
    re.IGNORECASE,
)
ATA_EVENT = re.compile(
    r"(?:"
    r"reset(?:ting)?|hardreset|softreset|comreset|"
    r"failed|failure|error|exception|emask|serror|timeout|timed out|"
    r"failed to identify|identify failed|device not ready|"
    r"link (?:is slow to respond|up|down)|limiting sata link speed|disabled"
    r")",
    re.IGNORECASE,
)
HARDWARE_IDENTITY = re.compile(
    r"(?:\bserial(?: number)?\b|\bs/n\s*:|\bmodel(?: number)?\b|\bwwn\b|\bwwid\b)",
    re.IGNORECASE,
)


def _bounded_message(message: str) -> str:
    normalized = " ".join(message.replace("\x00", " ").split())
    return normalized[:MAX_MESSAGE_CHARS]


def parse_kmsg_record(raw: bytes) -> dict | None:
    """Parse one /dev/kmsg record and return a sanitized ATA event or None."""
    text = raw.decode("utf-8", errors="replace")
    first_line = text.splitlines()[0] if text else ""
    if ";" not in first_line:
        return None

    header, message = first_line.split(";", 1)
    fields = header.split(",")
    if len(fields) < 4:
        return None

    try:
        priority = int(fields[0], 10)
        sequence = int(fields[1], 10)
        timestamp_usec = int(fields[2], 10)
    except ValueError:
        return None

    message = _bounded_message(message)
    if (
        not message
        or not ATA_SCOPE.search(message)
        or not ATA_EVENT.search(message)
        or HARDWARE_IDENTITY.search(message)
    ):
        return None

    return {
        "priority": priority,
        "sequence": sequence,
        "timestampUsec": timestamp_usec,
        "flags": fields[3][:32],
        "message": message,
    }


def collect_records(records: Iterable[bytes]) -> dict:
    events: list[dict] = []
    scanned_records = 0
    scanned_bytes = 0
    scan_truncated = False

    for raw in records:
        if scanned_records >= MAX_SCANNED_RECORDS or scanned_bytes >= MAX_SCANNED_BYTES:
            scan_truncated = True
            break
        scanned_records += 1
        scanned_bytes += len(raw)
        if scanned_bytes > MAX_SCANNED_BYTES:
            scan_truncated = True
            break
        event = parse_kmsg_record(raw)
        if event is None:
            continue
        if len(events) >= MAX_OUTPUT_EVENTS:
            scan_truncated = True
            continue
        events.append(event)

    return {
        "schema": SCHEMA,
        "status": "observed",
        "environmentAttestation": "unverified",
        "physicalStorageVerdict": None,
        "networkAccess": False,
        "stateMutation": False,
        "hardwareIdentityIncluded": False,
        "source": "/dev/kmsg",
        "filter": "ata-error-recovery-only",
        "limits": {
            "maxScannedRecords": MAX_SCANNED_RECORDS,
            "maxScannedBytes": MAX_SCANNED_BYTES,
            "maxRecordBytes": MAX_RECORD_BYTES,
            "maxOutputEvents": MAX_OUTPUT_EVENTS,
            "maxMessageChars": MAX_MESSAGE_CHARS,
        },
        "scannedRecords": scanned_records,
        "scannedBytes": scanned_bytes,
        "scanTruncated": scan_truncated,
        "lostRecords": False,
        "events": events,
    }


def read_kmsg(path: Path = KMSG_PATH) -> dict:
    flags = os.O_RDONLY | os.O_NONBLOCK
    flags |= getattr(os, "O_CLOEXEC", 0)
    fd = os.open(path, flags)
    records: list[bytes] = []
    scanned_bytes = 0
    lost_records = False
    limit_reached = False
    try:
        while len(records) < MAX_SCANNED_RECORDS and scanned_bytes < MAX_SCANNED_BYTES:
            try:
                raw = os.read(fd, MAX_RECORD_BYTES)
            except BlockingIOError:
                break
            except OSError as exc:
                if exc.errno == errno.EPIPE:
                    lost_records = True
                    continue
                raise
            if not raw:
                break
            if scanned_bytes + len(raw) > MAX_SCANNED_BYTES:
                limit_reached = True
                break
            records.append(raw)
            scanned_bytes += len(raw)
        if len(records) >= MAX_SCANNED_RECORDS or scanned_bytes >= MAX_SCANNED_BYTES:
            limit_reached = True
    finally:
        os.close(fd)

    result = collect_records(records)
    result["lostRecords"] = lost_records
    result["scanTruncated"] = bool(result["scanTruncated"] or limit_reached)
    return result


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    return parser.parse_args(argv)


def _unavailable_result(exc: OSError) -> dict:
    reason = errno.errorcode.get(exc.errno, "OSERROR") if exc.errno is not None else "OSERROR"
    return {
        "schema": SCHEMA,
        "status": "unavailable",
        "environmentAttestation": "unverified",
        "physicalStorageVerdict": None,
        "networkAccess": False,
        "stateMutation": False,
        "hardwareIdentityIncluded": False,
        "source": "/dev/kmsg",
        "filter": "ata-error-recovery-only",
        "reasonCode": reason,
        "events": [],
    }


def main(argv: list[str] | None = None) -> int:
    parse_args(sys.argv[1:] if argv is None else argv)
    try:
        result = read_kmsg()
        exit_code = 0
    except OSError as exc:
        result = _unavailable_result(exc)
        exit_code = 2
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
