#!/usr/bin/env python3
"""Owner DEV Windows USB update preflight using OS-owned published Base and QEMU.

This is a discovery/proof adapter, not another Update Engine and not an updater.
It cannot write to the physical USB or claim an installed/activated revision.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

from owner_dev_qemu_partition_readonly import (
    ReadonlyProbeError, confirmed_volume, inventory, verify_superblock,
)
from owner_dev_qemu_partition_snapshot import SnapshotProofError, prove

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
CHANNEL_PATH = ROOT / "system/services/base-update/dev_channel.py"
SCHEMA = "ordax.owner-dev-usb-update-preflight/1"
COMMIT = re.compile(r"[a-f0-9]{40}\Z")
QEMU_ROOT = Path(r"C:\Program Files\qemu")
GIT_EXE = Path(r"C:\Program Files\Git\cmd\git.exe")
AWK_EXE = Path(r"C:\Program Files\Git\usr\bin\awk.exe")


class USBUpdatePreflightError(RuntimeError):
    pass


def _real_regular(path: Path) -> bool:
    return (not path.is_symlink()
            and not getattr(path, "is_junction", lambda: False)()
            and path.is_file())


def _real_directory(path: Path) -> bool:
    return (not path.is_symlink()
            and not getattr(path, "is_junction", lambda: False)()
            and path.is_dir())


def _git(*args: str) -> str:
    if not _real_regular(GIT_EXE):
        raise USBUpdatePreflightError("canonical Windows Git unavailable")
    try:
        proc = subprocess.run([str(GIT_EXE), "-C", str(ROOT), *args],
                              stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                              stderr=subprocess.PIPE, timeout=25, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise USBUpdatePreflightError("OS Git authority unavailable") from exc
    if proc.returncode or len(proc.stdout) > 4096:
        raise USBUpdatePreflightError("OS Git authority rejected request")
    return proc.stdout.decode("utf-8", "strict").strip()


def _current_source() -> str:
    if not _real_directory(ROOT) or not _real_regular(CHANNEL_PATH):
        raise USBUpdatePreflightError("canonical OS source is missing")
    if _git("branch", "--show-current") != "main":
        raise USBUpdatePreflightError("update preflight requires ordax-os/main")
    if _git("remote", "get-url", "origin") not in {
        "https://github.com/ordaxsystems/ordax-os.git",
        "https://github.com/ordaxsystems/ordax-os",
        "git@github.com:ordaxsystems/ordax-os.git",
    }:
        raise USBUpdatePreflightError("source is not the canonical OS Git origin")
    commit = _git("rev-parse", "HEAD")
    if not COMMIT.fullmatch(commit):
        raise USBUpdatePreflightError("OS Git revision invalid")
    return commit


def _channel():
    spec = importlib.util.spec_from_file_location("ordax_usb_update_channel", CHANNEL_PATH)
    if spec is None or spec.loader is None:
        raise USBUpdatePreflightError("OS Base channel loader unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _load_bundle():
    spec = importlib.util.spec_from_file_location(
        "ordax_owner_usb_delta_bundle", HERE / "owner_dev_qemu_delta_bundle.py",
    )
    if spec is None or spec.loader is None:
        raise USBUpdatePreflightError("canonical local delta bundle owner unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _data_volume_letter(before: dict) -> str:
    parts = before["Partitions"]
    letter = parts[2]["Letter"]
    if not isinstance(letter, str) or not re.fullmatch("[D-Z]", letter.upper()):
        raise USBUpdatePreflightError("OrdaX data partition is not mounted safely")
    if letter.upper() == parts[1]["Letter"].upper():
        raise USBUpdatePreflightError("USB Linux and data volumes overlap")
    return letter.upper()


def _verify_data_label(letter: str) -> None:
    if not re.fullmatch("[D-Z]", letter):
        raise USBUpdatePreflightError("invalid Owner DEV data drive")
    command = (
        "$ErrorActionPreference='Stop';"
        f"$v=Get-Volume -DriveLetter {letter} -ErrorAction Stop;"
        "[pscustomobject]@{label=[string]$v.FileSystemLabel;"
        "filesystem=[string]$v.FileSystem}|ConvertTo-Json -Compress"
    )
    try:
        result = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", command],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=15, check=False,
        )
        if result.returncode or len(result.stdout) > 4096:
            raise USBUpdatePreflightError("USB data volume metadata not readable")
        data = json.loads(result.stdout.decode("utf-8-sig"))
    except (OSError, subprocess.TimeoutExpired, UnicodeError, ValueError) as exc:
        raise USBUpdatePreflightError("USB data label check unavailable") from exc
    if (not isinstance(data, dict)
            or data.get("label") != "ORDAX-DATA"
            or str(data.get("filesystem", "")).lower() != "exfat"):
        raise USBUpdatePreflightError("USB data volume does not match Owner DEV")


def _base_directory(letter: str, commit: str) -> Path:
    # Never accept an arbitrary host path or model-selected image.
    parent = Path(letter + r":\.ordax\updates\owner-base")
    base = parent / commit
    for path in (parent.parent.parent.parent, parent.parent.parent,
                 parent.parent, parent, base):
        if not _real_directory(path):
            raise USBUpdatePreflightError("USB Base cache path is missing or linked")
    for name in ("dev-base.json", "vmlinuz", "initrd.gz", "rootfs.tar"):
        if not _real_regular(base / name):
            raise USBUpdatePreflightError("USB cached Base artifact missing or linked")
    return base


def preflight(disk_number: int, serial: str, *, progress=None,
              prepare_host_bundle: bool = False,
              reuse_host_bundle: bool = False) -> dict:
    def report(phase: str) -> None:
        if progress is not None:
            progress(phase)

    report("physical-target-inventory")
    if prepare_host_bundle and reuse_host_bundle:
        raise USBUpdatePreflightError("host bundle creation and reuse are exclusive")
    if os.name != "nt":
        raise USBUpdatePreflightError("physical USB preflight requires native Windows")
    before = inventory(disk_number)
    letter = confirmed_volume(before, disk_number, serial)
    verify_superblock(letter)
    data_letter = _data_volume_letter(before)
    _verify_data_label(data_letter)
    qemu, qemu_img = (QEMU_ROOT / "qemu-system-x86_64.exe",
                      QEMU_ROOT / "qemu-img.exe")
    if not _real_regular(AWK_EXE):
        raise USBUpdatePreflightError("canonical Git AWK policy unavailable")
    if not reuse_host_bundle and (
        not _real_directory(QEMU_ROOT)
        or not _real_regular(qemu) or not _real_regular(qemu_img)
    ):
        raise USBUpdatePreflightError("verified Windows QEMU unavailable")

    report("resolving-published-base")
    source = _current_source()
    channel = _channel()
    try:
        compatible, published = channel.resolve_published_source(
            source, ROOT, git_bin=str(GIT_EXE), awk_bin=str(AWK_EXE),
        )
    except channel.DevBaseChannelError as exc:
        raise USBUpdatePreflightError("no compatible published Base for current main") from exc
    if not COMMIT.fullmatch(compatible):
        raise USBUpdatePreflightError("published Base revision is invalid")
    base = _base_directory(data_letter, compatible)
    if (base / "dev-base.json").read_bytes() != published:
        raise USBUpdatePreflightError("USB cached Base manifest differs from publisher")
    try:
        channel.verify_materialized(base, compatible)
    except channel.DevBaseChannelError as exc:
        raise USBUpdatePreflightError("USB Base integrity verification failed") from exc
    if inventory(disk_number) != before:
        raise USBUpdatePreflightError("physical target changed before guest proof")
    report("published-base-verified")
    if reuse_host_bundle:
        bundle_owner = _load_bundle()
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if not local_appdata:
            raise USBUpdatePreflightError("canonical local candidate cache missing")
        cache = Path(local_appdata) / "OrdaX" / "updates" / "creator" / "dev-delta"
        if not _real_directory(cache):
            raise USBUpdatePreflightError("canonical local candidate cache missing or linked")
        expected_target = {
            "disk_number": disk_number, "usb_serial": serial.upper(),
            "physical_size_bytes": before["Size"], "partition_number": 2,
            "partition_offset_bytes": before["Partitions"][1]["Offset"],
            "partition_bytes": before["Partitions"][1]["Size"],
        }
        found = False
        for directory in sorted(cache.iterdir(), key=lambda item: item.name):
            if ("-" + serial.upper() + "-") not in directory.name:
                continue
            if not _real_directory(directory):
                raise USBUpdatePreflightError("cached candidate is linked or missing")
            found = True
            try:
                manifest = bundle_owner.verify_bundle(directory)
            except (bundle_owner.DeltaBundleError, OSError) as exc:
                raise USBUpdatePreflightError("cached candidate integrity failed") from exc
            if (manifest.get("published_base_source_commit") != compatible
                    or manifest.get("target") != expected_target):
                continue
            try:
                compatible_main = channel.prove_compatible_source(
                    ROOT, manifest["requested_main_commit"], source,
                    git_bin=str(GIT_EXE), awk_bin=str(AWK_EXE),
                )
            except channel.DevBaseChannelError as exc:
                raise USBUpdatePreflightError("cached source compatibility could not be proved") from exc
            if not compatible_main:
                continue
            report("rechecking-current-usb-preimages")
            try:
                previous = bundle_owner.verify_physical_preimages(
                    directory, volume=r"\\.\ "[:-1] + letter + ":",
                    disk_number=disk_number, serial=serial,
                    disk_bytes=before["Size"],
                    partition_offset=before["Partitions"][1]["Offset"],
                    partition_bytes=before["Partitions"][1]["Size"],
                )
            except (bundle_owner.DeltaBundleError, OSError) as exc:
                raise USBUpdatePreflightError("cached candidate is stale or USB preimage changed") from exc
            if inventory(disk_number) != before:
                raise USBUpdatePreflightError("USB changed during cached preimage verification")
            _verify_data_label(data_letter)
            report("cached-candidate-revalidated")
            return {
                "$schema": SCHEMA, "status": "verified-cached-host-delta-preimages",
                "disk_number": disk_number, "usb_serial": serial.upper(),
                "requested_main_commit": source,
                "cached_source_commit": manifest["requested_main_commit"],
                "published_base_source_commit": compatible,
                "current_source_compatibility_proven": True,
                "bundle_path": str(directory),
                "bundle_manifest_sha256": previous["bundle_manifest_sha256"],
                "verified_regions": previous["verified_regions"],
                "verified_bytes": previous["verified_bytes"],
                "physical_write": False, "physical_write_authorized": False,
                "writer_lock_held": False, "installed_revision_proven": False,
                "purpose": "filesystem-proof-only",
                "installable_candidate": False,
                "canonical_inactive_slot_staged": False,
                "activation_performed": False,
                "next_gate": "os-canonical-offline-rootfs-and-inactive-esp-stage-proof",
            }
        raise USBUpdatePreflightError(
            "no compatible cached delta for current authorized USB"
            if found else "no cached delta for this authorized USB"
        )

    try:
        evidence = prove(base, qemu, qemu_img, disk_number=disk_number,
                         serial=serial, requested_commit=source,
                         git_bin=str(GIT_EXE), awk_bin=str(AWK_EXE),
                         progress=progress,
                         prepare_host_bundle=prepare_host_bundle)
    except (ReadonlyProbeError, SnapshotProofError) as exc:
        raise USBUpdatePreflightError("QEMU physical media proof failed: " + str(exc)) from exc
    if (evidence.get("status") != "pass"
            or evidence.get("physical_usb_write") is not False
            or evidence.get("physical_write_authorized") is not False
            or evidence.get("source_commit") != compatible
            or evidence.get("requested_source_commit") != source
            or evidence.get("usb_serial") != serial.upper()
            or evidence.get("disk_number") != disk_number
            or evidence.get("guest_stage_verified") is not True
            or evidence.get("cold_readback_verified") is not True
            or evidence.get("physical_absence_verified") is not True
            or evidence.get("physical_sample_sha256_unchanged") is not True
            or evidence.get("purpose") != "filesystem-proof-only"
            or evidence.get("installable_candidate") is not False
            or evidence.get("canonical_inactive_slot_staged") is not False
            or evidence.get("cow_physical_preimages_hashed") is not True
            or evidence.get("cow_postimages_hashed") is not True
            or type(evidence.get("cow_modified_bytes")) is not int
            or evidence["cow_modified_bytes"] <= 0
            or type(evidence.get("cow_modified_regions")) is not int
            or evidence["cow_modified_regions"] <= 0
            or not re.fullmatch("[a-f0-9]{64}",
                                str(evidence.get("cow_delta_plan_sha256", "")))):
        raise USBUpdatePreflightError("QEMU proof did not bind the requested USB/Base")

    if prepare_host_bundle:
        bundle = evidence.get("host_delta_bundle")
        if (not isinstance(bundle, dict)
                or bundle.get("physical_write") is not False
                or bundle.get("physical_write_authorized") is not False
                or bundle.get("cow_plan_sha256") != evidence["cow_delta_plan_sha256"]
                or bundle.get("requested_main_commit") != source
                or bundle.get("usb_serial") != serial.upper()
                or bundle.get("region_count") != evidence["cow_modified_regions"]
                or bundle.get("payload_bytes") != evidence["cow_modified_bytes"]
                or not re.fullmatch("[0-9a-f]{64}",
                                    str(bundle.get("manifest_sha256", "")))):
            raise USBUpdatePreflightError("local delta bundle disagrees with physical QEMU proof")
        local_appdata = os.environ.get("LOCALAPPDATA", "")
        if not local_appdata:
            raise USBUpdatePreflightError("Windows candidate cache root unavailable")
        local_root = Path(local_appdata) / "OrdaX" / "updates" / "creator" / "dev-delta"
        candidate_dir = Path(str(bundle["bundle_path"]))
        if candidate_dir.parent.resolve() != local_root.resolve() or candidate_dir.is_symlink():
            raise USBUpdatePreflightError("local delta path escapes the Owner cache")
        bundle_owner = _load_bundle()
        try:
            verified = bundle_owner.verify_bundle(candidate_dir)
        except (bundle_owner.DeltaBundleError, OSError) as exc:
            raise USBUpdatePreflightError("local delta package readback failed") from exc
        if (verified.get("cow_plan_sha256") != bundle["cow_plan_sha256"]
                or verified.get("requested_main_commit") != source
                or verified.get("target", {}).get("usb_serial") != serial.upper()
                or bundle_owner._hash_file(candidate_dir / "manifest.json")
                   != bundle["manifest_sha256"]):
            raise USBUpdatePreflightError("local delta package provenance disagrees")
    if inventory(disk_number) != before:
        raise USBUpdatePreflightError("USB identity changed after guest proof")
    _verify_data_label(data_letter)
    report("physical-media-unchanged")
    return {
        "$schema": SCHEMA,
        "status": "verified-offline-candidate-feasibility",
        **({"host_delta_bundle": evidence["host_delta_bundle"]}
           if prepare_host_bundle else {}),
        "disk_number": disk_number, "usb_serial": serial.upper(),
        "physical_size_bytes": before["Size"],
        "linux_partition_number": 2, "linux_volume_letter": letter,
        "data_volume_letter": data_letter,
        "requested_main_commit": source, "published_base_source_commit": compatible,
        "published_manifest_verified": True,
        "rootfs_cow_stage_verified": True, "rootfs_cold_readback_verified": True,
        "original_media_sample_unchanged": True,
        "cow_delta_regions": evidence["cow_modified_regions"],
        "cow_delta_bytes": evidence["cow_modified_bytes"],
        "cow_delta_plan_sha256": evidence["cow_delta_plan_sha256"],
        "physical_preimages_hashed": True,
        "prepared_postimages_hashed": True,
        "purpose": "filesystem-proof-only",
        "canonical_versioned_rootfs_materialized": False,
        "canonical_inactive_slot_staged": False,
        "installable_candidate": False,
        "physical_write_authorized": False,
        "physical_write": False, "update_executed": False,
        "installed_revision_proven": False, "activation_performed": False,
        "next_gate": "os-canonical-offline-rootfs-and-inactive-esp-stage-proof",
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--disk-number", required=True, type=int)
    parser.add_argument("--serial", required=True)
    parser.add_argument("--prepare-host-bundle", action="store_true",
                        help="stage local verified data only; never write physical USB")
    parser.add_argument("--reuse-host-bundle", action="store_true",
                        help="verify local candidate and current USB preimages without QEMU")
    args = parser.parse_args()
    try:
        def report(phase: str) -> None:
            print("ordax-owner-usb-update-preflight: phase=" + phase,
                  file=sys.stderr, flush=True)

        result = preflight(args.disk_number, args.serial, progress=report,
                           prepare_host_bundle=args.prepare_host_bundle,
                           reuse_host_bundle=args.reuse_host_bundle)
        print(json.dumps(result, sort_keys=True), flush=True)
        return 0
    except (USBUpdatePreflightError, ReadonlyProbeError, ValueError, OSError,
            UnicodeError) as exc:
        print("ordax-owner-usb-update-preflight: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
