#!/usr/bin/env python3
"""Collect bounded, read-only libata sysfs evidence on physical OrdaX hosts.

The probe exists to capture evidence for ATA/SATA link negotiation and libata
error recovery without changing controller, link, device, kernel, or storage
state. It deliberately excludes device identity attributes such as model,
serial, WWN, IDENTIFY blobs, and block-device contents.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

SCHEMA = "ordax.physical-ata-evidence/1"
MAX_ENTRIES_PER_CLASS = 64
MAX_ATTRIBUTE_BYTES = 16 * 1024
MAX_ERROR_RING_LINES = 32
MAX_ERROR_RING_LINE_CHARS = 512

_ENTRY_PATTERNS = {
    "ports": re.compile(r"^ata[0-9]+$"),
    "links": re.compile(r"^link[0-9]+(?:\.[0-9]+)?$"),
    "devices": re.compile(r"^dev[0-9]+(?:\.[0-9]+)?\.[0-9]+$"),
}


def _read_text(path: Path, limit: int = MAX_ATTRIBUTE_BYTES) -> str | None:
    try:
        with path.open("r", encoding="utf-8", errors="replace") as handle:
            return handle.read(limit).strip()
    except OSError:
        return None


def _read_int(path: Path) -> int | None:
    value = _read_text(path, 128)
    if value is None:
        return None
    try:
        return int(value, 10)
    except ValueError:
        return None


def _bounded_entries(directory: Path, pattern: re.Pattern[str]) -> tuple[list[Path], bool]:
    try:
        entries = sorted(
            (entry for entry in directory.iterdir() if pattern.fullmatch(entry.name)),
            key=lambda entry: entry.name,
        )
    except OSError:
        return [], False
    return entries[:MAX_ENTRIES_PER_CLASS], len(entries) > MAX_ENTRIES_PER_CLASS


def _read_error_ring(path: Path) -> list[str]:
    text = _read_text(path)
    if not text:
        return []
    lines = [line[:MAX_ERROR_RING_LINE_CHARS] for line in text.splitlines() if line.strip()]
    return lines[-MAX_ERROR_RING_LINES:]


def read_ports(sys_class_root: Path) -> tuple[list[dict], bool]:
    entries, truncated = _bounded_entries(sys_class_root / "ata_port", _ENTRY_PATTERNS["ports"])
    result = []
    for entry in entries:
        result.append(
            {
                "name": entry.name,
                "portNumber": _read_int(entry / "port_no"),
                "idleIrq": _read_int(entry / "idle_irq"),
            }
        )
    return result, truncated


def read_links(sys_class_root: Path) -> tuple[list[dict], bool]:
    entries, truncated = _bounded_entries(sys_class_root / "ata_link", _ENTRY_PATTERNS["links"])
    result = []
    for entry in entries:
        result.append(
            {
                "name": entry.name,
                "hardwareSpeedLimit": _read_text(entry / "hw_sata_spd_limit", 256),
                "configuredSpeedLimit": _read_text(entry / "sata_spd_limit", 256),
                "negotiatedSpeed": _read_text(entry / "sata_spd", 256),
            }
        )
    return result, truncated


def read_devices(sys_class_root: Path) -> tuple[list[dict], bool]:
    entries, truncated = _bounded_entries(sys_class_root / "ata_device", _ENTRY_PATTERNS["devices"])
    result = []
    for entry in entries:
        result.append(
            {
                "name": entry.name,
                "deviceClass": _read_text(entry / "class", 256),
                "transferMode": _read_text(entry / "xfer_mode", 256),
                "dmaMode": _read_text(entry / "dma_mode", 256),
                "speedDownCount": _read_int(entry / "spdn_cnt"),
                "errorRing": _read_error_ring(entry / "ering"),
            }
        )
    return result, truncated


def collect_evidence(sys_class_root: Path) -> dict:
    ports, ports_truncated = read_ports(sys_class_root)
    links, links_truncated = read_links(sys_class_root)
    devices, devices_truncated = read_devices(sys_class_root)
    return {
        "schema": SCHEMA,
        "status": "observed",
        "environmentAttestation": "unverified",
        "physicalStorageVerdict": None,
        "networkAccess": False,
        "stateMutation": False,
        "hardwareIdentityIncluded": False,
        "limits": {
            "maxEntriesPerClass": MAX_ENTRIES_PER_CLASS,
            "maxAttributeBytes": MAX_ATTRIBUTE_BYTES,
            "maxErrorRingLines": MAX_ERROR_RING_LINES,
            "maxErrorRingLineChars": MAX_ERROR_RING_LINE_CHARS,
        },
        "truncated": {
            "ports": ports_truncated,
            "links": links_truncated,
            "devices": devices_truncated,
        },
        "ports": ports,
        "links": links,
        "devices": devices,
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sys-class-root",
        type=Path,
        default=Path("/sys/class"),
        help=argparse.SUPPRESS,
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(sys.argv[1:] if argv is None else argv)
    result = collect_evidence(args.sys_class_root)
    json.dump(result, sys.stdout, sort_keys=True, separators=(",", ":"))
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
