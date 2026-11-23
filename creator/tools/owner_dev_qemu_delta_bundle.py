#!/usr/bin/env python3
"""Verified host-local COW delta bundle for the existing Creator physical writer.

No physical disk writer, updater or authorization is implemented here. The
payload contains only changed ext4 partition blocks proven by the OS Base
channel and disposable QEMU; the Windows Creator writer MUST reacquire a
locked device, recheck every preimage, sync, and read back before claiming any
physical change. Staging itself is never an installation or activation.
"""
from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

SCHEMA = "ordax.creator.owner-dev-usb-delta-bundle/1"
PLAN_SCHEMA = "ordax.creator.owner-dev-cow-delta-plan/1"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
HEX64 = re.compile(r"[0-9a-f]{64}\Z")
SERIAL = re.compile(r"[A-Za-z0-9_-]{4,64}\Z")
SECTOR = 512
BLOCK = 1 << 20
MAX_CHANGED = 2 << 30
MAX_REGIONS = 8192


class DeltaBundleError(RuntimeError):
    pass


def _regular(path: Path) -> bool:
    return (path.is_file() and not path.is_symlink()
            and not getattr(path, "is_junction", lambda: False)())


def _directory(path: Path) -> bool:
    return (path.is_dir() and not path.is_symlink()
            and not getattr(path, "is_junction", lambda: False)())


def _hash_file(path: Path) -> str:
    if not _regular(path):
        raise DeltaBundleError("bundle source is missing or linked")
    h = hashlib.sha256()
    with path.open("rb") as source:
        while data := source.read(BLOCK):
            h.update(data)
    return h.hexdigest()


def canonical_json(data: dict) -> bytes:
    return (json.dumps(data, sort_keys=True, separators=(",", ":"),
                       ensure_ascii=True) + "\n").encode("ascii")


