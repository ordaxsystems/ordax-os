#!/usr/bin/env python3
"""Real fail-closed signature/recovery QEMU proof using the canonical portable PID1.

Mutations are exclusively on a disposable guest disk, never the signed inputs,
physical devices, the Stable builder, or the authoritative release protocol.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "bootstrap/portable-v2"))
import qemu_boot as qemu  # noqa: E402

SCHEMA = "prototype-ordax.independent-signed-release-failure-qemu/1"


def alter_guest_signature(disk: Path, work: Path, commit: str) -> str:
    """Invalidate real Ed25519 signature bytes inside the disposable guest DATA."""
    if qemu.COMMIT_RE.fullmatch(commit) is None:
        raise qemu.ProofError("invalid signed release commit for fault injection")
    loop = ""
    mounted = False
    mountpoint = work / "fault-data"
    mountpoint.mkdir(exist_ok=True)
    try:
        loop = qemu.capture(["losetup", "--find", "--show", "--partscan", str(disk)])
        if not loop.startswith("/dev/loop"):
            raise qemu.ProofError("disposable disk did not attach to host loop")
        part = Path(loop + "p2")
        qemu.wait_block(part)
        qemu.run(["mount.exfat-fuse", str(part), str(mountpoint)])
        mounted = True
        envelope_path = mountpoint / ".ordax" / "releases" / commit / "release-envelope.json"
        envelope = qemu.load_json(envelope_path, "staged signed envelope")
        signature = envelope.get("signature")
        if not isinstance(signature, str):
            raise qemu.ProofError("signed release envelope has no expected signature")
        try:
            decoded = bytearray(base64.b64decode(signature, validate=True))
        except (ValueError, base64.binascii.Error) as exc:
            raise qemu.ProofError("signed release envelope has invalid base64") from exc
        if len(decoded) != 64:
            raise qemu.ProofError("signed release has non-Ed25519 signature size")
        decoded[0] ^= 0x01
        envelope["signature"] = base64.b64encode(decoded).decode("ascii")
        envelope_path.write_text(json.dumps(envelope, sort_keys=True) + "\n", encoding="utf-8")
        os.sync()
        return qemu.sha256_file(envelope_path)
    finally:
        if mounted:
            qemu.run(["umount", str(mountpoint)])
        if loop:
            qemu.run(["losetup", "-d", loop])


def observe_rescue(inputs: dict, disk: Path, work: Path, *,
                   name: str, recovery: bool) -> dict:
    """Use the real kernel + original initramfs; require a recovery marker, never a handoff."""
    serial = work / (name + ".serial.log")
    stderr = work / (name + ".stderr.log")
    reason = ("portable-v2 recovery mode requested" if recovery
              else "no candidate/current/known-good release is safely selectable and exactly verified")
    command = [
        "qemu-system-x86_64", "-machine", "pc", "-accel", "tcg,thread=multi",
        "-m", "1536", "-smp", "2",
        "-kernel", str(inputs["kernel"]), "-initrd", str(inputs["initramfs"]),
        "-append", "console=ttyS0 rdinit=/sbin/ordax-portable-init loglevel=6"
                   + (" ordax.mode=recovery" if recovery else ""),
        "-drive", f"file={disk},format=raw,if=ide,index=0,media=disk,cache=directsync",
        "-display", "none", "-serial", f"file:{serial}",
        "-monitor", "none", "-net", "none", "-no-reboot",
    ]
    before = qemu.sha256_file(disk) if recovery else None
    with stderr.open("wb") as error_file:
        proc = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=error_file)
    seen = False
    text = ""
    try:
        deadline = time.monotonic() + 150
        while time.monotonic() < deadline:
            text = serial.read_text(encoding="utf-8", errors="replace") if serial.exists() else ""
            if reason in text and "No network or automatic mutation is started from this recovery path." in text:
                seen = True
                break
            if proc.poll() is not None:
                break
            time.sleep(0.25)
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proc.kill()
                proc.wait(timeout=5)
    if not seen or "ORDAX_PORTABLE_V2_HANDOFF=VERIFIED" in text:
        raise qemu.ProofError("rescue not verified or invalid release was handed to product: "
                              + text[-3000:])
    after = qemu.sha256_file(disk) if recovery else None
    if recovery and before != after:
        raise qemu.ProofError("explicit read-only recovery wrote to disposable guest disk")
    return {
        "serial_sha256": qemu.sha256_file(serial),
        "expected_rescue_reason": reason,
        "no_product_handoff": True,
        "no_network": True,
        "read_only_disk_unchanged": (before == after) if recovery else None,
    }


def prove(args: argparse.Namespace) -> dict:
    if os.name != "posix" or os.geteuid() != 0:
        raise qemu.ProofError("signed release failure proof requires root on Linux CI")
    if not args.previous_commit:
        raise qemu.ProofError("independent signed release failure test requires previous signed release")
    qemu.require_programs()
    inputs = qemu.validate_inputs(args)
    if inputs["previous"] is None:
        raise qemu.ProofError("valid previous signed release is required")
    if inputs["previous"]["runtime_sha256"] != inputs["candidate"]["runtime_sha256"]:
        raise qemu.ProofError("candidate and previous must share the verified runtime")
    if args.out.is_symlink() or args.out.exists() or not args.out.parent.is_dir():
        raise qemu.ProofError("proof destination must be a new regular file")
    originals = {
        "base": qemu.sha256_file(inputs["stable_base"]),
        "candidate_envelope": qemu.sha256_file(inputs["candidate_release"] / "release-envelope.json"),
        "previous_envelope": qemu.sha256_file(inputs["previous_release"] / "release-envelope.json"),
        "state": qemu.sha256_file(inputs["state_image"]),
    }
    work = Path(tempfile.mkdtemp(prefix="ordax-independent-signed-fault-qemu-"))
    disk = None
    try:
        disk = qemu.stage_disk(args, inputs, work)
        candidate_bad = alter_guest_signature(disk, work, args.source_commit)
        first_log, first = qemu.boot_qemu_expected(
            args, inputs, disk, work,
            expected_slot="current", expected_commit=args.previous_commit,
            serial_name="serial-invalid-candidate.log",
        )
        state_checks = qemu.inspect_one_shot_state(
            disk, work, previous_commit=args.previous_commit,
            candidate_commit=args.source_commit,
        )
        second_log, second = qemu.boot_qemu_expected(
            args, inputs, disk, work,
            expected_slot="current", expected_commit=args.previous_commit,
            serial_name="serial-persisted-fallback.log",
        )
        if not all(first.values()) or not all(second.values()) or not all(state_checks.values()):
            raise qemu.ProofError("corrupt signed candidate did not durably roll back")
        previous_bad = alter_guest_signature(disk, work, args.previous_commit)
        all_invalid = observe_rescue(inputs, disk, work, name="all-releases-invalid",
                                     recovery=False)
        explicit_recovery = observe_rescue(inputs, disk, work, name="explicit-read-only-recovery",
                                           recovery=True)
        checked = {
            "invalid_candidate_fell_back_to_signed_previous": True,
            "previous_release_selected_twice": True,
            "candidate_marked_rejected_in_ext4": True,
            "signed_release_failure_entered_rescue": all_invalid["no_product_handoff"],
            "explicit_recovery_mount_read_only": explicit_recovery["read_only_disk_unchanged"],
            "no_network_in_rescue": all_invalid["no_network"] and explicit_recovery["no_network"],
            **state_checks,
        }
        if not all(checked.values()):
            raise qemu.ProofError("incomplete real signed failure/rollback/recovery checks")
        result = {
            "$schema": SCHEMA, "status": "pass",
            "candidate_source_commit": args.source_commit,
            "previous_source_commit": args.previous_commit,
            "original_input_sha256": originals,
            "invalid_guest_candidate_signature_envelope_sha256": candidate_bad,
            "invalid_guest_previous_signature_envelope_sha256": previous_bad,
            "serial_sha256": {
                "invalid_candidate": hashlib.sha256(first_log.encode()).hexdigest(),
                "persisted_fallback": hashlib.sha256(second_log.encode()).hexdigest(),
                "all_invalid": all_invalid["serial_sha256"],
                "explicit_recovery": explicit_recovery["serial_sha256"],
            },
            "checks": checked, "physical_device_touched": False,
            "physical_promotion_authorized": False,
        }
        for key, initial in originals.items():
            path = {
                "base": inputs["stable_base"],
                "candidate_envelope": inputs["candidate_release"] / "release-envelope.json",
                "previous_envelope": inputs["previous_release"] / "release-envelope.json",
                "state": inputs["state_image"],
            }[key]
            if qemu.sha256_file(path) != initial:
                raise qemu.ProofError("fault injection modified canonical input: " + key)
        disk.unlink()
        disk = None
        result["checks"]["disposable_guest_disk_destroyed"] = True
        args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n",
                            encoding="utf-8")
        return result
    finally:
        if disk is not None and disk.exists():
            disk.unlink()
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    for name in ("kernel", "initramfs", "initramfs-provenance", "capsule",
                 "stable-base", "state-image", "portable-root", "trust", "out"):
        parser.add_argument("--" + name, required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--previous-commit", required=True)
    args = parser.parse_args()
    try:
        report = prove(args)
        print("ORDAX_INDEPENDENT_SIGNED_RELEASE_FAILURE_QEMU=PASS")
        print(json.dumps(report, sort_keys=True))
        return 0
    except (qemu.ProofError, OSError, ValueError, KeyError, json.JSONDecodeError) as exc:
        print("ordax-independent-signed-failure: ERROR: " + str(exc), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
