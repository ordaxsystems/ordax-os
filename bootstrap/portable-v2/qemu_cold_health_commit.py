#!/usr/bin/env python3
"""Disposable QEMU proof of the healthy Portable v3 cold-health commit path.

The proof boots an already-armed one-shot candidate using the same verified
portable-v2 kernel/initramfs handoff as the fallback proof. Unlike the fallback
proof, it waits for a machine-readable marker emitted only after the real
system/supervisor has observed Surface cold health and successfully committed
the candidate through ordax-portable-state. It then inspects the persistent
ext4 activation state and performs a second boot that must select the candidate
as current.

This is CI evidence only. It never selects or touches physical media and does
not claim a physical USB, Secure Boot, or hardware cold-health proof.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
from typing import Any

BASE = Path(__file__).with_name("qemu_boot.py")
SCHEMA = "prototype-ordax.portable-v3-cold-health-qemu-proof-result/1"
FAILURE_SCHEMA = "prototype-ordax.portable-v3-cold-health-qemu-proof-failure/1"
SERIAL_TAIL_LINES = 160


def _load_base():
    spec = importlib.util.spec_from_file_location("ordax_portable_qemu_base", BASE)
    if spec is None or spec.loader is None:
        raise RuntimeError("cannot load portable QEMU proof base")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


qemu = _load_base()


def _serial_tail(path: Path) -> str:
    try:
        lines = path.read_text(encoding="utf-8", errors="replace").splitlines()
    except OSError as exc:
        return f"<unable to read serial log: {exc}>"
    return "\n".join(lines[-SERIAL_TAIL_LINES:])


def preserve_failure_diagnostics(
    work: Path,
    out: Path,
    *,
    phase: str,
    exc: Exception,
    source_commit: str,
    previous_commit: str,
    failed_guest_state: dict[str, Any] | None = None,
) -> None:
    """Persist bounded failure evidence before the disposable work tree is removed."""

    out.parent.mkdir(parents=True, exist_ok=True)
    serial_logs: dict[str, str] = {}
    copy_errors: dict[str, str] = {}

    for path in sorted(work.glob("serial-*.log")):
        serial_logs[path.name] = _serial_tail(path)
        try:
            shutil.copyfile(path, out.parent / path.name)
        except OSError as copy_exc:
            copy_errors[path.name] = str(copy_exc)

    receipt = {
        "$schema": FAILURE_SCHEMA,
        "status": "fail",
        "phase": phase,
        "source_commit": source_commit,
        "previous_commit": previous_commit,
        "error_type": type(exc).__name__,
        "error": str(exc),
        "serial_tail_lines": SERIAL_TAIL_LINES,
        "serial_logs": serial_logs,
        "copy_errors": copy_errors,
        "failed_guest_state": failed_guest_state,
    }
    try:
        out.write_text(
            json.dumps(receipt, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
    except OSError as write_exc:
        print(
            f"portable-v3-cold-health-qemu-proof: unable to write failure receipt: {write_exc}",
            file=sys.stderr,
        )

    print(
        "portable-v3-cold-health-qemu-proof: FAILURE_RECEIPT="
        + json.dumps(receipt, sort_keys=True),
        file=sys.stderr,
    )


def snapshot_failure_state_from_mounted_ext4(
    state_mount: Path, *, candidate_commit: str, previous_commit: str
) -> dict[str, Any]:
    """Only SHA identities and boolean activation flags; no guest log/user data."""
    def sha_identity(relative: str) -> str | None:
        path = state_mount / relative
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 128:
            return None
        try:
            value = path.read_text(encoding="ascii").strip()
        except (UnicodeError, OSError):
            return None
        return value if qemu.COMMIT_RE.fullmatch(value) else None

    release = "ordax/portable-release/"
    current = sha_identity(release + "current")
    previous = sha_identity(release + "known-good")
    candidate = sha_identity(release + "candidate")
    rejected = sha_identity(release + "rejected")
    observed = {
        "current": current,
        "known_good": previous,
        "candidate": candidate,
        "rejected": rejected,
        "candidate_still_armed": candidate == candidate_commit,
        "candidate_rejected": rejected == candidate_commit,
        "previous_restored": current == previous_commit,
        "candidate_promoted": current == candidate_commit,
        "transaction_exists": (
            state_mount / (release + "activation-transaction.json")
        ).exists(),
        "supervisor_persisted_rejected_candidate": (
            sha_identity("ordax/stable-release-health-rejected-sha")
            == candidate_commit
        ),
        "last_applied_is_candidate": (
            sha_identity("ordax/last-applied-sha") == candidate_commit
        ),
        "runtime_surface_sha_matches_candidate": (
            sha_identity("ordax/runtime-surface-sha") == candidate_commit
        ),
    }
    return {
        "$schema": "prototype-ordax.portable-cold-health-failure-state/1",
        "observation": "readonly-disposable-guest-ext4-copy",
        "private_guest_files_collected": False,
        "volatile_guest_run_logs_recoverable": False,
        "source_commit": candidate_commit,
        "previous_commit": previous_commit,
        "activation": observed,
    }


def inspect_failure_state(
    disk: Path, work: Path, *,
    candidate_commit: str, previous_commit: str,
) -> dict[str, Any]:
    """Snapshot only allowlisted activation identities; preserve no guest disk."""
    data_mount = work / "failure-data"
    state_mount = work / "failure-state"
    data_mount.mkdir()
    state_mount.mkdir()
    loop = ""
    data_mounted = False
    state_mounted = False
    try:
        loop = qemu.capture(["losetup", "--find", "--show", "--partscan", str(disk)])
        if not loop.startswith("/dev/loop"):
            raise qemu.ProofError("invalid disposable QEMU loop identity")
        data = Path(loop + "p2")
        qemu.wait_block(data)
        qemu.run(["mount.exfat-fuse", "-o", "ro", str(data), str(data_mount)])
        data_mounted = True
        guest_ext4 = qemu.regular(
            data_mount / ".ordax/state/persistent-state.img",
            "disposable failed-boot persistent state", minimum=16 * 1024 * 1024,
        )
        inspection_copy = work / "failure-state-copy.img"
        qemu.prepare_state_inspection_copy(guest_ext4, inspection_copy)
        qemu.unmount(data_mount)
        data_mounted = False
        qemu.run([
            "mount", "-t", "ext4", "-o", "loop,ro,noload",
            str(inspection_copy), str(state_mount),
        ])
        state_mounted = True
        return snapshot_failure_state_from_mounted_ext4(
            state_mount,
            candidate_commit=candidate_commit,
            previous_commit=previous_commit,
        )
    finally:
        if state_mounted:
            qemu.unmount(state_mount)
        if data_mounted:
            qemu.unmount(data_mount)
        if loop:
            qemu.run(["losetup", "-d", loop])


def inspect_committed_state(
    disk: Path,
    work: Path,
    *,
    previous_commit: str,
    candidate_commit: str,
) -> dict[str, bool]:
    loop = ""
    data_mounted = False
    state_mounted = False
    data_mount = work / "inspect-commit-data"
    state_mount = work / "inspect-commit-state"
    data_mount.mkdir(exist_ok=True)
    state_mount.mkdir(exist_ok=True)
    try:
        loop = qemu.capture(["losetup", "--find", "--show", "--partscan", str(disk)])
        if not loop.startswith("/dev/loop"):
            raise qemu.ProofError("cold-health inspection did not map a host loop device")
        data = Path(loop + "p2")
        qemu.wait_block(data)
        qemu.run(["mount.exfat-fuse", "-o", "ro", str(data), str(data_mount)])
        data_mounted = True

        state_image = qemu.regular(
            data_mount / ".ordax/state/persistent-state.img",
            "cold-health persistent-state image",
            minimum=16 * 1024 * 1024,
        )
        state_copy = work / "cold-health-persistent-state.img"
        qemu.prepare_state_inspection_copy(state_image, state_copy)
        qemu.unmount(data_mount)
        data_mounted = False

        qemu.run([
            "mount",
            "-t",
            "ext4",
            "-o",
            "loop,ro,noload",
            str(state_copy),
            str(state_mount),
        ])
        state_mounted = True
        release_state = state_mount / "ordax/portable-release"

        def slot_value(name: str) -> str | None:
            path = release_state / name
            if not path.exists():
                return None
            value = path.read_text(encoding="ascii").strip()
            if qemu.COMMIT_RE.fullmatch(value) is None:
                raise qemu.ProofError(
                    f"cold-health committed state has invalid {name} identity"
                )
            return value

        current = slot_value("current")
        known_good = slot_value("known-good")
        rejected = slot_value("rejected")
        candidate = slot_value("candidate")
        transaction_present = (release_state / "activation-transaction.json").exists()

        checks = {
            "current_promoted_to_candidate": current == candidate_commit,
            "known_good_rotated_to_previous": known_good == previous_commit,
            "candidate_not_rejected": rejected != candidate_commit,
            "candidate_file_removed": candidate is None,
            "activation_transaction_removed": not transaction_present,
        }
        if not all(checks.values()):
            raise qemu.ProofError(
                "cold-health committed state mismatch: "
                f"current={current!r}, known_good={known_good!r}, "
                f"rejected={rejected!r}, candidate={candidate!r}, "
                f"activation_transaction_present={transaction_present}, "
                f"checks={checks}"
            )
        return checks
    finally:
        if state_mounted:
            qemu.unmount(state_mount)
        if data_mounted:
            qemu.unmount(data_mount)
        if loop:
            qemu.run(["losetup", "-d", loop])


def prove(args: argparse.Namespace) -> dict[str, Any]:
    if os.name != "posix" or os.geteuid() != 0:
        raise qemu.ProofError("portable cold-health QEMU proof requires root on POSIX CI")
    if not args.previous_commit:
        raise qemu.ProofError("previous commit is required for cold-health commit proof")

    qemu.require_programs()
    inputs = qemu.validate_inputs(args)
    if inputs["previous"] is None:
        raise qemu.ProofError("previous release is not staged")

    work = Path(tempfile.mkdtemp(prefix="ordax-portable-cold-health-qemu-"))
    disk: Path | None = None
    phase = "stage_disk"
    try:
        try:
            disk = qemu.stage_disk(args, inputs, work)
            commit_marker = "ORDAX_PORTABLE_COLD_HEALTH_COMMIT=" + args.source_commit

            phase = "candidate_boot"
            first_serial, first_checks = qemu.boot_qemu_expected(
                args,
                inputs,
                disk,
                work,
                expected_slot="candidate",
                expected_commit=args.source_commit,
                serial_name="serial-candidate-health.log",
                required_post_marker=commit_marker,
                graphical_hardware=True,
            )

            phase = "inspect_committed_state"
            state_checks = inspect_committed_state(
                disk,
                work,
                previous_commit=args.previous_commit,
                candidate_commit=args.source_commit,
            )

            phase = "committed_current_boot"
            second_serial, second_checks = qemu.boot_qemu_expected(
                args,
                inputs,
                disk,
                work,
                expected_slot="current",
                expected_commit=args.source_commit,
                serial_name="serial-committed-current.log",
                graphical_hardware=True,
            )

            phase = "final_checks"
            checks = {
                "candidate_boot_selected": first_checks["expected_slot_selected"],
                "candidate_source_sha_exact": first_checks["portable_source_sha_exact"],
                "candidate_stable_source_sha_exact": first_checks["stable_init_source_sha_exact"],
                "candidate_surface_runtime_exact": first_checks["surface_runtime_sha_exact"],
                "candidate_local_ai_requirement_satisfied": first_checks[
                    "local_ai_runtime_requirement_satisfied"
                ],
                "cold_health_commit_marker_seen": first_checks["required_post_marker_seen"],
                "second_boot_current_selected": second_checks["expected_slot_selected"],
                "second_boot_candidate_source_sha_exact": second_checks[
                    "portable_source_sha_exact"
                ],
                "second_boot_stable_source_sha_exact": second_checks[
                    "stable_init_source_sha_exact"
                ],
                "second_boot_surface_runtime_exact": second_checks[
                    "surface_runtime_sha_exact"
                ],
                "second_boot_local_ai_requirement_satisfied": second_checks[
                    "local_ai_runtime_requirement_satisfied"
                ],
                "network_disabled_both_boots": (
                    first_checks["qemu_network_disabled"]
                    and second_checks["qemu_network_disabled"]
                ),
                "virtio_graphics_both_boots": (
                    first_checks["qemu_graphical_hardware_requested"]
                    and second_checks["qemu_graphical_hardware_requested"]
                ),
                "durable_cache_both_boots": (
                    first_checks["qemu_durable_cache_mode"]
                    and second_checks["qemu_durable_cache_mode"]
                ),
                **state_checks,
            }
            if not all(checks.values()):
                raise qemu.ProofError(f"cold-health QEMU checks incomplete: {checks}")

            phase = "destroy_guest_disk"
            disk_sha = qemu.sha256_file(disk)
            disk.unlink()
            guest_destroyed = not disk.exists()
            if not guest_destroyed:
                raise qemu.ProofError("cold-health QEMU guest disk was retained")

            result = {
                "$schema": SCHEMA,
                "status": "pass",
                "source_commit": args.source_commit,
                "previous_commit": args.previous_commit,
                "cold_health_commit_proven": True,
                "candidate_boot_count": 1,
                "committed_current_boot_count": 1,
                "failure_fallback_proven_by_this_receipt": False,
                "physical_target_device_touched": False,
                "physical_write_authorized": False,
                "physical_usb_boot_proven": False,
                "secure_boot_proven": False,
                "public_physical_promotion_allowed": False,
                "network_required": False,
                "virtual_graphics": {
                    "adapter": "virtio-vga",
                    "host_display_window": False,
                    "surface_path": "cage-wayland-webkit-seatd",
                    "synthetic_health": False,
                },
                "guest_disk": {
                    "sha256_before_destruction": disk_sha,
                    "retained": False,
                    "layout": ["ORDAX-ESP", "ORDAX-DATA"],
                },
                "serial_markers": [
                    commit_marker,
                    "ORDAX_PORTABLE_V2_SLOT=candidate",
                    "ORDAX_PORTABLE_V2_SLOT=current",
                    "ORDAX_PORTABLE_V2_SOURCE_SHA=" + args.source_commit,
                ],
                "checks": checks,
            }
            args.out.parent.mkdir(parents=True, exist_ok=True)
            args.out.write_text(
                json.dumps(result, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
            )
            return result
        except Exception as exc:
            # Diagnostics are observation-only and never change the real
            # success predicate, signed release, or original failure status.
            failed_guest_state: dict[str, Any] | None = None
            if disk is not None and disk.exists():
                try:
                    failed_guest_state = inspect_failure_state(
                        disk, work,
                        candidate_commit=args.source_commit,
                        previous_commit=args.previous_commit,
                    )
                except Exception as diagnostic_error:
                    failed_guest_state = {
                        "status": "unavailable",
                        "diagnostic_error_type": type(diagnostic_error).__name__,
                        "private_guest_files_collected": False,
                    }
            preserve_failure_diagnostics(
                work,
                args.out,
                phase=phase,
                exc=exc,
                source_commit=args.source_commit,
                previous_commit=args.previous_commit,
                failed_guest_state=failed_guest_state,
            )
            raise
    finally:
        if disk is not None and disk.exists():
            disk.unlink()
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--kernel", required=True, type=Path)
    parser.add_argument("--initramfs", required=True, type=Path)
    parser.add_argument("--initramfs-provenance", required=True, type=Path)
    parser.add_argument("--capsule", required=True, type=Path)
    parser.add_argument("--stable-base", required=True, type=Path)
    parser.add_argument("--state-image", required=True, type=Path)
    parser.add_argument("--portable-root", required=True, type=Path)
    parser.add_argument("--trust", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--previous-commit", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    for name in (
        "kernel",
        "initramfs",
        "initramfs_provenance",
        "capsule",
        "stable_base",
        "state_image",
        "portable_root",
        "trust",
        "out",
    ):
        setattr(args, name, getattr(args, name).resolve())

    try:
        result = prove(args)
    except (
        qemu.ProofError,
        OSError,
        json.JSONDecodeError,
        KeyError,
        RuntimeError,
    ) as exc:
        print(f"portable-v3-cold-health-qemu-proof: ERROR: {exc}", file=sys.stderr)
        return 1

    print(json.dumps(result, indent=2, sort_keys=True))
    print("PORTABLE_V4_QEMU_COLD_HEALTH_COMMIT_PROOF=PASS")
    print("PORTABLE_V4_PHYSICAL_BOOT_PROVEN=NO")
    print("PORTABLE_V4_PHYSICAL_WRITE_AUTHORIZED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