def _validate_regions(delta: dict, *, disk_number: int, serial: str,
                      disk_bytes: int, partition_start: int,
                      partition_bytes: int) -> list[dict]:
    if (type(disk_number) is not int or not 0 <= disk_number <= 999
            or not isinstance(serial, str) or not SERIAL.fullmatch(serial)
            or type(disk_bytes) is not int or disk_bytes <= 0
            or type(partition_start) is not int
            or type(partition_bytes) is not int
            or partition_start < 0 or partition_bytes <= 0
            or partition_start % SECTOR or partition_bytes % SECTOR
            or partition_start + partition_bytes > disk_bytes):
        raise DeltaBundleError("physical partition identity is invalid")
    if (not isinstance(delta, dict)
            or delta.get("$schema") != PLAN_SCHEMA
            or delta.get("status") != "verified-readonly-delta-plan"
            or delta.get("disk_number") != disk_number
            or delta.get("usb_serial") != serial.upper()
            or delta.get("physical_write") is not False
            or delta.get("physical_write_authorized") is not False
            or delta.get("apply_executed") is not False
            or delta.get("physical_preimages_hashed") is not True
            or delta.get("cow_postimages_hashed") is not True
            or not isinstance(delta.get("regions"), list)
            or not 1 <= len(delta["regions"]) <= MAX_REGIONS):
        raise DeltaBundleError("untrusted or incomplete QEMU COW delta receipt")
    rows = delta["regions"]
    if type(delta.get("region_count")) is not int or delta["region_count"] != len(rows):
        raise DeltaBundleError("changed region count differs from receipt")
    cursor = -1
    total = 0
    for row in rows:
        if not isinstance(row, dict):
            raise DeltaBundleError("COW changed region is invalid")
        start, length = row.get("virtual_offset_bytes"), row.get("length_bytes")
        # QCOW offsets are ephemeral: consume them only inside this producer,
        # never export them in the persistent bundle manifest.
        if (type(start) is not int or type(length) is not int or
                start < 0 or start % SECTOR or length <= 0 or
                length % SECTOR or start + length > partition_bytes or
                start <= cursor):
            raise DeltaBundleError("changed ext4 region is outside partition or unsorted")
        cursor = start + length - 1
        if row.get("disk_offset_bytes") != partition_start + start:
            raise DeltaBundleError("changed region escaped exact physical partition")
        if row.get("kind") not in ("data", "zero"):
            raise DeltaBundleError("unsupported changed region kind")
        offset = row.get("overlay_source_offset_bytes")
        if (row["kind"] == "zero" and offset is not None) or (
            row["kind"] == "data" and
            (type(offset) is not int or offset < 0 or offset % SECTOR)
        ):
            raise DeltaBundleError("changed region QCOW source offset invalid")
        if not all(isinstance(row.get(k), str) and HEX64.fullmatch(row[k])
                   for k in ("preimage_sha256", "postimage_sha256")):
            raise DeltaBundleError("changed region lacks two exact SHA-256 proofs")
        total += length
        if total > MAX_CHANGED:
            raise DeltaBundleError("changed ext4 payload exceeds safe limit")
    if delta.get("modified_bytes") != total or type(delta.get("modified_bytes")) is not int:
        raise DeltaBundleError("changed ext4 byte count differs")
    if not isinstance(delta.get("plan_sha256"), str) or not HEX64.fullmatch(delta["plan_sha256"]):
        raise DeltaBundleError("changed ext4 plan digest invalid")
    # The fingerprint must cover the ORIGINAL source offsets, even though
    # those offsets are intentionally NOT persisted into the bundle.
    plan = {
        "$schema": PLAN_SCHEMA, "disk_number": disk_number,
        "usb_serial": serial.upper(), "physical_size_bytes": disk_bytes,
        "partition_start_bytes": partition_start,
        "partition_size_bytes": partition_bytes,
        "regions": [
            {
                "kind": x["kind"], "disk_offset_bytes": x["disk_offset_bytes"],
                "virtual_offset_bytes": x["virtual_offset_bytes"],
                "length_bytes": x["length_bytes"],
                "overlay_source_offset_bytes": x["overlay_source_offset_bytes"],
                "preimage_sha256": x["preimage_sha256"],
                "postimage_sha256": x["postimage_sha256"],
            }
            for x in rows
        ],
    }
    encoded = json.dumps(plan, sort_keys=True, separators=(",", ":")).encode("utf-8")
    if hashlib.sha256(encoded).hexdigest() != delta["plan_sha256"]:
        raise DeltaBundleError("COW plan fingerprint differs from evidence")
    return rows


def _write_payload(overlay: Path, path: Path, regions: list[dict]) -> tuple[list[dict], str, int]:
    if not _regular(overlay):
        raise DeltaBundleError("QEMU overlay is absent or linked")
    overlay_size = overlay.stat().st_size
    changes: list[dict] = []
    full = hashlib.sha256()
    payload_offset = 0
    with overlay.open("rb", buffering=0) as source, path.open("xb") as output:
        for item in regions:
            copied = 0
            part_hash = hashlib.sha256()
            start = item["overlay_source_offset_bytes"]
            length = item["length_bytes"]
            if start is not None:
                if start + length > overlay_size:
                    raise DeltaBundleError("QCOW data range leaves verified overlay")
                source.seek(start)
            while copied < length:
                count = min(BLOCK, length - copied)
                block = bytes(count) if start is None else source.read(count)
                if len(block) != count:
                    raise DeltaBundleError("QCOW overlay payload short read")
                if output.write(block) != count:
                    raise DeltaBundleError("local package short write")
                part_hash.update(block)
                full.update(block)
                copied += count
            if part_hash.hexdigest() != item["postimage_sha256"]:
                raise DeltaBundleError("QCOW changed data no longer matches postimage proof")
            changes.append({
                "disk_offset_bytes": item["disk_offset_bytes"],
                "virtual_offset_bytes": item["virtual_offset_bytes"],
                "length_bytes": length,
                "payload_offset_bytes": payload_offset,
                "preimage_sha256": item["preimage_sha256"],
                "postimage_sha256": item["postimage_sha256"],
            })
            payload_offset += length
        output.flush()
        os.fsync(output.fileno())
    return changes, full.hexdigest(), payload_offset


