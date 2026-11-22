#!/usr/bin/env python3
"""Read-only Owner DEV ext4 USB inspection using the verified OrdaX kernel.

Only the selected ext4 partition is exposed to QEMU as readonly=on. The guest
mounts ro,noload and never touches the Windows disk writer or EFI partition.
This is a physical-media preflight, NOT an installation or update executor.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = HERE / "owner_dev_qemu_filesystem_proof.py"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
SERIAL = re.compile(r"[A-Za-z0-9_-]{4,64}\Z")
SCHEMA = "ordax.creator.owner-dev-ext4-physical-readonly/1"
GUEST_MARKER = "ORDAX_OWNER_EXT4_READONLY_OK"
GUEST_UNMOUNT = "ORDAX_OWNER_EXT4_READONLY_UNMOUNT_OK"


class ReadonlyProbeError(RuntimeError):
    pass


def proof_owner():
    spec = importlib.util.spec_from_file_location("ordax_qemu_owner", SOURCE)
    if not spec or not spec.loader:
        raise ReadonlyProbeError("canonical QEMU guest helper unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def inventory(disk_number: int) -> dict:
    if type(disk_number) is not int or not 0 <= disk_number <= 999:
        raise ReadonlyProbeError("physical disk number is invalid")
    script = (
        "$ErrorActionPreference='Stop';"
        f"$disk=Get-Disk -Number {disk_number};"
        f"$parts=@(Get-Partition -DiskNumber {disk_number} | Sort-Object PartitionNumber);"
        "[pscustomobject]@{"
        "Number=[int]$disk.Number;Serial=([string]$disk.SerialNumber).Trim();"
        "BusType=[string]$disk.BusType;IsBoot=[bool]$disk.IsBoot;"
        "IsSystem=[bool]$disk.IsSystem;Size=[long]$disk.Size;"
        "Partitions=@($parts|ForEach-Object{[pscustomobject]@{"
        "Number=[int]$_.PartitionNumber;Letter=[string]$_.DriveLetter;"
        "Type=[string]$_.Type;Offset=[long]$_.Offset;Size=[long]$_.Size}})"
        "}|ConvertTo-Json -Compress -Depth 5"
    )
    try:
        response = subprocess.run(
            ["powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script],
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
            stderr=subprocess.PIPE, timeout=25, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ReadonlyProbeError("Windows physical inventory failed") from exc
    if response.returncode or len(response.stdout) > 64 * 1024:
        raise ReadonlyProbeError("Windows physical inventory is unavailable")
    try:
        return json.loads(response.stdout.decode("utf-8-sig"))
    except (ValueError, UnicodeError) as exc:
        raise ReadonlyProbeError("Windows physical inventory is malformed") from exc


def confirmed_volume(snapshot: dict, disk_number: int, serial: str) -> str:
    if not SERIAL.fullmatch(serial):
        raise ReadonlyProbeError("authorized USB serial is invalid")
    if (type(snapshot) is not dict or snapshot.get("Number") != disk_number
            or str(snapshot.get("Serial", "")).upper() != serial.upper()
            or str(snapshot.get("BusType", "")).upper() != "USB"
            or snapshot.get("IsBoot") is not False
            or snapshot.get("IsSystem") is not False):
        raise ReadonlyProbeError("target is not the authorized removable USB")
    if type(snapshot.get("Size")) is not int or snapshot["Size"] <= 0:
        raise ReadonlyProbeError("physical disk size is invalid")
    parts = snapshot.get("Partitions")
    if not isinstance(parts, list) or len(parts) != 3:
        raise ReadonlyProbeError("Owner DEV requires exact three-partition layout")
    first, linux, data = parts
    if ([item.get("Number") for item in parts] != [1, 2, 3]
            or first.get("Type") != "System"
            or linux.get("Type") != "Unknown"
            or data.get("Type") != "Basic"):
        raise ReadonlyProbeError("Owner DEV partition ownership differs")
    for member in parts:
        if not (type(member.get("Offset")) is int and member["Offset"] >= 0
                and type(member.get("Size")) is int and member["Size"] > 0):
            raise ReadonlyProbeError("partition offsets and sizes are invalid")
    if (first["Offset"] + first["Size"] > linux["Offset"] or
            linux["Offset"] + linux["Size"] > data["Offset"] or
            data["Offset"] + data["Size"] > snapshot.get("Size", 0)):
        raise ReadonlyProbeError("physical partitions overlap or exceed disk")
    letter = linux.get("Letter")
    if (not isinstance(letter, str) or len(letter) != 1
            or not letter.isalpha() or letter.upper() in {"A", "B", "C"}
            or data.get("Letter", "").upper() == letter.upper()):
        raise ReadonlyProbeError("Linux partition has no safe unique drive letter")
    if linux["Size"] < 512 * 1024 * 1024:
        raise ReadonlyProbeError("Owner DEV Linux filesystem is too small")
    return letter.upper()


def verify_superblock(letter: str) -> None:
    volume = r"\\.\ "[:-1] + letter + ":"
    try:
        with open(volume, "rb", buffering=0) as source:
            source.seek(1024)
            block = source.read(1024)
    except OSError as exc:
        raise ReadonlyProbeError("cannot open the selected Linux volume read-only") from exc
    if len(block) != 1024 or block[56:58] != b"\x53\xef":
        raise ReadonlyProbeError("selected volume has no ext-family superblock")


def guest_script() -> str:
    return """#!/bin/busybox sh
