#!/usr/bin/env python3
"""Disposable proof for the portable USB v2 release/state mount graph.

This proof never accepts a physical device path. It re-verifies an already
materialized signed portable release through the real release agent, attaches
only regular image files to host loop devices, mounts the immutable EROFS
system tree plus the ext4 persistent-state image, composes an OverlayFS runtime
system view, proves writes land only in persistent state, then remounts and
proves that state survives while the EROFS bytes remain unchanged.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import sys
import tempfile
from typing import Any


class ProofError(RuntimeError):
    pass


def run(argv: list[str], *, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            argv,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise ProofError(f"cannot execute {' '.join(argv)}: {exc}") from exc
    if check and result.returncode != 0:
        raise ProofError(
            f"command failed ({result.returncode}): {' '.join(argv)}: "
            f"stdout={result.stdout.decode('utf-8', 'replace')!r} "
            f"stderr={result.stderr.decode('utf-8', 'replace')!r}"
        )
    return result


def require_root_and_tools() -> None:
    if os.name != "posix" or os.geteuid() != 0:
        raise ProofError("portable boot handoff proof requires root on a POSIX CI host")
    required = ("losetup", "mount", "umount", "e2fsck", "sha256sum", "sh")
    missing = [name for name in required if shutil.which(name) is None]
    if missing:
        raise ProofError("missing handoff proof tools: " + ", ".join(missing))


def regular_file(path: Path, label: str) -> Path:
    absolute = path.resolve()
    if str(absolute).startswith("/dev/"):
        raise ProofError(f"{label} must never be a device path")
    try:
        info = absolute.lstat()
    except OSError as exc:
        raise ProofError(f"cannot stat {label}: {exc}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ProofError(f"{label} must be a regular non-symlink file")
    return absolute


def real_directory(path: Path, label: str) -> Path:
    absolute = path.resolve()
    try:
        info = absolute.lstat()
    except OSError as exc:
        raise ProofError(f"cannot stat {label}: {exc}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ProofError(f"{label} must be a real directory")
    return absolute


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def attach_loop(path: Path, *, read_only: bool) -> str:
    argv = ["losetup", "--find", "--show"]
    if read_only:
        argv.append("--read-only")
    argv.append(str(path))
    result = run(argv)
    loop = result.stdout.decode("utf-8", "replace").strip()
    if not loop.startswith("/dev/loop"):
        raise ProofError(f"unexpected host loop device: {loop!r}")
    return loop


def unmount(path: Path) -> None:
    subprocess.run(
        ["umount", "-l", str(path)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def detach(loop: str) -> None:
    if loop:
        subprocess.run(
            ["losetup", "-d", loop],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )


def verify_release(
    agent: Path,
    trust: Path,
    portable_root: Path,
    commit: str,
) -> dict[str, Any]:
    agent = regular_file(agent, "release agent")
    trust = regular_file(trust, "release trust")
    result = run([
        str(agent),
        "verify-portable-exact",
        "--trust", str(trust),
        "--root", str(portable_root),
        "--repository", "ordaxsystems/ordax-os",
        "--expected-commit", commit,
    ])
    try:
        receipt = json.loads(result.stdout.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise ProofError("release verifier returned invalid JSON") from exc
    if receipt.get("status") != "verified-portable-exact":
        raise ProofError("portable release did not pass exact offline verification")
    if receipt.get("source_commit") != commit:
        raise ProofError("portable release verifier returned the wrong source commit")
    if receipt.get("activation_allowed") is not False:
        raise ProofError("portable release verifier unexpectedly authorized activation")
    return receipt


def mount_graph(
    image: Path,
    state: Path,
    work: Path,
    *,
    write_marker: bool,
) -> dict[str, str]:
    release_mount = work / "release"
    state_mount = work / "state"
    merged_mount = work / "system"
    for path in (release_mount, state_mount, merged_mount):
        path.mkdir(parents=True, exist_ok=True)

    release_loop = ""
    state_loop = ""
    release_mounted = False
    state_mounted = False
    overlay_mounted = False
    try:
        release_loop = attach_loop(image, read_only=True)
        state_loop = attach_loop(state, read_only=False)

        run(["mount", "-t", "erofs", "-o", "ro", release_loop, str(release_mount)])
        release_mounted = True
        run(["e2fsck", "-fn", state_loop])
        run(["mount", "-t", "ext4", "-o", "rw", state_loop, str(state_mount)])
        state_mounted = True

        lower = release_mount / "system"
        if not lower.is_dir():
            raise ProofError("EROFS release does not contain system/")

        run(["mount", "--bind", str(lower), str(merged_mount)])
        run(["mount", "-o", "remount,bind,ro,nodev,nosuid", str(merged_mount)])
        overlay_mounted = True

        entrypoint = merged_mount / "entrypoint"
        if not entrypoint.is_file() or entrypoint.is_symlink():
            raise ProofError("runtime system view is missing safe system/entrypoint")
        if not os.access(entrypoint, os.X_OK):
            raise ProofError("runtime system/entrypoint is not executable")
        run(["sh", "-n", str(entrypoint)])

        lower_marker = lower / ".ordax-system-write-proof"
        merged_marker = merged_mount / ".ordax-system-write-proof"
        if lower_marker.exists():
            raise ProofError("immutable release unexpectedly contains system write marker")
        try:
            merged_marker.write_text("FORBIDDEN\n", encoding="utf-8")
        except OSError:
            pass
        else:
            raise ProofError("read-only system view unexpectedly accepted a write")

        state_marker = state_mount / "ordax" / "state-proof"
        if write_marker:
            state_marker.parent.mkdir(parents=True, exist_ok=True)
            state_marker.write_text("ORDAX_PORTABLE_STATE=PERSISTENT\n", encoding="utf-8")
            os.sync()
        else:
            if not state_marker.is_file():
                raise ProofError("persistent ext4 state marker did not survive remount")
            if state_marker.read_text(encoding="utf-8") != "ORDAX_PORTABLE_STATE=PERSISTENT\n":
                raise ProofError("persistent ext4 state marker changed after remount")

        return {
            "entrypoint": str(entrypoint),
            "release_loop": release_loop,
            "state_loop": state_loop,
        }
    finally:
        if overlay_mounted:
            unmount(merged_mount)
        if state_mounted:
            unmount(state_mount)
        if release_mounted:
            unmount(release_mount)
        detach(state_loop)
        detach(release_loop)


def prove(
    agent: Path,
    trust: Path,
    portable_root: Path,
    state_image: Path,
    commit: str,
    output: Path,
) -> dict[str, Any]:
    require_root_and_tools()
    if len(commit) != 40 or any(ch not in "0123456789abcdef" for ch in commit):
        raise ProofError("source commit must be lowercase 40-hex")

    portable_root = real_directory(portable_root, "portable root")
    state_image = regular_file(state_image, "persistent-state image")
    receipt = verify_release(agent, trust, portable_root, commit)

    expected_release = portable_root / "releases" / commit
    release_path = real_directory(Path(receipt["release_path"]), "verified portable release")
    if release_path != expected_release.resolve():
        raise ProofError("release verifier returned a path outside the exact release root")
    image = regular_file(Path(receipt["artifact_path"]), "verified system.erofs")
    expected_image = release_path / "system.erofs"
    if image != expected_image.resolve():
        raise ProofError("release verifier returned a non-canonical artifact path")

    before = sha256_file(image)
    output = output.resolve()
    if output.exists() or output.is_symlink():
        raise ProofError("proof output must not already exist")
    output.parent.mkdir(parents=True, exist_ok=True)

    work = Path(tempfile.mkdtemp(prefix="ordax-portable-handoff-", dir=str(output.parent)))
    try:
        first = mount_graph(image, state_image, work / "first", write_marker=True)
        after_first = sha256_file(image)
        if before != after_first:
            raise ProofError("immutable EROFS bytes changed after runtime write")

        second = mount_graph(image, state_image, work / "second", write_marker=False)
        after_second = sha256_file(image)
        if before != after_second:
            raise ProofError("immutable EROFS bytes changed after remount")

        current = portable_root / "current"
        if current.exists() or current.is_symlink():
            raise ProofError("portable mount proof must not create a legacy current pointer")

        proof = {
            "$schema": "prototype-ordax.portable-boot-handoff-proof-result/1",
            "status": "pass",
            "source_commit": commit,
            "release_verified_exact_offline": True,
            "release_sha256": before,
            "release_filesystem": "erofs",
            "release_mount_read_only": True,
            "state_filesystem": "ext4",
            "runtime_system_view": "read-only-bind",
            "system_entrypoint_shell_valid": True,
            "persistent_write_survived_remount": True,
            "erofs_unchanged_after_runtime_write": True,
            "legacy_current_pointer_created": False,
            "physical_device_touched": False,
            "physical_boot_connected": False,
            "bootable_proven": False,
            "activation_selection_implemented": False,
            "first_mount": first,
            "second_mount": second,
        }
        output.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return proof
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--release-agent", required=True, type=Path)
    parser.add_argument("--trust", required=True, type=Path)
    parser.add_argument("--portable-root", required=True, type=Path)
    parser.add_argument("--state-image", required=True, type=Path)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    try:
        proof = prove(
            args.release_agent,
            args.trust,
            args.portable_root,
            args.state_image,
            args.source_commit,
            args.out,
        )
    except ProofError as exc:
        print(f"portable-boot-handoff-proof: ERROR: {exc}", file=sys.stderr)
        return 1
    print("PORTABLE_BOOT_HANDOFF_MOUNT_PROOF=PASS")
    print("SIGNED_RELEASE_REVERIFIED_OFFLINE=YES")
    print("EROFS_IMMUTABLE=YES")
    print("EXT4_STATE_PERSISTENT=YES")
    print("OVERLAY_SYSTEM_VIEW=YES")
    print("PHYSICAL_BOOT_CONNECTED=NO")
    print("BOOTABLE_PROVEN=NO")
    print(json.dumps(proof, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