def verify_bundle(directory: Path) -> dict:
    if not _directory(directory):
        raise DeltaBundleError("prepared delta bundle directory missing or linked")
    manifest_file, payload_file = directory / "manifest.json", directory / "delta.bin"
    if not _regular(manifest_file) or not _regular(payload_file):
        raise DeltaBundleError("prepared delta package is incomplete or linked")
    if manifest_file.stat().st_size > 4 * 1024 * 1024:
        raise DeltaBundleError("prepared delta manifest exceeds bound")
    try:
        raw = manifest_file.read_bytes()
        m = json.loads(raw.decode("ascii"))
    except (ValueError, UnicodeError, OSError) as exc:
        raise DeltaBundleError("prepared delta manifest invalid") from exc
    if (not isinstance(m, dict)
            or canonical_json(m) != raw
            or m.get("$schema") != SCHEMA
            or m.get("status") != "prepared-not-authorized"
            or m.get("purpose", "filesystem-proof-only") != "filesystem-proof-only"
            or m.get("installable_candidate", False) is not False
            or m.get("canonical_inactive_slot_staged", False) is not False
            or m.get("physical_write") is not False
            or m.get("physical_write_authorized") is not False
            or m.get("activation_performed") is not False
            or m.get("preimages_require_locked_revalidation") is not True
            or m.get("payload_file") != "delta.bin"
            or type(m.get("payload_bytes")) is not int
            or not 1 <= m["payload_bytes"] <= MAX_CHANGED
            or payload_file.stat().st_size != m["payload_bytes"]
            or not isinstance(m.get("payload_sha256"), str)
            or not HEX64.fullmatch(m["payload_sha256"])
            or not isinstance(m.get("regions"), list)
            or not 1 <= len(m["regions"]) <= MAX_REGIONS):
        raise DeltaBundleError("prepared bundle fails immutable receipt policy")
    target = m.get("target")
    if (not isinstance(target, dict)
            or type(target.get("disk_number")) is not int
            or not 0 <= target["disk_number"] <= 999):
        raise DeltaBundleError("bundle target identity missing")
    if type(target.get("partition_number")) is not int or target["partition_number"] != 2:
        raise DeltaBundleError("bundle does not target exact Linux partition 2")
    disk, first, size = (target.get("physical_size_bytes"),
                         target.get("partition_offset_bytes"),
                         target.get("partition_bytes"))
    if (type(disk) is not int or type(first) is not int or type(size) is not int
            or disk <= 0 or first < 0 or size <= 0
            or first % SECTOR or size % SECTOR or first + size > disk
            or not isinstance(target.get("usb_serial"), str)
            or not SERIAL.fullmatch(target["usb_serial"])):
        raise DeltaBundleError("bundle physical bounds are invalid")
    if not all(isinstance(m.get(key), str) and HEX40.fullmatch(m[key])
               for key in ("requested_main_commit", "published_base_source_commit")):
        raise DeltaBundleError("bundle canonical Git revision missing")
    if not isinstance(m.get("cow_plan_sha256"), str) or not HEX64.fullmatch(m["cow_plan_sha256"]):
        raise DeltaBundleError("bundle COW plan proof absent")
    cursor = -1
    file_offset = 0
    with payload_file.open("rb") as payload:
        for entry in m["regions"]:
            if not isinstance(entry, dict):
                raise DeltaBundleError("bundle region row invalid")
            offset, length, virtual, local = (
                entry.get("disk_offset_bytes"), entry.get("length_bytes"),
                entry.get("virtual_offset_bytes"), entry.get("payload_offset_bytes"),
            )
            if (any(type(v) is not int for v in (offset, length, virtual, local))
                    or length <= 0 or length % SECTOR
                    or virtual < 0 or virtual % SECTOR
                    or virtual <= cursor or virtual + length > size
                    or offset != first + virtual or local != file_offset
                    or offset + length > first + size):
                raise DeltaBundleError("bundle ranges are not contiguous in payload or partition")
            if not all(isinstance(entry.get(k), str) and HEX64.fullmatch(entry[k])
                       for k in ("preimage_sha256", "postimage_sha256")):
                raise DeltaBundleError("bundle lacks pre/post image checksums")
            # This is the same readback that the future Windows locked writer
            # will repeat before and after applying each region.
            h = hashlib.sha256()
            remain = length
            while remain:
                block = payload.read(min(BLOCK, remain))
                if not block:
                    raise DeltaBundleError("bundle payload truncated during region proof")
                h.update(block)
                remain -= len(block)
            if h.hexdigest() != entry["postimage_sha256"]:
                raise DeltaBundleError("bundle region postimage checksum corrupted")
            cursor = virtual + length - 1
            file_offset += length
    if file_offset != m["payload_bytes"] or _hash_file(payload_file) != m["payload_sha256"]:
        raise DeltaBundleError("bundle payload length or SHA-256 mismatch")
    return m


