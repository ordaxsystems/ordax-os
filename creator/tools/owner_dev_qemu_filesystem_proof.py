#!/usr/bin/env python3
"""Prove Owner DEV Linux filesystem access in disposable QEMU files only.

Canonical OS dev_channel validates the Base and tar; no installer, physical
disk, USB partition, boot selection, or update policy is implemented here.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CHANNEL = ROOT / "system/services/base-update/dev_channel.py"
SCHEMA = "ordax.creator.owner-dev-disposable-filesystem-proof/1"
HEX40 = re.compile(r"[0-9a-f]{40}\Z")
MIB = 1024 * 1024
SCRATCH_BYTES = 512 * MIB


class ProofError(RuntimeError):
    pass


def channel_owner():
    spec = importlib.util.spec_from_file_location("ordax_disposable_channel", CHANNEL)
    if not spec or not spec.loader:
        raise ProofError("canonical Base validator missing")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def cpio_member(name: str, mode: int, data: bytes, index: int) -> bytes:
    if not name or not name.isascii() or "\x00" in name or len(name) > 1024:
        raise ProofError("invalid CPIO member")
    encoded = name.encode("ascii") + b"\0"
    fields = (index, mode, 0, 0, 1, 0, len(data), 0, 0, 0, 0, len(encoded), 0)
    result = b"070701" + b"".join(f"{value:08x}".encode() for value in fields)
    result += encoded
    result += b"\0" * (-len(result) % 4)
    result += data
    return result + b"\0" * (-len(result) % 4)


def ramdisk(busybox: bytes, script: str) -> bytes:
    if len(busybox) > 8 * MIB or not busybox.startswith(b"\x7fELF"):
        raise ProofError("invalid static BusyBox from Base")
    entries = [("bin", 0o040755, b""), ("dev", 0o040755, b""),
               ("proc", 0o040755, b""), ("sys", 0o040755, b""),
               ("mnt", 0o040755, b""), ("bin/busybox", 0o100755, busybox),
               ("init", 0o100755, script.encode("ascii")),
               ("TRAILER!!!", 0, b"")]
    payload = b"".join(cpio_member(n, m, v, i) for i, (n, m, v)
                       in enumerate(entries, 1))
    return gzip.compress(payload, compresslevel=6, mtime=0)


def guest_script(commit: str, verify: bool) -> str:
    if not HEX40.fullmatch(commit):
        raise ProofError("invalid source commit")
    prefix = ("#!/bin/busybox sh\nset -eu\n"
              "/bin/busybox mount -t proc proc /proc\n"
              "/bin/busybox mount -t devtmpfs devtmpfs /dev\n")
    version = f"/mnt/versions/{commit}"
    if verify:
        work = ("/bin/busybox mount -t ext4 -o ro /dev/vda /mnt\n"
                f"/bin/busybox cat {version}/.ordax-base/source-commit\n"
                f"/bin/busybox sha256sum {version}/bin/busybox\n"
                "/bin/busybox umount /mnt\n"
                f"/bin/busybox echo ORDAX_READBACK_OK_{commit}\n")
    else:
        work = ("/bin/busybox mke2fs -F -L ORDAX-PROOF /dev/vda >/dev/console 2>&1\n"
                "/bin/busybox mount -t ext4 /dev/vda /mnt\n"
                f"/bin/busybox mkdir -p {version}\n"
                f"/bin/busybox tar -xpf /dev/vdb -C {version}\n"
                f"/bin/busybox mkdir -p {version}/.ordax-base\n"
                f"/bin/busybox echo {commit} > {version}/.ordax-base/source-commit\n"
                f"/bin/busybox sha256sum {version}/bin/busybox\n"
                "/bin/busybox sync\n"
                "/bin/busybox umount /mnt\n"
                f"/bin/busybox echo ORDAX_STAGE_OK_{commit}\n")
    return prefix + work + "/bin/busybox poweroff -f\n"


def copy_verified(source: Path, destination: Path, binding: dict) -> None:
    digest = hashlib.sha256()
    count = 0
    with source.open("rb") as reader, destination.open("xb") as writer:
        while chunk := reader.read(MIB):
            count += len(chunk)
            digest.update(chunk)
            writer.write(chunk)
    if count != binding["size"] or digest.hexdigest() != binding["sha256"]:
        raise ProofError("Base bytes changed during temporary snapshot")


def boot(qemu: Path, kernel: Path, initrd: Path, scratch: Path,
         *, payload: Path | None = None) -> str:
    files = [qemu, kernel, initrd, scratch]
    if payload:
        files.append(payload)
    if any(f.is_symlink() or not f.is_file() for f in files):
        raise ProofError("QEMU inputs must be regular non-linked files")
    argv = [str(qemu), "-nodefaults", "-no-reboot", "-nographic",
            "-accel", "tcg", "-m", "384M", "-smp", "1",
            "-serial", "stdio", "-monitor", "none",
            "-kernel", str(kernel), "-initrd", str(initrd),
            "-drive", f"file={scratch},format=raw,if=virtio",
            "-append", "console=ttyS0 rdinit=/init loglevel=3 panic=1"]
    if payload:
        argv += ["-drive", f"file={payload},format=raw,if=virtio,readonly=on"]
    try:
        process = subprocess.run(argv, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 timeout=180, check=False)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise ProofError("disposable QEMU invocation failed") from exc
    output = process.stdout.decode("utf-8", "replace")
    if process.returncode:
        raise ProofError("disposable QEMU failed: " + output[-1500:])
    return output


def prove(base: Path, qemu: Path) -> dict:
    if not HEX40.fullmatch(base.name) or base.is_symlink() or not base.is_dir():
        raise ProofError("Base requires an exact-commit real directory")
    owner = channel_owner()
    manifest = owner.verify_materialized(base, base.name)
    owner._validate_rootfs_archive(base / "rootfs.tar")
    with tarfile.open(base / "rootfs.tar", "r:") as tar:
        member = tar.getmember("bin/busybox")
        if not member.isreg() or member.mode & 0o111 == 0:
            raise ProofError("Base BusyBox invalid")
        busybox = tar.extractfile(member).read()
    digest = hashlib.sha256(busybox).hexdigest()
    with tempfile.TemporaryDirectory(prefix="ordax-qemu-disposable-") as tmp:
        temp = Path(tmp)
        payload = temp / "rootfs.tar"
        kernel = temp / "vmlinuz"
        copy_verified(base / "rootfs.tar", payload, manifest["rootfs"])
        copy_verified(base / "vmlinuz", kernel, manifest["kernel"])
        scratch = temp / "scratch.raw"
        with scratch.open("xb") as output:
            output.truncate(SCRATCH_BYTES)
        for verify in (False, True):
            rd = temp / ("readback.cpio.gz" if verify else "stage.cpio.gz")
            rd.write_bytes(ramdisk(busybox, guest_script(base.name, verify)))
            result = boot(qemu, kernel, rd, scratch,
                          payload=None if verify else payload)
            marker = ("ORDAX_READBACK_OK_" if verify else "ORDAX_STAGE_OK_") + base.name
            if marker not in result or digest not in result:
                raise ProofError("QEMU stage/readback evidence missing: " + result[-1500:])
    return {"$schema": SCHEMA, "status": "pass",
            "base_source_commit": base.name,
            "kernel_sha256": manifest["kernel"]["sha256"],
            "rootfs_sha256": manifest["rootfs"]["sha256"],
            "busybox_readback_sha256": digest,
            "stage_verified": True, "cold_readback_verified": True,
            "scratch_filesystem": "ext2-fixture-mounted-with-ext4-driver",
            "raw_physical_disk_access": False, "source_assets_read_only": True,
            "physical_usb_write": False,
            "physical_write_authorized": False, "activation_performed": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verified-base-dir", required=True, type=Path)
    parser.add_argument("--qemu-bin", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(prove(args.verified_base_dir, args.qemu_bin),
                         sort_keys=True, indent=2), flush=True)
        return 0
    except (ProofError, OSError, ValueError, tarfile.TarError) as exc:
        print("ordax-qemu-disposable: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
