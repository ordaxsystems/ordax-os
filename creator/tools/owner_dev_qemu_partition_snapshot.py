#!/usr/bin/env python3
"""Disposable QEMU copy-on-write staging proof over an authorized Owner DEV USB.

Writes are confined to a fresh temporary QCOW2 file, NOT the ext4 volume.
No physical writer, installation, EFI change or Update Engine is created.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys
import tarfile
import tempfile
from typing import Callable

HERE = Path(__file__).resolve().parent
SCHEMA = "ordax.creator.owner-dev-ext4-cow-stage-proof/1"
MIB = 1024 * 1024


class SnapshotProofError(RuntimeError):
    pass


def _load(relative: str, name: str):
    spec = importlib.util.spec_from_file_location(name, HERE / relative)
    if spec is None or spec.loader is None:
        raise SnapshotProofError("canonical QEMU probe module missing")
    owner = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(owner)
    return owner


# The snapshot always uses the SAME TCG guest boot policy as physical RO.
QEMU_GUEST_BOOT_FLAGS = _load(
    "owner_dev_qemu_partition_readonly.py", "ordax_cow_shared_guest_boot"
).QEMU_GUEST_BOOT_FLAGS


def sample_read_only(volume: str) -> str:
    """Read a bounded physical sample. Never opens a device writable."""
    if not volume.startswith("\\\\.\\") or len(volume) != 6 or volume[-1] != ":":
        raise SnapshotProofError("physical sample volume is invalid")
    h = hashlib.sha256()
    try:
        with open(volume, "rb", buffering=0) as source:
            left = 8 * MIB
            while left:
                data = source.read(min(MIB, left))
                if not data:
                    raise SnapshotProofError("short read of physical sample")
                h.update(data)
                left -= len(data)
    except OSError as exc:
        raise SnapshotProofError("read-only physical sample unavailable") from exc
    return h.hexdigest()


def create_overlay(
    qemu_img: Path, volume: str, overlay: Path, *, partition_bytes: int,
) -> None:
    r"""Bound a disposable QCOW2 view to the physical Linux PARTITION, not disk.

    Windows QEMU reports the whole USB disk size for \\.\D: even when the
    volume is partition 2. Only the Windows partition inventory is authoritative.
    The brand-new QCOW2 may be shrunk; the physical raw backing is never resized.
    """
    if (qemu_img.is_symlink() or not qemu_img.is_file()
            or overlay.exists()
            or type(partition_bytes) is not int
            or partition_bytes < 512 * 1024 * 1024
            or partition_bytes % 512):
        raise SnapshotProofError("QCOW2 executable, new target or partition size invalid")

    def info() -> dict:
        result = subprocess.run(
            [str(qemu_img), "info", "--output=json", str(overlay)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL, timeout=40, check=False,
        )
        if result.returncode or len(result.stdout) > 256 * 1024:
            raise SnapshotProofError("QCOW2 metadata unavailable")
        record = json.loads(result.stdout.decode("utf-8"))
        if (not isinstance(record, dict) or record.get("format") != "qcow2"
                or record.get("backing-filename-format") != "raw"
                or record.get("backing-filename") != volume
                or record.get("encrypted", False) is not False
                or type(record.get("virtual-size")) is not int
                or record["virtual-size"] < partition_bytes):
            raise SnapshotProofError("QCOW2 backing or physical partition provenance differs")
        return record

    try:
        result = subprocess.run(
            [str(qemu_img), "create", "-f", "qcow2", "-F", "raw",
             "-b", volume, str(overlay)],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            stdin=subprocess.DEVNULL, timeout=40, check=False,
        )
        if result.returncode:
            raise SnapshotProofError("QCOW2 copy-on-write creation failed")
        record = info()
        if record["virtual-size"] > partition_bytes:
            # This is a fresh disposable overlay. The Windows raw physical
            # volume can report entire-disk length. Never resize the backing.
            shrunk = subprocess.run(
                [str(qemu_img), "resize", "--shrink", "-f", "qcow2",
                 str(overlay), str(partition_bytes)],
                stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                stdin=subprocess.DEVNULL, timeout=40, check=False,
            )
            if shrunk.returncode:
                raise SnapshotProofError("QCOW2 partition-only resize failed")
            record = info()
        if record["virtual-size"] != partition_bytes:
            raise SnapshotProofError("QCOW2 virtual length exceeds physical Linux partition")
    except (OSError, subprocess.TimeoutExpired, UnicodeError, ValueError, TypeError) as exc:
        raise SnapshotProofError("QCOW2 partition-bounded staging unavailable") from exc


def guest_script(commit: str, nonce: str, phase: str) -> str:
    """Scripts are proof-only. No physical device selection is exposed."""
    if len(commit) != 40 or set(commit) - set("0123456789abcdef"):
        raise SnapshotProofError("Base source commit is invalid")
    if len(nonce) != 16 or set(nonce) - set("0123456789abcdef"):
        raise SnapshotProofError("snapshot session nonce is invalid")
    marker = f"/mnt/.ordax-qemu-cow-proof-{nonce}"
    version = f"/mnt/versions/{commit}"
    prefix = ("#!/bin/busybox sh\nset -eu\n"
              "/bin/busybox mount -t proc proc /proc\n"
              "/bin/busybox mount -t devtmpfs devtmpfs /dev\n")
    if phase == "stage":
        commands = (
            "/bin/busybox mount -t ext4 /dev/vda /mnt\n"
            f"/bin/busybox mkdir -p {version}\n"
            f"/bin/busybox tar -xpf /dev/vdb -C {version}\n"
            f"/bin/busybox mkdir -p {version}/.ordax-base\n"
            f"/bin/busybox echo {commit} > {version}/.ordax-base/source-commit\n"
            f"/bin/busybox echo {nonce} > {marker}\n"
            f"/bin/busybox sha256sum {version}/bin/busybox\n"
            "/bin/busybox sync\n/bin/busybox umount /mnt\n"
            f"/bin/busybox echo ORDAX_COW_STAGED_{nonce}\n"
        )
    elif phase == "readback":
        commands = (
            "/bin/busybox mount -t ext4 -o ro,noload /dev/vda /mnt\n"
            f"/bin/busybox cat {version}/.ordax-base/source-commit\n"
            f"/bin/busybox cat {marker}\n"
            f"/bin/busybox sha256sum {version}/bin/busybox\n"
            "/bin/busybox umount /mnt\n"
            f"/bin/busybox echo ORDAX_COW_READBACK_{nonce}\n"
        )
    elif phase == "physical":
        commands = (
            "/bin/busybox mount -t ext4 -o ro,noload /dev/vda /mnt\n"
            f"/bin/busybox test ! -e {marker}\n"
            "/bin/busybox umount /mnt\n"
            f"/bin/busybox echo ORDAX_ORIGINAL_UNCHANGED_{nonce}\n"
        )
    else:
        raise SnapshotProofError("unsupported snapshot proof phase")
    return prefix + commands + "/bin/busybox poweroff -f\n"


def run_vm(qemu: Path, kernel: Path, ramdisk: Path, image: Path | str,
           image_format: str, marker: str, *, tar: Path | None = None,
           ro: bool = False) -> str:
    if image_format == "raw":
        # The raw source is always a Windows volume, never a write target.
        if not ro or not isinstance(image, str) or not (
                image.startswith("\\\\.\\") and len(image) == 6 and
                image[-1] == ":"):
            raise SnapshotProofError("raw physical volume cannot be a guest write target")
        if tar is not None:
            raise SnapshotProofError("physical read-only check cannot stage a tar")
    elif image_format == "qcow2":
        if not isinstance(image, Path) or image.is_symlink() or not image.is_file():
            raise SnapshotProofError("QCOW2 snapshot must be a real regular file")
    else:
        raise SnapshotProofError("unsupported QEMU disk format")
    if qemu.is_symlink() or not qemu.is_file():
        raise SnapshotProofError("QEMU executable missing")
    if not kernel.is_file() or not ramdisk.is_file():
        raise SnapshotProofError("verified VM kernel/initramfs missing")
    drive = (f"file={image},format={image_format},if=virtio,"
             f"readonly={'on' if ro else 'off'}")
    args = [str(qemu), "-nodefaults", "-no-reboot", "-nographic",
            "-accel", "tcg", "-m", "384M", "-smp", "1",
            "-serial", "stdio", "-monitor", "none", "-net", "none",
            "-kernel", str(kernel), "-initrd", str(ramdisk),
            "-drive", drive,
            "-append", QEMU_GUEST_BOOT_FLAGS]
    if tar is not None:
        if tar.is_symlink() or not tar.is_file():
            raise SnapshotProofError("verified tar file unavailable")
        args += ["-drive", f"file={tar},format=raw,if=virtio,readonly=on"]
    try:
        result = subprocess.run(args, stdin=subprocess.DEVNULL,
                                stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                timeout=180, check=False)
    except subprocess.TimeoutExpired as exc:
        output = exc.stdout or b""
        if isinstance(output, str):
            output = output.encode("utf-8", "replace")
        tail = output[-1800:].decode("utf-8", "replace")
        raise SnapshotProofError(
            "disposable Linux phase timed out; guest output tail: "
            + (tail or "<no guest output>")
        ) from exc
    except OSError as exc:
        raise SnapshotProofError("disposable Linux phase could not launch") from exc
    output = result.stdout.decode("utf-8", "replace")
    if result.returncode or marker not in output:
        raise SnapshotProofError("QEMU phase failed: " + output[-1200:])
    return output


def prove(base: Path, qemu: Path, qemu_img: Path, *,
          disk_number: int, serial: str, requested_commit: str,
          git_bin: str = "git", awk_bin: str = "awk",
          progress: Callable[[str], None] | None = None,
          prepare_host_bundle: bool = False) -> dict:
    def report(phase: str) -> None:
        if progress is not None:
            progress(phase)

    report("readonly-physical-preflight")
    physical = _load("owner_dev_qemu_partition_readonly.py", "ordax_cow_physical")
    helper = _load("owner_dev_qemu_filesystem_proof.py", "ordax_cow_helper")
    try:
        preflight = physical.probe(
            base, qemu, disk_number=disk_number, serial=serial,
            requested_commit=requested_commit, git_bin=git_bin, awk_bin=awk_bin,
        )
    except physical.ReadonlyProbeError as exc:
        raise SnapshotProofError("canonical physical USB read-only gate failed: " + str(exc)) from exc
    report("readonly-physical-verified")
    volume = "\\\\.\\" + preflight["volume_letter"] + ":"
    original_identity = physical.inventory(disk_number)
    if physical.confirmed_volume(original_identity, disk_number, serial) != preflight["volume_letter"]:
        raise SnapshotProofError("USB physical identity changed after read-only proof")
    initial_hash = sample_read_only(volume)
    nonce = secrets.token_hex(8)
    with tarfile.open(base / "rootfs.tar", "r:") as rootfs:
        busybox = rootfs.extractfile("bin/busybox").read()
    busybox_sha = hashlib.sha256(busybox).hexdigest()
    channel = helper.channel_owner()
    manifest = channel.verify_materialized(base, base.name)
    # Reuse the OS channel's archive member/link/path validation, not a guest
    # tar policy duplicated in the Creator. No guest stage before this passes.
    channel._validate_rootfs_archive(base / "rootfs.tar")

    with tempfile.TemporaryDirectory(prefix="ordax-physical-cow-proof-") as name:
        temp = Path(name)
        overlay = temp / "shadow.qcow2"
        kernel = temp / "vmlinuz"
        payload = temp / "rootfs.tar"
        helper.copy_verified(base / "vmlinuz", kernel, manifest["kernel"])
        helper.copy_verified(base / "rootfs.tar", payload, manifest["rootfs"])
        if physical.inventory(disk_number) != original_identity:
            raise SnapshotProofError("USB changed before creating overlay")
        report("creating-disposable-cow")
        create_overlay(
            qemu_img, volume, overlay,
            partition_bytes=original_identity["Partitions"][1]["Size"],
        )

        evidence = {}
        for phase in ("stage", "readback", "physical"):
            report("guest-" + phase)
            if physical.inventory(disk_number) != original_identity:
                raise SnapshotProofError("USB target changed during overlay proof")
            stage_ramdisk = temp / f"{phase}.cpio.gz"
            stage_ramdisk.write_bytes(helper.ramdisk(
                busybox, guest_script(base.name, nonce, phase)
            ))
            if phase == "physical":
                target, fmt, readonly = volume, "raw", True
            else:
                target, fmt, readonly = overlay, "qcow2", phase != "stage"
            output = run_vm(qemu, kernel, stage_ramdisk, target, fmt,
                            "ORDAX_" + {
                                "stage": "COW_STAGED_",
                                "readback": "COW_READBACK_",
                                "physical": "ORIGINAL_UNCHANGED_",
                            }[phase] + nonce,
                            tar=payload if phase == "stage" else None,
                            ro=readonly)
            if phase != "physical" and (
                    busybox_sha not in output or
                    (phase == "readback" and base.name not in output)):
                raise SnapshotProofError("staged rootfs lacks exact readback")
            evidence[phase] = True
            report("guest-" + phase + "-verified")
        if sample_read_only(volume) != initial_hash:
            raise SnapshotProofError("original ext4 sample changed during COW proof")
        if physical.inventory(disk_number) != original_identity:
            raise SnapshotProofError("physical USB identity changed before COW delta planning")
        report("cow-modified-blocks")
        delta_owner = _load("owner_dev_qemu_delta_plan.py", "ordax_cow_delta_owner")
        try:
            delta = delta_owner.compile_delta(
                qemu_img=qemu_img, overlay=overlay, volume=volume,
                disk_number=disk_number, usb_serial=serial,
                target_bytes=original_identity["Size"],
                partition_offset=original_identity["Partitions"][1]["Offset"],
                partition_bytes=original_identity["Partitions"][1]["Size"],
                include_regions=prepare_host_bundle,
            )
        except delta_owner.DeltaPlanError as exc:
            raise SnapshotProofError("canonical sparse COW delta plan failed: " + str(exc)) from exc
        if (delta.get("physical_write") is not False
                or delta.get("physical_write_authorized") is not False
                or delta.get("physical_preimages_hashed") is not True
                or delta.get("cow_postimages_hashed") is not True
                or delta.get("modified_bytes", 0) <= 0):
            raise SnapshotProofError("sparse COW delta plan is not safe to report")
        report("cow-modified-blocks-hashed")
        bundle_receipt = None
        if prepare_host_bundle:
            if physical.inventory(disk_number) != original_identity:
                raise SnapshotProofError("USB identity changed before local delta handoff")
            localappdata = os.environ.get("LOCALAPPDATA", "")
            if not localappdata or not Path(localappdata).is_dir():
                raise SnapshotProofError("canonical Windows local cache unavailable")
            report("preparing-host-local-delta")
            bundle_owner = _load("owner_dev_qemu_delta_bundle.py",
                                 "ordax_cow_delta_bundle_owner")
            try:
                bundle_receipt = bundle_owner.prepare_bundle(
                    delta=delta, overlay=overlay,
                    cache_root=Path(localappdata) / "OrdaX" / "updates" / "creator" / "dev-delta",
                    disk_number=disk_number, serial=serial,
                    disk_bytes=original_identity["Size"],
                    partition_offset=original_identity["Partitions"][1]["Offset"],
                    partition_bytes=original_identity["Partitions"][1]["Size"],
                    requested_main_commit=requested_commit,
                    published_base_source_commit=base.name,
                )
            except (bundle_owner.DeltaBundleError, OSError) as exc:
                raise SnapshotProofError("verified local delta bundle failed: " + str(exc)) from exc
            if (bundle_receipt.get("physical_write_authorized") is not False
                    or bundle_receipt.get("physical_write") is not False
                    or bundle_receipt.get("cow_plan_sha256") != delta["plan_sha256"]):
                raise SnapshotProofError("local delta handoff is not proof-only")
            report("host-local-delta-verified")
    if physical.inventory(disk_number) != original_identity:
        raise SnapshotProofError("USB changed after proof")
    report("physical-identity-unchanged")
    return {"$schema": SCHEMA, "status": "pass",
            **({"host_delta_bundle": bundle_receipt} if bundle_receipt else {}),
            "source_commit": base.name,
            "requested_source_commit": requested_commit,
            "disk_number": disk_number, "usb_serial": serial.upper(),
            "filesystem": "actual-ext4-backed-disposable-qcow2",
            "guest_stage_verified": evidence["stage"],
            "cold_readback_verified": evidence["readback"],
            "physical_absence_verified": evidence["physical"],
            "physical_sample_sha256_unchanged": True,
            "cow_modified_bytes": delta["modified_bytes"],
            "cow_modified_regions": delta["region_count"],
            "cow_delta_plan_sha256": delta["plan_sha256"],
            "cow_physical_preimages_hashed": True,
            "cow_postimages_hashed": True,
            "rootfs_busybox_sha256": busybox_sha,
            "physical_usb_write": False,
            "physical_write_authorized": False,
            "update_activated": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--verified-base-dir", required=True, type=Path)
    parser.add_argument("--qemu-bin", required=True, type=Path)
    parser.add_argument("--qemu-img-bin", required=True, type=Path)
    parser.add_argument("--trusted-serial", required=True)
    parser.add_argument("--trusted-disk-number", required=True, type=int)
    parser.add_argument("--requested-source-commit", required=True)
    parser.add_argument("--git-bin", default="git")
    parser.add_argument("--awk-bin", default="awk")
    args = parser.parse_args()
    try:
        receipt = prove(args.verified_base_dir, args.qemu_bin, args.qemu_img_bin,
                        disk_number=args.trusted_disk_number,
                        serial=args.trusted_serial,
                        requested_commit=args.requested_source_commit,
                        git_bin=args.git_bin, awk_bin=args.awk_bin)
        print(json.dumps(receipt, sort_keys=True, indent=2), flush=True)
        return 0
    except (SnapshotProofError, OSError, ValueError, tarfile.TarError) as exc:
        print("ordax-qcow2-proof: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