def prepare_bundle(*, delta: dict, overlay: Path, cache_root: Path,
                   disk_number: int, serial: str, disk_bytes: int,
                   partition_offset: int, partition_bytes: int,
                   requested_main_commit: str, published_base_source_commit: str) -> dict:
    if (not isinstance(requested_main_commit, str)
            or not HEX40.fullmatch(requested_main_commit)
            or not isinstance(published_base_source_commit, str)
            or not HEX40.fullmatch(published_base_source_commit)):
        raise DeltaBundleError("unsigned or malformed OS candidate identity")
    regions = _validate_regions(
        delta, disk_number=disk_number, serial=serial,
        disk_bytes=disk_bytes, partition_start=partition_offset,
        partition_bytes=partition_bytes,
    )
    if cache_root.is_symlink() or getattr(cache_root, "is_junction", lambda: False)():
        raise DeltaBundleError("candidate cache root is a link")
    cache_root.mkdir(parents=True, exist_ok=True)
    if not _directory(cache_root):
        raise DeltaBundleError("candidate cache root unavailable")
    # Same verified plan and Git candidate map to the same immutable bundle.
    name = f"{requested_main_commit[:16]}-{serial.upper()}-{delta['plan_sha256'][:24]}"
    destination = cache_root / name
    if destination.exists():
        old = verify_bundle(destination)
        if (old["cow_plan_sha256"] != delta["plan_sha256"]
                or old["requested_main_commit"] != requested_main_commit
                or old["published_base_source_commit"] != published_base_source_commit
                or old["target"] != {
                    "disk_number": disk_number, "usb_serial": serial.upper(),
                    "physical_size_bytes": disk_bytes, "partition_number": 2,
                    "partition_offset_bytes": partition_offset,
                    "partition_bytes": partition_bytes,
                }):
            raise DeltaBundleError("existing candidate bundle conflicts")
        return _receipt(destination, old, reused=True)

    staging = Path(tempfile.mkdtemp(prefix=".ordax-delta-pending-", dir=cache_root))
    try:
        changes, payload_sha, length = _write_payload(
            overlay, staging / "delta.bin", regions,
        )
        manifest = {
            "$schema": SCHEMA,
            "status": "prepared-not-authorized",
            "purpose": "filesystem-proof-only",
            "installable_candidate": False,
            "canonical_inactive_slot_staged": False,
            "requested_main_commit": requested_main_commit,
            "published_base_source_commit": published_base_source_commit,
            "cow_plan_sha256": delta["plan_sha256"],
            "target": {
                "disk_number": disk_number, "usb_serial": serial.upper(),
                "physical_size_bytes": disk_bytes, "partition_number": 2,
                "partition_offset_bytes": partition_offset,
                "partition_bytes": partition_bytes,
            },
            "payload_file": "delta.bin", "payload_sha256": payload_sha,
            "payload_bytes": length, "regions": changes,
            "preimages_require_locked_revalidation": True,
            "physical_write": False, "physical_write_authorized": False,
            "activation_performed": False,
        }
        with (staging / "manifest.json").open("xb") as output:
            output.write(canonical_json(manifest))
            output.flush()
            os.fsync(output.fileno())
        verified = verify_bundle(staging)
        # os.rename fails closed rather than overwriting a concurrent bundle.
        if destination.exists():
            raise DeltaBundleError("candidate bundle appeared concurrently")
        staging.rename(destination)
        return _receipt(destination, verified, reused=False)
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def _receipt(directory: Path, manifest: dict, *, reused: bool) -> dict:
    return {
        "$schema": SCHEMA, "status": "prepared-not-authorized",
        "purpose": "filesystem-proof-only",
        "installable_candidate": False,
        "canonical_inactive_slot_staged": False,
        "bundle_path": str(directory),
        "manifest_sha256": _hash_file(directory / "manifest.json"),
        "payload_sha256": manifest["payload_sha256"],
        "payload_bytes": manifest["payload_bytes"],
        "region_count": len(manifest["regions"]),
        "cow_plan_sha256": manifest["cow_plan_sha256"],
        "requested_main_commit": manifest["requested_main_commit"],
        "usb_serial": manifest["target"]["usb_serial"],
        "cache_reused": reused,
        "physical_write_authorized": False,
        "physical_write": False,
        "activation_performed": False,
    }


