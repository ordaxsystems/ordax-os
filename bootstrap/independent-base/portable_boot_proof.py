#!/usr/bin/env python3
"""Bridge Buildroot candidate into the existing pinned portable-v2 proof.

No new PID1, release selector, signing protocol or mount implementation.
All inputs are disposable files; invoking this does not authorize promotion.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import subprocess
import sys

from build import ROOT, BaseError, CANONICAL_HANDOFF, contracts, digest, verify

SHA40 = re.compile(r"[0-9a-f]{40}\\Z")


def regular_file(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file() or str(path).startswith("/dev/"):
        raise BaseError(f"{label} must be a regular non-device file")
    p = path.resolve()
    if str(p).startswith("/dev/"):
        raise BaseError(f"{label} resolved to a device path")
    return p


def outside_source(path: Path) -> Path:
    p = path.resolve()
    if ROOT == p or ROOT in p.parents:
        raise BaseError("proof outputs must not modify source checkout")
    return p


def require_canonical_owners() -> None:
    contracts()
    pid1 = ROOT / "bootstrap/initramfs/portable_init.sh"
    verifier = ROOT / "bootstrap/initramfs/portable_base_verify.sh"
    proof = ROOT / "bootstrap/portable-v2/qemu_boot.py"
    for path in (pid1, verifier, proof, CANONICAL_HANDOFF):
        if not path.is_file() or path.is_symlink():
            raise BaseError(f"official owner unavailable: {path}")
    text = pid1.read_text(encoding="utf-8")
    for marker in (
        "/sbin/ordax-portable-base-verify verify",
        "/sbin/ordax-portable-state select-boot",
        "/sbin/ordax-portable-mount mount-base",
        "/sbin/ordax-portable-mount mount-system",
        "switch_root",
    ):
        if marker not in text:
            raise BaseError(f"official portable PID1 contract drifted: {marker}")
    if "sha256sum -c" not in verifier.read_text(encoding="utf-8"):
        raise BaseError("official base SHA-256 verifier not enforced")


def command(argv: list[str]) -> None:
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            check=False, text=True)
    if result.returncode:
        raise BaseError(f"official command exited {result.returncode}: {argv[0]}\\n"
                        + result.stdout[-6000:])


def prove(args: argparse.Namespace) -> dict:
    require_canonical_owners()
    if not SHA40.fullmatch(args.source_commit):
        raise BaseError("source commit must be lowercase 40-hex")
    out = outside_source(args.output_dir)
    if out.exists() and any(out.iterdir()):
        raise BaseError("proof work directory must be new or empty")
    if args.previous_commit and not SHA40.fullmatch(args.previous_commit):
        raise BaseError("previous release commit must be lowercase 40-hex")
    base_dir = args.base_out.resolve()
    candidate = regular_file(base_dir / "independent-base.erofs", "candidate EROFS")
    receipt = verify(base_dir)
    if receipt.get("canonical_portable_handoff_sha256") != digest(CANONICAL_HANDOFF):
        raise BaseError("candidate handoff is not the canonical owner")
    if receipt.get("source_commit") != args.source_commit:
        raise BaseError("candidate was compiled from a different source commit")
    if receipt.get("stable_channel_authorized") is True or receipt.get("physical_artifact_authorized") is not False:
        raise BaseError("candidate is not isolated")
    kernel = regular_file(args.kernel, "kernel")
    capsule = regular_file(args.capsule, "verified bootstrap capsule")
    state = regular_file(args.state_image, "disposable ext4 state")
    trust = regular_file(args.trust, "portable release trust")
    portable = args.portable_root.resolve()
    if portable.is_symlink() or not portable.is_dir() or str(portable).startswith("/dev/"):
        raise BaseError("portable root must be an existing directory, not a device")
    for p in (kernel, capsule, state, trust, portable):
        if ROOT == p or ROOT in p.parents:
            raise BaseError("QEMU candidate inputs must be staged outside source repository")

    out.mkdir(parents=True, exist_ok=True)
    initramfs_work = out / "initramfs-work"
    initramfs_out = out / "initramfs"
    builder = ROOT / "bootstrap/initramfs/build.py"
    command([sys.executable, str(builder), "build", "--jobs", str(args.jobs),
             "--work-dir", str(initramfs_work), "--out-dir", str(initramfs_out),
             "--portable-bootstrap-capsule", str(capsule),
             "--portable-stable-base", str(candidate)])
    command([sys.executable, str(builder), "verify", "--out-dir", str(initramfs_out)])
    provenance = json.loads((initramfs_out / "initramfs-provenance.json").read_text())
    pin = provenance.get("portable_stable_base_pin", {})
    if pin.get("sha256") != digest(candidate) or pin.get("provided") is not True:
        raise BaseError("canonical initramfs did not pin the independent base")

    qemu_result = out / "portable-qemu-result.json"
    argv = [sys.executable, str(ROOT / "bootstrap/portable-v2/qemu_boot.py"),
            "--kernel", str(kernel),
            "--initramfs", str(initramfs_out / "initramfs.cpio.gz"),
            "--initramfs-provenance", str(initramfs_out / "initramfs-provenance.json"),
            "--capsule", str(capsule),
            "--stable-base", str(candidate),
            "--state-image", str(state),
            "--portable-root", str(portable),
            "--trust", str(trust),
            "--source-commit", args.source_commit,
            "--out", str(qemu_result)]
    if args.previous_commit:
        argv.extend(["--previous-commit", args.previous_commit])
    command(argv)  # official portable PID1 QEMU harness owns every success predicate
    proof = json.loads(qemu_result.read_text(encoding="utf-8"))
    if proof.get("status") != "pass" or proof.get("qemu_direct_kernel_boot_proven") is not True:
        raise BaseError("official QEMU receipt does not prove portable boot")
    for flag in ("physical_usb_boot_proven", "physical_target_device_touched",
                 "physical_write_authorized", "public_physical_promotion_allowed"):
        if proof.get(flag) is not False:
            raise BaseError(f"official QEMU receipt does not prohibit {flag}")
    if not all(proof.get("checks", {}).values()):
        raise BaseError("official QEMU handoff checks failed")
    if args.previous_commit and not proof.get("armed_candidate_one_shot_proven"):
        raise BaseError("official one-shot rollback has not been proved")
    result = {
        "status": "pass",
        "independent_base_sha256": digest(candidate),
        "canonical_entrypoint_sha256": digest(CANONICAL_HANDOFF),
        "initramfs_sha256": digest(initramfs_out / "initramfs.cpio.gz"),
        "portable_qemu_result": str(qemu_result),
        "physical_promotion_authorized": False,
    }
    (out / "integration-result.json").write_text(json.dumps(result, indent=2, sort_keys=True) + "\\n")
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-out", required=True, type=Path)
    parser.add_argument("--kernel", required=True, type=Path)
    parser.add_argument("--capsule", required=True, type=Path)
    parser.add_argument("--state-image", required=True, type=Path)
    parser.add_argument("--portable-root", required=True, type=Path)
    parser.add_argument("--trust", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--previous-commit")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--jobs", type=int, default=4)
    args = parser.parse_args()
    try:
        proof = prove(args)
        print("ORDAX_INDEPENDENT_PORTABLE_V2_QEMU=PASS")
        print(json.dumps(proof, sort_keys=True))
        return 0
    except (BaseError, OSError, ValueError, KeyError) as exc:
        print(f"ordax-independent-portable-v2: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
