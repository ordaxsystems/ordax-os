#!/usr/bin/env python3
"""Compute a read-only, partition-confined QCOW2 change plan for Owner DEV.

The plan is NOT physical-write authorization. The Creator raw writer remains
the sole physical-write owner. This module never opens a USB writable.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import subprocess

SECTOR = 512
CHUNK = 1024 * 1024
MAX_EXTENTS = 8192
MAX_CHANGED = 2 * 1024 * 1024 * 1024
SCHEMA = "ordax.creator.owner-dev-cow-delta-plan/1"
SERIAL = re.compile(r"[A-Za-z0-9_-]{4,64}\Z")
VOL = re.compile(r"\\\\\.\\[D-Z]:")


class DeltaPlanError(RuntimeError):
    pass


def _qemu_json(tool: Path, operation: str, image: Path) -> object:
    if (tool.is_symlink() or not tool.is_file()
            or image.is_symlink() or not image.is_file()):
        raise DeltaPlanError("QEMU image or executable is missing or linked")
    args = [str(tool), operation, "--output=json", str(image)]
    try:
        result = subprocess.run(
            args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=40, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise DeltaPlanError("QEMU QCOW2 inspection unavailable") from exc
    if result.returncode or len(result.stdout) > 4 * 1024 * 1024:
        raise DeltaPlanError("QEMU QCOW2 inspection rejected the overlay")
    try:
        return json.loads(result.stdout.decode("utf-8"))
    except (ValueError, UnicodeError) as exc:
        raise DeltaPlanError("QEMU returned invalid JSON map") from exc


def _strict_integer(value: object, lower: int, upper: int) -> bool:
    return type(value) is int and lower <= value <= upper


def _segments(map_json: object, virtual_bytes: int) -> list[dict]:
    if not isinstance(map_json, list) or not 1 <= len(map_json) <= MAX_EXTENTS:
        raise DeltaPlanError("QCOW2 map has invalid extent count")
    changed = []
    cursor = 0
    total_changed = 0
    for entry in map_json:
        if not isinstance(entry, dict):
            raise DeltaPlanError("QCOW2 extent is not an object")
        start = entry.get("start")
        length = entry.get("length")
        depth = entry.get("depth")
        if (not _strict_integer(start, 0, virtual_bytes)
                or not _strict_integer(length, SECTOR, virtual_bytes)
                or not _strict_integer(depth, 0, 1)
                or start != cursor or start % SECTOR or length % SECTOR
                or start + length > virtual_bytes):
            raise DeltaPlanError("QCOW2 map is not a complete aligned partition map")
        for flag in ("present", "zero", "data", "compressed"):
            if type(entry.get(flag)) is not bool:
                raise DeltaPlanError("QCOW2 extent flags are ambiguous")
        if entry["compressed"]:
            raise DeltaPlanError("QCOW2 compressed clusters are unsupported")
        cursor += length
        if depth == 1:
            # Backing bytes remain on the original USB; they are NOT writes.
            continue
        if not entry["zero"] and (not entry["present"] or not entry["data"]):
            raise DeltaPlanError("QCOW2 changed cluster lacks exact data or zero")
        if entry["zero"]:
            if entry["data"]:
                raise DeltaPlanError("QCOW2 zero extent has contradictory flags")
            kind, source_offset = "zero", None
        else:
            source_offset = entry.get("offset")
            if (not _strict_integer(source_offset, 0, 1 << 62)
                    or source_offset % SECTOR):
                raise DeltaPlanError("QCOW2 data cluster source offset invalid")
            kind = "data"
        total_changed += length
        if total_changed > MAX_CHANGED:
            raise DeltaPlanError("QCOW2 update exceeds bounded DEV changed bytes")
        changed.append({"virtual_offset": start, "length": length,
                        "kind": kind, "source_offset": source_offset})
    if cursor != virtual_bytes or not changed:
        raise DeltaPlanError("QCOW2 map does not cover a staged changed partition")
    return changed


def _hash_bytes(handle, offset: int, length: int, *, zero: bool = False) -> str:
    result = hashlib.sha256()
    if not zero:
        handle.seek(offset)
    remain = length
    while remain:
        size = min(CHUNK, remain)
        block = (bytes(size) if zero else handle.read(size))
        if len(block) != size:
            raise DeltaPlanError("QCOW2 or physical USB preimage has a short read")
        result.update(block)
        remain -= size
    return result.hexdigest()


def compile_delta(*, qemu_img: Path, overlay: Path, volume: str,
                  disk_number: int, usb_serial: str,
                  target_bytes: int, partition_offset: int,
                  partition_bytes: int, include_regions: bool = False) -> dict:
    if (type(disk_number) is not int or not 0 <= disk_number <= 999
            or not isinstance(usb_serial, str) or not SERIAL.fullmatch(usb_serial)
            or not isinstance(volume, str) or not VOL.fullmatch(volume)
            or not _strict_integer(target_bytes, SECTOR, 1 << 48)
            or not _strict_integer(partition_offset, SECTOR, target_bytes - SECTOR)
            or not _strict_integer(partition_bytes, SECTOR, target_bytes)
            or partition_offset % SECTOR or partition_bytes % SECTOR
            or partition_offset + partition_bytes > target_bytes):
        raise DeltaPlanError("physical USB partition binding is invalid")

    info = _qemu_json(qemu_img, "info", overlay)
    if (not isinstance(info, dict) or info.get("format") != "qcow2"
            or info.get("encrypted", False) is not False
            or info.get("backing-filename") != volume
            or info.get("backing-filename-format") != "raw"
            or type(info.get("virtual-size")) is not int
            or info["virtual-size"] != partition_bytes):
        raise DeltaPlanError("QCOW2 backing differs from the selected physical Linux volume")
    extents = _segments(_qemu_json(qemu_img, "map", overlay), partition_bytes)
    overlay_bytes = overlay.stat().st_size
    regions = []
    try:
        with overlay.open("rb", buffering=0) as source, \
                open(volume, "rb", buffering=0) as original:
            for item in extents:
                start, length = item["virtual_offset"], item["length"]
                offset = item["source_offset"]
                if offset is not None and offset + length > overlay_bytes:
                    raise DeltaPlanError("QCOW2 data extent escapes overlay image")
                after = _hash_bytes(source, offset or 0, length,
                                    zero=item["kind"] == "zero")
                before = _hash_bytes(original, start, length)
                regions.append({
                    "kind": item["kind"],
                    "disk_offset_bytes": partition_offset + start,
                    "virtual_offset_bytes": start,
                    "length_bytes": length,
                    "overlay_source_offset_bytes": offset,
                    "preimage_sha256": before,
                    "postimage_sha256": after,
                })
    except OSError as exc:
        raise DeltaPlanError("read-only QCOW2 or original USB data unavailable") from exc

    digest_input = {
        "$schema": SCHEMA, "disk_number": disk_number,
        "usb_serial": usb_serial.upper(),
        "physical_size_bytes": target_bytes,
        "partition_start_bytes": partition_offset,
        "partition_size_bytes": partition_bytes,
        "regions": regions,
    }
    encoded = json.dumps(digest_input, sort_keys=True,
                         separators=(",", ":")).encode("utf-8")
    receipt = {
        "$schema": SCHEMA,
        "status": "verified-readonly-delta-plan",
        "disk_number": disk_number, "usb_serial": usb_serial.upper(),
        "region_count": len(regions),
        "modified_bytes": sum(x["length_bytes"] for x in regions),
        "plan_sha256": hashlib.sha256(encoded).hexdigest(),
        "physical_preimages_hashed": True,
        "cow_postimages_hashed": True,
        "physical_write": False,
        "physical_write_authorized": False,
        "apply_executed": False,
        "requires_revalidation_under_writer_lock": True,
        # Never expose ephemeral QCOW offsets in the public read-only receipt.
    }
    if include_regions:
        # Internal-only temporary handoff; the host bundle omits QCOW offsets.
        receipt["regions"] = regions
    return receipt