set -eu
/bin/busybox mount -t proc proc /proc
/bin/busybox mount -t devtmpfs devtmpfs /dev
/bin/busybox mount -t ext4 -o ro,noload /dev/vda /mnt
/bin/busybox echo ORDAX_OWNER_EXT4_READONLY_OK
/bin/busybox cat /proc/mounts
/bin/busybox umount /mnt
/bin/busybox echo ORDAX_OWNER_EXT4_READONLY_UNMOUNT_OK
/bin/busybox poweroff -f
"""


def probe(base: Path, qemu: Path, *, disk_number: int, serial: str,
          requested_commit: str, git_bin: str = "git", awk_bin: str = "awk") -> dict:
    before = inventory(disk_number)
    letter = confirmed_volume(before, disk_number, serial)
    verify_superblock(letter)
    helper = proof_owner()
    if not HEX40.fullmatch(base.name) or base.is_symlink() or not base.is_dir():
        raise ReadonlyProbeError("Base is not an exact-commit directory")
    channel = helper.channel_owner()
    if not HEX40.fullmatch(requested_commit):
        raise ReadonlyProbeError("requested canonical Git revision is invalid")
    try:
        manifest = channel.verify_materialized(base, base.name)
        published_commit, published_manifest = channel.resolve_published_source(
            requested_commit, ROOT, git_bin=git_bin, awk_bin=awk_bin,
        )
    except channel.DevBaseChannelError as exc:
        raise ReadonlyProbeError("canonical Base authority rejected candidate") from exc
    if (published_commit != base.name or
            published_manifest != (base / "dev-base.json").read_bytes()):
        raise ReadonlyProbeError("Base does not match compatible published Git authority")
    try:
        with tarfile.open(base / "rootfs.tar", "r:") as archive:
            busybox = archive.extractfile("bin/busybox").read()
    except (KeyError, AttributeError, OSError, tarfile.TarError) as exc:
        raise ReadonlyProbeError("canonical Base BusyBox could not be read") from exc
    guest = helper.ramdisk(busybox, guest_script())
    with tempfile.TemporaryDirectory(prefix="ordax-owner-usb-ro-") as temp:
        initrd = Path(temp) / "readonly.cpio.gz"
        initrd.write_bytes(guest)
        if inventory(disk_number) != before:
            raise ReadonlyProbeError("USB target changed before QEMU read-only mount")
        if qemu.is_symlink() or not qemu.is_file():
            raise ReadonlyProbeError("QEMU executable is invalid")
        volume = r"\\.\ "[:-1] + letter + ":"
        command = [
            str(qemu), "-nodefaults", "-no-reboot", "-nographic",
            "-accel", "tcg", "-m", "384M", "-smp", "1",
            "-serial", "stdio", "-monitor", "none", "-net", "none",
            "-kernel", str(base / "vmlinuz"), "-initrd", str(initrd),
            "-drive", f"file={volume},format=raw,if=virtio,readonly=on",
            "-append", "console=ttyS0 rdinit=/init loglevel=7 earlyprintk=serial,ttyS0 panic=1",
        ]
        try:
            result = subprocess.run(
                command, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT, timeout=95, check=False,
            )
        except subprocess.TimeoutExpired as exc:
            output = exc.stdout or b""
            if isinstance(output, str):
                output = output.encode("utf-8", "replace")
            tail = output[-1800:].decode("utf-8", "replace")
            raise ReadonlyProbeError(
                "QEMU ext4 read-only proof timed out without completion marker; "
                + "guest output tail: " + (tail or "<no guest output>")
            ) from exc
        except OSError as exc:
            raise ReadonlyProbeError("QEMU could not launch read-only ext4 proof") from exc
    log = result.stdout.decode("utf-8", errors="replace")
    if result.returncode or GUEST_MARKER not in log or GUEST_UNMOUNT not in log:
        raise ReadonlyProbeError("Linux ext4 read-only mount evidence missing: " + log[-800:])
    lines = [line.strip() for line in log.splitlines()]
    if not any(line.startswith("/dev/vda /mnt ext4 ro,") and
               "norecovery" in line for line in lines):
        raise ReadonlyProbeError("Linux did not attest ro,noload ext4 mount")
    if inventory(disk_number) != before:
        raise ReadonlyProbeError("USB identity changed after QEMU inspection")
    return {"$schema": SCHEMA, "status": "pass",
            "disk_number": disk_number, "usb_serial": serial.upper(),
            "partition_number": 2, "volume_letter": letter,
            "base_source_commit": base.name,
            "requested_source_commit": requested_commit,
            "canonical_published_base_verified": True,
            "kernel_sha256": manifest["kernel"]["sha256"],
            "read_only_mount": "ext4-ro-noload",
            "linux_unmount_verified": True,
            "physical_usb_write": False,
            "physical_write_authorized": False,
            "activation_performed": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verified-base-dir", type=Path, required=True)
    parser.add_argument("--qemu-bin", type=Path, required=True)
    parser.add_argument("--trusted-serial", required=True)
    parser.add_argument("--trusted-disk-number", type=int, required=True)
    parser.add_argument("--requested-source-commit", required=True)
    parser.add_argument("--git-bin", default="git")
    parser.add_argument("--awk-bin", default="awk")
    args = parser.parse_args()
    try:
        result = probe(args.verified_base_dir, args.qemu_bin,
                       disk_number=args.trusted_disk_number, serial=args.trusted_serial,
                       requested_commit=args.requested_source_commit,
                       git_bin=args.git_bin, awk_bin=args.awk_bin)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except (ReadonlyProbeError, OSError, ValueError, tarfile.TarError) as exc:
        print("ordax-owner-ext4-readonly: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