def verify_physical_preimages(
    directory: Path, *, volume: str, disk_number: int, serial: str,
    disk_bytes: int, partition_offset: int, partition_bytes: int,
) -> dict:
    """Recheck an immutable bundle against ORIGINAL ext4 bytes, never write.

    This is a fast cache-reuse gate and cannot replace the Creator Win32
    writer's revalidation after acquiring the exclusive volume lease.
    """
    manifest = verify_bundle(directory)
    expected = {
        "disk_number": disk_number, "usb_serial": serial.upper(),
        "physical_size_bytes": disk_bytes, "partition_number": 2,
        "partition_offset_bytes": partition_offset,
        "partition_bytes": partition_bytes,
    }
    if manifest["target"] != expected:
        raise DeltaBundleError("cached delta target no longer matches physical USB")
    prefix = chr(92) + chr(92) + "." + chr(92)
    if (not isinstance(volume, str) or len(volume) != 6
            or volume[:4] != prefix
            or volume[4] not in "DEFGHIJKLMNOPQRSTUVWXYZ"
            or volume[5] != ":"):
        raise DeltaBundleError("cached delta source must be an exact Windows volume")

    verified = 0
    try:
        with open(volume, "rb", buffering=0) as original:
            for region in manifest["regions"]:
                original.seek(region["virtual_offset_bytes"])
                digest = hashlib.sha256()
                remaining = region["length_bytes"]
                while remaining:
                    chunk = original.read(min(BLOCK, remaining))
                    if not chunk:
                        raise DeltaBundleError("current physical ext4 preimage short read")
                    digest.update(chunk)
                    remaining -= len(chunk)
                if digest.hexdigest() != region["preimage_sha256"]:
                    raise DeltaBundleError(
                        "cached delta is stale: physical ext4 preimage changed"
                    )
                verified += region["length_bytes"]
    except OSError as exc:
        raise DeltaBundleError("current USB ext4 volume unavailable read-only") from exc
    return {
        "$schema": SCHEMA,
        "status": "cached-preimages-still-match",
        "bundle_manifest_sha256": _hash_file(directory / "manifest.json"),
        "verified_regions": len(manifest["regions"]),
        "verified_bytes": verified,
        "physical_write": False,
        "physical_write_authorized": False,
        "writer_lock_held": False,
        "activation_performed": False,
    }
