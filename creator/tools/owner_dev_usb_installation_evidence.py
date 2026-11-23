#!/usr/bin/env python3
"""Independent read-only physical state vs staged Git transport evidence.

Never claims successful OS installation. Only boot health and active runtime
identity can authorize that outcome, which this Windows tool cannot observe.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys

import owner_dev_qemu_partition_readonly as physical
import owner_usb_git_delivery as delivery

SCHEMA = "ordax.creator.owner-usb-installation-evidence/1"
SHA = re.compile(r"[a-f0-9]{40}\Z")


class InstallationEvidenceError(RuntimeError):
    pass


def report(usb: dict, staged: tuple[str, str, int] | None) -> dict:
    if (usb.get("status") != "pass"
            or usb.get("physical_usb_write") is not False
            or usb.get("read_only_mount") != "ext4-ro-noload"
            or usb.get("physical_boot_verified") is not False
            or usb.get("running_revision_verified") is not False):
        raise InstallationEvidenceError("physical read-only evidence was not verified")
    state = usb.get("on_disk_state_commit")
    if state is not None and (not isinstance(state, str) or not SHA.fullmatch(state)):
        raise InstallationEvidenceError("physical disk state marker is malformed")
    if staged is not None:
        if (len(staged) != 3 or not isinstance(staged[0], str)
                or not SHA.fullmatch(staged[0])):
            raise InstallationEvidenceError("transported Git source identity invalid")
    transported = staged[0] if staged else None
    if transported is None:
        status = "GIT_TRANSPORT_ABSENT"
    elif state is None:
        status = "DISK_STATE_UNVERIFIED"
    elif state != transported:
        status = "DISK_STATE_DIFFERS_FROM_STAGED_GIT"
    else:
        status = "DISK_STATE_MATCHES_STAGED_GIT_BOOT_UNVERIFIED"
    return {
        "$schema": SCHEMA,
        "status": status,
        "usb_serial": usb["usb_serial"],
        "disk_number": usb["disk_number"],
        "linux_partition_number": usb["partition_number"],
        "staged_git_source_commit": transported,
        "on_disk_state_commit": state,
        "on_disk_git_main_commit": usb.get("on_disk_git_main_commit"),
        "on_disk_revision_consistent": usb.get("on_disk_revision_consistent") is True,
        "installed_source_commit": None,
        "os_activation_verified": False,
        "physical_boot_verified": False,
        "running_revision_verified": False,
        "physical_usb_write": False,
        "result_is_not_installation_proof": True,
    }


def inspect(base: Path, qemu: Path, *, disk_number: int, serial: str) -> dict:
    before = physical.inventory(disk_number)
    physical.confirmed_volume(before, disk_number, serial)
    data = before["Partitions"][2]
    letter = data.get("Letter", "")
    if (not isinstance(letter, str) or len(letter) != 1
            or not letter.isascii() or not letter.isalpha()
            or letter.upper() in ("A", "B", "C", before["Partitions"][1]["Letter"].upper())):
        raise InstallationEvidenceError("authorized ORDAX-DATA has no unique drive letter")
    letter = letter.upper()
    expected = delivery.checked_volume(letter)
    if (expected.get("disk") != disk_number
            or str(expected.get("serial", "")).upper() != serial.upper()
            or expected.get("partition") != 3
            or expected.get("label") != "ORDAX-DATA"
            or expected.get("fs") != "exFAT"):
        raise InstallationEvidenceError("ORDAX-DATA does not belong to the selected USB")
    usb = physical.probe(
        base, qemu, disk_number=disk_number, serial=serial,
        requested_commit=base.name,
    )
    target = Path(letter + ":\\") / delivery.SUBDIR
    try:
        staged = delivery.verified_local_bundle(target)
    except delivery.DeliveryError as exc:
        raise InstallationEvidenceError("staged Git transport cannot be verified") from exc
    if physical.inventory(disk_number) != before:
        raise InstallationEvidenceError("USB changed after physical inspection")
    if delivery.checked_volume(letter) != expected:
        raise InstallationEvidenceError("ORDAX-DATA changed during verification")
    return report(usb, staged)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verified-base-dir", type=Path, required=True)
    parser.add_argument("--qemu-bin", type=Path, required=True)
    parser.add_argument("--trusted-serial", required=True)
    parser.add_argument("--trusted-disk-number", type=int, required=True)
    args = parser.parse_args()
    try:
        proof = inspect(args.verified_base_dir, args.qemu_bin,
                        disk_number=args.trusted_disk_number,
                        serial=args.trusted_serial)
    except (InstallationEvidenceError, physical.ReadonlyProbeError,
            ValueError, OSError) as exc:
        print("ordax-owner-usb-installation-evidence: " + str(exc), file=sys.stderr)
        return 1
    print(json.dumps(proof, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
