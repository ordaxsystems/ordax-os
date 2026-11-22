#!/usr/bin/env python3
"""Read-only Windows Owner DEV USB inventory, independent of Creator GUI.

Uses the existing physical-device validator in owner_dev_qemu_partition_readonly,
never guesses installed Git revision from ORDAX-DATA, and has no write path.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys

from owner_dev_qemu_partition_readonly import (
    ReadonlyProbeError,
    confirmed_volume,
    inventory,
    verify_superblock,
)

SCHEMA = "ordax.owner-dev-usb-media-inventory/1"


def eligible_numbers() -> list[int]:
    command = (
        "$ErrorActionPreference='Stop';"
        "@(Get-Disk | Where-Object { $_.BusType -eq 'USB' -and "
        "-not $_.IsBoot -and -not $_.IsSystem } | "
        "Select-Object -ExpandProperty Number) | ConvertTo-Json -Compress"
    )
    try:
        response = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            capture_output=True, stdin=subprocess.DEVNULL, timeout=20, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReadonlyProbeError("Windows USB inventory unavailable") from exc
    if response.returncode or len(response.stdout) > 16 * 1024:
        raise ReadonlyProbeError("Windows USB inventory failed")
    try:
        values = json.loads(response.stdout.decode("utf-8-sig"))
    except (ValueError, UnicodeError) as exc:
        raise ReadonlyProbeError("Windows USB inventory malformed") from exc
    if values is None:
        return []
    if type(values) is int:
        values = [values]
    if not isinstance(values, list) or len(values) > 32 or any(
        type(n) is not int or not 0 <= n <= 999 for n in values
    ):
        raise ReadonlyProbeError("Windows USB inventory contains invalid disk numbers")
    if len(set(values)) != len(values):
        raise ReadonlyProbeError("Windows USB inventory contains duplicate disk")
    return sorted(values)


def inspect(disk_number: int, serial: str) -> dict:
    if type(serial) is not str or re.fullmatch(r"[A-Za-z0-9_-]{4,64}", serial) is None:
        raise ReadonlyProbeError("USB serial required to prove disk identity")
    before = inventory(disk_number)
    volume = confirmed_volume(before, disk_number, serial)
    verify_superblock(volume)
    after = inventory(disk_number)
    if before != after or confirmed_volume(after, disk_number, serial) != volume:
        raise ReadonlyProbeError("USB changed during read-only inspection")
    return {
        "$schema": SCHEMA,
        "status": "recognized",
        "disk_number": disk_number,
        "usb_serial": str(before["Serial"]).upper(),
        "bus": "USB",
        "profile": "owner-development",
        "linux_partition_number": 2,
        "linux_volume_letter": volume,
        "data_volume_letter": str(before["Partitions"][2]["Letter"]),
        "physical_size_bytes": before["Size"],
        "ext_filesystem_superblock_verified": True,
        "installed_os_revision": None,
        "installed_revision_proven": False,
        "physical_write": False,
        "physical_write_authorized": False,
        "update_executed": False,
    }


def list_media() -> dict:
    devices = []
    for number in eligible_numbers():
        try:
            candidate = inventory(number)
            if not isinstance(candidate, dict):
                continue
            # Only a fully recognized Owner DEV volume is surfaced; unknown
            # USB devices must never become implicit write targets.
            device = inspect(number, str(candidate.get("Serial", "")))
        except (ReadonlyProbeError, ValueError, TypeError, OSError):
            continue
        devices.append(device)
    return {"$schema": SCHEMA, "status": "ok", "devices": devices,
            "device_count": len(devices), "physical_write": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    choice = parser.add_mutually_exclusive_group(required=True)
    choice.add_argument("--list", action="store_true")
    choice.add_argument("--inspect", action="store_true")
    parser.add_argument("--disk-number", type=int)
    parser.add_argument("--serial")
    args = parser.parse_args()
    try:
        if args.list:
            if args.disk_number is not None or args.serial is not None:
                raise ReadonlyProbeError("list does not accept a target override")
            result = list_media()
        else:
            if args.disk_number is None or args.serial is None:
                raise ReadonlyProbeError("inspection requires disk number and serial")
            result = inspect(args.disk_number, args.serial)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except (ReadonlyProbeError, ValueError, TypeError, OSError) as exc:
        print("ordax-owner-usb-inventory: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
