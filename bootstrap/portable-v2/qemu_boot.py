#!/usr/bin/env python3
"""Direct-kernel QEMU proof for the durable OrdaX portable-v2 PID1 handoff.

This proof deliberately does not prove UEFI. It creates one sparse regular RAW
disk with ORDAX-ESP + ORDAX-DATA, stages already-built real candidate artifacts,
boots the exact OrdaX kernel/initramfs with rdinit=/sbin/ordax-portable-init,
requires the portable PID1 and Stable Base handoff serial markers, disables
networking, and destroys the guest disk afterward. No physical target device is
accepted or retained.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any

SCHEMA = "prototype-ordax.portable-v2-qemu-boot-proof-result/1"
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DISK_BYTES = 3 * 1024 * 1024 * 1024
ESP_BYTES = 512 * 1024 * 1024
SUCCESS = "ORDAX_PORTABLE_V2_HANDOFF=VERIFIED"
STABLE = "ORDAX_STABLE_INIT_HANDOFF=VERIFIED"
ACTIVATION_DURABLE = "ORDAX_PORTABLE_ACTIVATION_STATE_DURABLE=YES"


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


def capture(argv: list[str]) -> str:
    return run(argv).stdout.decode("utf-8", "replace").strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular(path: Path, label: str, *, minimum: int = 1) -> Path:
    absolute = path.resolve()
    if str(absolute).startswith("/dev/"):
        raise ProofError(f"{label} must never be a device path")
    try:
        info = absolute.lstat()
    except OSError as exc:
        raise ProofError(f"cannot stat {label}: {exc}") from exc
    if (
        stat.S_ISLNK(info.st_mode)
        or not stat.S_ISREG(info.st_mode)
        or info.st_nlink != 1
        or info.st_size < minimum
    ):
        raise ProofError(f"{label} must be a regular non-symlink single-link file")
    return absolute


def real_dir(path: Path, label: str) -> Path:
    absolute = path.resolve()
    try:
        info = absolute.lstat()
    except OSError as exc:
        raise ProofError(f"cannot stat {label}: {exc}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISDIR(info.st_mode):
        raise ProofError(f"{label} must be a real directory")
    return absolute


def load_json(path: Path, label: str) -> dict[str, Any]:
    path = regular(path, label)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ProofError(f"{label} must be a JSON object")
    return value


def require_programs() -> None:
    names = (
        "sgdisk", "losetup", "mkfs.vfat", "mkfs.exfat", "mount.exfat-fuse",
        "mount", "umount", "qemu-system-x86_64", "e2fsck",
    )
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        raise ProofError("missing portable-v2 QEMU proof programs: " + ", ".join(missing))


def wait_block(
    path: Path,
    timeout: float = 10.0,
    *,
    stable_for: float = 0.75,
) -> None:
    """Wait until one loop partition node is continuously stable.

    GitHub runners can reuse /dev/loopN quickly enough that a stale partition
    node from the previous attachment is briefly observable while udev removes
    it. A single is_block_device() observation can therefore race with mkfs.
    Require the same block-device identity to remain present continuously
    before returning instead of adding an unconditional sleep.
    """
    if stable_for <= 0 or stable_for >= timeout:
        raise ValueError("stable_for must be positive and smaller than timeout")

    deadline = time.monotonic() + timeout
    stable_since: float | None = None
    stable_rdev: int | None = None
    while time.monotonic() < deadline:
        now = time.monotonic()
        try:
            info = path.stat()
            if stat.S_ISBLK(info.st_mode):
                if stable_rdev != info.st_rdev:
                    stable_rdev = info.st_rdev
                    stable_since = now
                elif stable_since is not None and now - stable_since >= stable_for:
                    return
            else:
                stable_since = None
                stable_rdev = None
        except OSError:
            stable_since = None
            stable_rdev = None
        time.sleep(0.05)
    raise ProofError(f"loop partition did not become stable: {path}")


def unmount(path: Path) -> None:
    subprocess.run(
        ["umount", "-l", str(path)],
        check=False,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )


def validate_portable_release(
    portable: Path,
    commit: str,
    *,
    label: str,
) -> dict[str, Any]:
    if COMMIT_RE.fullmatch(commit) is None:
        raise ProofError(f"{label} commit must be lowercase 40-hex")

    release = portable / "releases" / commit
    if release.is_symlink() or not release.is_dir():
        raise ProofError(f"{label} release directory is missing")
    for name in (
        "system.erofs",
        "surface-runtime.sha256",
        "release-manifest.json",
        "release-envelope.json",
    ):
        regular(release / name, f"{label} release {name}", minimum=2)

    manifest = load_json(release / "release-manifest.json", f"{label} release manifest")
    schema = manifest.get("$schema")
    if schema not in {
        "prototype-ordax.release-manifest/3",
        "prototype-ordax.release-manifest/4",
    }:
        raise ProofError(f"{label} proof requires a signed release-manifest/3 or /4 release")
    schema_version = 4 if schema.endswith("/4") else 3
    if manifest.get("source_commit") != commit:
        raise ProofError(f"{label} manifest source commit differs from release directory")

    runtime_sha = (release / "surface-runtime.sha256").read_text(
        encoding="utf-8"
    ).strip()
    if SHA256_RE.fullmatch(runtime_sha) is None:
        raise ProofError(f"{label} Surface runtime reference is not lowercase SHA-256")
    runtime = regular(
        portable / "runtimes" / "sha256" / runtime_sha / "native-surface-runtime.erofs",
        f"{label} Surface runtime",
        minimum=4096,
    )
    if sha256_file(runtime) != runtime_sha:
        raise ProofError(f"{label} Surface runtime digest differs from release reference")

    artifacts = manifest.get("artifacts")
    expected_count = 3 if schema_version == 4 else 2
    if not isinstance(artifacts, list) or len(artifacts) != expected_count:
        raise ProofError(f"{label} release manifest artifact set is invalid")
    runtime_artifact = artifacts[1]
    if (
        not isinstance(runtime_artifact, dict)
        or runtime_artifact.get("name") != "native-surface-runtime.erofs"
        or runtime_artifact.get("role") != "surface-runtime"
        or runtime_artifact.get("sha256") != runtime_sha
    ):
        raise ProofError(f"{label} manifest runtime binding differs from materialized store")

    ai_runtime = None
    ai_runtime_sha = None
    if schema_version == 4:
        ai_ref = regular(
            release / "local-ai-runtime.sha256",
            f"{label} local AI runtime reference",
            minimum=64,
        )
        ai_runtime_sha = ai_ref.read_text(encoding="utf-8").strip()
        if SHA256_RE.fullmatch(ai_runtime_sha) is None:
            raise ProofError(f"{label} local AI runtime reference is not lowercase SHA-256")
        ai_runtime = regular(
            portable
            / "ai-runtimes"
            / "sha256"
            / ai_runtime_sha
            / "local-ai-runtime.erofs",
            f"{label} local AI runtime",
            minimum=4096,
        )
        if sha256_file(ai_runtime) != ai_runtime_sha:
            raise ProofError(f"{label} local AI runtime digest differs from release reference")
        ai_artifact = artifacts[2]
        if (
            not isinstance(ai_artifact, dict)
            or ai_artifact.get("name") != "local-ai-runtime.erofs"
            or ai_artifact.get("role") != "local-ai-runtime"
            or ai_artifact.get("sha256") != ai_runtime_sha
        ):
            raise ProofError(f"{label} manifest local AI binding differs from materialized store")
        if not isinstance(manifest.get("local_ai"), dict):
            raise ProofError(f"{label} release-manifest/4 local_ai binding is missing")

    return {
        "commit": commit,
        "release": release,
        "manifest_schema": schema_version,
        "runtime": runtime,
        "runtime_sha256": runtime_sha,
        "ai_runtime": ai_runtime,
        "ai_runtime_sha256": ai_runtime_sha,
    }
def validate_inputs(args: argparse.Namespace) -> dict[str, Any]:
    if COMMIT_RE.fullmatch(args.source_commit) is None:
        raise ProofError("source commit must be lowercase 40-hex")
    kernel = regular(args.kernel, "kernel", minimum=1024 * 1024)
    initramfs = regular(args.initramfs, "pinned initramfs", minimum=1024)
    capsule = regular(args.capsule, "bootstrap capsule", minimum=4096)
    base = regular(args.stable_base, "Stable Base", minimum=4096)
    state = regular(args.state_image, "persistent-state image", minimum=16 * 1024 * 1024)
    trust = regular(args.trust, "release trust", minimum=2)
    portable = real_dir(args.portable_root, "portable release root")
    provenance = load_json(args.initramfs_provenance, "initramfs provenance")

    if provenance.get("$schema") != "prototype-ordax.initramfs-provenance/1":
        raise ProofError("unexpected initramfs provenance schema")
    if provenance.get("source_commit") != args.source_commit:
        raise ProofError("initramfs source commit differs from QEMU source")
    if provenance.get("promotable_to_physical") is not False:
        raise ProofError("pinned initramfs unexpectedly authorizes physical promotion")

    capsule_pin = provenance.get("portable_bootstrap_capsule_pin")
    base_pin = provenance.get("portable_stable_base_pin")
    if not isinstance(capsule_pin, dict) or capsule_pin.get("provided") is not True:
        raise ProofError("initramfs does not contain a real capsule pin")
    if not isinstance(base_pin, dict) or base_pin.get("provided") is not True:
        raise ProofError("initramfs does not contain a real Stable Base pin")
    if capsule_pin.get("sha256") != sha256_file(capsule):
        raise ProofError("initramfs capsule pin differs from staged capsule")
    if base_pin.get("sha256") != sha256_file(base):
        raise ProofError("initramfs Stable Base pin differs from staged base")
    if capsule_pin.get("pid1_enforced") is not False or base_pin.get("pid1_enforced") is not False:
        raise ProofError("candidate pin provenance crossed its promotion boundary")

    candidate = validate_portable_release(
        portable,
        args.source_commit,
        label="candidate",
    )
    previous = None
    previous_commit = getattr(args, "previous_commit", None)
    if previous_commit:
        if previous_commit == args.source_commit:
            raise ProofError("previous commit must differ from candidate source commit")
        previous = validate_portable_release(
            portable,
            previous_commit,
            label="previous",
        )
        if previous["runtime_sha256"] != candidate["runtime_sha256"]:
            raise ProofError(
                "one-shot proof requires candidate and previous releases to reuse "
                "the exact content-addressed Surface runtime"
            )

    return {
        "kernel": kernel,
        "initramfs": initramfs,
        "capsule": capsule,
        "stable_base": base,
        "state_image": state,
        "trust": trust,
        "portable_root": portable,
        "runtime": candidate["runtime"],
        "runtime_sha256": candidate["runtime_sha256"],
        "ai_runtime": candidate["ai_runtime"],
        "ai_runtime_sha256": candidate["ai_runtime_sha256"],
        "manifest_schema": candidate["manifest_schema"],
        "candidate_release": candidate["release"],
        "candidate": candidate,
        "previous_release": previous["release"] if previous else None,
        "previous_commit": previous["commit"] if previous else None,
        "previous": previous,
        "provenance": provenance,
    }


def stage_disk(args: argparse.Namespace, inputs: dict[str, Any], work: Path) -> Path:
    disk = work / "portable-v2-qemu.raw"
    with disk.open("wb") as handle:
        handle.truncate(DISK_BYTES)
    regular(disk, "disposable guest disk", minimum=DISK_BYTES)

    run(["sgdisk", "--zap-all", str(disk)])
    run([
        "sgdisk",
        "--new=1:2048:+512M",
        "--typecode=1:c12a7328-f81f-11d2-ba4b-00a0c93ec93b",
        "--change-name=1:ORDAX-ESP",
        str(disk),
    ])
    run([
        "sgdisk",
        "--new=2:0:0",
        "--typecode=2:ebd0a0a2-b9e5-4433-87c0-68b6b72699c7",
        "--change-name=2:ORDAX-DATA",
        str(disk),
    ])
    run(["sgdisk", "--verify", str(disk)])

    loop = ""
    esp_mounted = False
    data_mounted = False
    esp_mount = work / "esp"
    data_mount = work / "data"
    esp_mount.mkdir()
    data_mount.mkdir()
    try:
        loop = capture(["losetup", "--find", "--show", "--partscan", str(disk)])
        if not loop.startswith("/dev/loop"):
            raise ProofError("disposable guest disk did not map to a host loop device")
        esp = Path(loop + "p1")
        data = Path(loop + "p2")
        wait_block(esp)
        wait_block(data)
        # Revalidate each node immediately before its formatter. This closes
        # the stale-node removal race when a loop number is rapidly reused.
        wait_block(esp)
        run(["mkfs.vfat", "-F", "32", "-n", "ORDAX-ESP", str(esp)])
        wait_block(data)
        run(["mkfs.exfat", "-L", "ORDAX-DATA", str(data)])

        run(["mount", "-t", "vfat", "-o", "rw,umask=0022", str(esp), str(esp_mount)])
        esp_mounted = True
        capsule_target = esp_mount / "ordax/bootstrap/bootstrap.erofs"
        trust_target = esp_mount / "ordax/bootstrap/trust/release-ed25519.json"
        capsule_target.parent.mkdir(parents=True)
        trust_target.parent.mkdir(parents=True)
        shutil.copyfile(inputs["capsule"], capsule_target)
        shutil.copyfile(inputs["trust"], trust_target)

        run(["mount.exfat-fuse", str(data), str(data_mount)])
        data_mounted = True
        internal = data_mount / ".ordax"
        (internal / "base").mkdir(parents=True)
        (internal / "state").mkdir(parents=True)
        (internal / "releases").mkdir(parents=True)
        runtime_target = (
            internal
            / "runtimes"
            / "sha256"
            / inputs["runtime_sha256"]
        )
        runtime_target.mkdir(parents=True)
        shutil.copyfile(inputs["stable_base"], internal / "base/stable-base.erofs")
        shutil.copyfile(inputs["state_image"], internal / "state/persistent-state.img")
        shutil.copytree(
            inputs["candidate_release"],
            internal / "releases" / args.source_commit,
            symlinks=False,
        )
        if inputs["previous_release"] is not None:
            shutil.copytree(
                inputs["previous_release"],
                internal / "releases" / inputs["previous_commit"],
                symlinks=False,
            )
        shutil.copyfile(
            inputs["runtime"],
            runtime_target / "native-surface-runtime.erofs",
        )
        for release_info in (inputs["candidate"], inputs["previous"]):
            if release_info is None or release_info["ai_runtime"] is None:
                continue
            ai_target = (
                internal
                / "ai-runtimes"
                / "sha256"
                / release_info["ai_runtime_sha256"]
            )
            ai_target.mkdir(parents=True, exist_ok=True)
            destination = ai_target / "local-ai-runtime.erofs"
            if not destination.exists():
                shutil.copyfile(release_info["ai_runtime"], destination)
        os.sync()
    finally:
        if data_mounted:
            unmount(data_mount)
        if esp_mounted:
            unmount(esp_mount)
        if loop:
            run(["losetup", "-d", loop])

    return disk


def boot_qemu_expected(
    args: argparse.Namespace,
    inputs: dict[str, Any],
    disk: Path,
    work: Path,
    *,
    expected_slot: str,
    expected_commit: str,
    serial_name: str,
    required_post_marker: str | None = None,
    graphical_hardware: bool = False,
) -> tuple[str, dict[str, bool]]:
    if expected_slot not in {"candidate", "current", "known-good"}:
        raise ProofError("unexpected QEMU expected slot")
    if COMMIT_RE.fullmatch(expected_commit) is None:
        raise ProofError("unexpected QEMU expected source commit")
    if required_post_marker is not None and (
        not required_post_marker
        or "\n" in required_post_marker
        or "\r" in required_post_marker
    ):
        raise ProofError("unexpected QEMU required post marker")

    release_info = (
        inputs["candidate"]
        if expected_commit == inputs["candidate"]["commit"]
        else inputs["previous"]
        if inputs["previous"] is not None
        and expected_commit == inputs["previous"]["commit"]
        else None
    )
    if release_info is None:
        raise ProofError("expected QEMU release identity is not staged")

    schema_version = release_info["manifest_schema"]
    runtime_sha256 = release_info["runtime_sha256"]
    ai_runtime_sha256 = release_info["ai_runtime_sha256"]
    ai_required = schema_version == 4

    serial = work / serial_name
    stderr = work / (serial_name + ".stderr")
    command = [
        "qemu-system-x86_64",
        "-machine", "pc",
        "-accel", "tcg,thread=multi",
        "-m", "3072" if graphical_hardware else "1536",
        "-smp", "2",
        "-kernel", str(inputs["kernel"]),
        "-initrd", str(inputs["initramfs"]),
        "-append", "console=ttyS0 rdinit=/sbin/ordax-portable-init loglevel=6",
        "-drive", f"file={disk},format=raw,if=ide,index=0,media=disk,cache=directsync",
        "-display", "none",
        "-serial", f"file:{serial}",
        "-monitor", "none",
        "-net", "none",
        "-no-reboot",
    ]
    if graphical_hardware:
        # Use a real DRM/KMS device in the guest so Cage/Wayland/WebKit and
        # the normal Surface heartbeat path run unchanged. -display none only
        # suppresses a host UI window; it does not replace the guest graphics.
        command[command.index("-display"):command.index("-display")] = [
            "-vga", "virtio",
        ]

    with stderr.open("wb") as error_stream:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=error_stream,
        )
    try:
        source_marker = "ORDAX_PORTABLE_V2_SOURCE_SHA=" + expected_commit
        stable_source_marker = "ORDAX_STABLE_INIT_SOURCE_SHA=" + expected_commit
        slot_marker = "ORDAX_PORTABLE_V2_SLOT=" + expected_slot
        schema_marker = f"ORDAX_PORTABLE_RELEASE_MANIFEST_SCHEMA={schema_version}"
        runtime_marker = "ORDAX_SURFACE_RUNTIME_HANDOFF=VERIFIED"
        runtime_sha_marker = "ORDAX_SURFACE_RUNTIME_SHA256=" + runtime_sha256
        ai_marker = "ORDAX_LOCAL_AI_RUNTIME_HANDOFF=VERIFIED"
        ai_backend_marker = "ORDAX_LOCAL_AI_BACKEND=STARTED"
        ai_sha_marker = (
            "ORDAX_LOCAL_AI_RUNTIME_SHA256=" + ai_runtime_sha256
            if ai_runtime_sha256
            else ""
        )

        def observe(text: str) -> tuple[bool, dict[str, bool]]:
            ai_ok = not ai_required or (
                ai_marker in text
                and bool(ai_sha_marker)
                and ai_sha_marker in text
                and ai_backend_marker in text
            )
            checks = {
                "portable_pid1_handoff_marker": SUCCESS in text,
                "stable_init_handoff_marker": STABLE in text,
                "activation_state_durable_marker": ACTIVATION_DURABLE in text,
                "qemu_network_disabled": "-net" in command and "none" in command,
                "qemu_durable_cache_mode": any(
                    "cache=directsync" in item for item in command
                ),
                "qemu_graphical_hardware_requested": (
                    (not graphical_hardware)
                    or ("-vga" in command and "virtio" in command)
                ),
                "candidate_rdinit_used": any(
                    "rdinit=/sbin/ordax-portable-init" in item for item in command
                ),
                "expected_slot_selected": slot_marker in text,
                "portable_source_sha_exact": source_marker in text,
                "stable_init_source_sha_exact": stable_source_marker in text,
                "portable_manifest_selected": schema_marker in text,
                "surface_runtime_handoff_marker": runtime_marker in text,
                "surface_runtime_sha_exact": runtime_sha_marker in text,
                "local_ai_runtime_requirement_satisfied": ai_ok,
                "local_ai_runtime_handoff_marker": (
                    ai_marker in text
                ) if ai_required else True,
                "local_ai_runtime_sha_exact": (
                    bool(ai_sha_marker) and ai_sha_marker in text
                ) if ai_required else True,
                "local_ai_backend_started": (
                    ai_backend_marker in text
                ) if ai_required else True,
                "required_post_marker_seen": (
                    required_post_marker is None
                    or required_post_marker in text
                ),
            }
            required = (
                checks["portable_pid1_handoff_marker"]
                and checks["stable_init_handoff_marker"]
                and checks["activation_state_durable_marker"]
                and checks["expected_slot_selected"]
                and checks["portable_source_sha_exact"]
                and checks["stable_init_source_sha_exact"]
                and checks["portable_manifest_selected"]
                and checks["surface_runtime_handoff_marker"]
                and checks["surface_runtime_sha_exact"]
                and checks["local_ai_runtime_requirement_satisfied"]
                and checks["required_post_marker_seen"]
            )
            return required, checks

        def finish_success(text: str, checks: dict[str, bool]) -> tuple[str, dict[str, bool]]:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)
            return text, checks

        deadline = time.monotonic() + (300.0 if graphical_hardware else 150.0)
        while time.monotonic() < deadline:
            text = serial.read_text(encoding="utf-8", errors="replace") if serial.exists() else ""
            ready, checks = observe(text)
            if ready:
                return finish_success(text, checks)
            if process.poll() is not None:
                break
            time.sleep(0.25)

        # A marker can be flushed between the final polling read and the
        # deadline check. Re-observe exactly once before declaring failure.
        # This does not extend or relax the proof: the same marker/identity
        # predicate is applied to the bytes already emitted by the guest.
        final_text = serial.read_text(encoding="utf-8", errors="replace") if serial.exists() else ""
        final_ready, final_checks = observe(final_text)
        if final_ready:
            return finish_success(final_text, final_checks)

        tail = stderr.read_text(encoding="utf-8", errors="replace")[-4000:] if stderr.exists() else ""
        serial_tail = final_text[-12000:]
        missing_checks = sorted(name for name, passed in final_checks.items() if not passed)
        raise ProofError(
            "QEMU did not reach portable-v2 handoff markers "
            f"(slot={expected_slot}, source={expected_commit}, schema={schema_version}, "
            f"post_marker={required_post_marker!r}, graphical_hardware={graphical_hardware}, "
            f"exit={process.poll()}, missing_checks={missing_checks!r}, "
            f"stderr_tail={tail!r}, serial_tail={serial_tail!r})"
        )
    finally:
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)

def boot_qemu(
    args: argparse.Namespace,
    inputs: dict[str, Any],
    disk: Path,
    work: Path,
) -> tuple[str, dict[str, bool]]:
    text, generic = boot_qemu_expected(
        args,
        inputs,
        disk,
        work,
        expected_slot="current",
        expected_commit=args.source_commit,
        serial_name="serial.log",
    )
    return text, {
        **generic,
        "current_slot_selected": generic["expected_slot_selected"],
    }


def prepare_state_inspection_copy(state_image: Path, state_copy: Path) -> None:
    """Replay only the committed journal on a disposable copy, never guest media.

    QEMU stops without a clean guest unmount after observing the durable marker.
    fsync commits ext4 transactions to the journal; noload alone can therefore
    expose stale or checksum-inconsistent metadata until that journal is replayed.
    General filesystem repair is deliberately forbidden here.
    """
    shutil.copyfile(state_image, state_copy)
    regular(state_copy, "persistent-state inspection copy")
    result = run(
        ["e2fsck", "-p", "-E", "journal_only", str(state_copy)], check=False
    )
    if result.returncode not in (0, 1):
        raise ProofError(
            f"inspection-copy journal replay failed ({result.returncode}): "
            f"{result.stderr.decode('utf-8', 'replace')}"
        )


def inspect_one_shot_state(
    disk: Path,
    work: Path,
    *,
    previous_commit: str,
    candidate_commit: str,
) -> dict[str, bool]:
    loop = ""
    data_mounted = False
    state_mounted = False
    data_mount = work / "inspect-data"
    state_mount = work / "inspect-state"
    data_mount.mkdir(exist_ok=True)
    state_mount.mkdir(exist_ok=True)
    try:
        loop = capture(["losetup", "--find", "--show", "--partscan", str(disk)])
        if not loop.startswith("/dev/loop"):
            raise ProofError("one-shot inspection did not map to a host loop device")
        data = Path(loop + "p2")
        wait_block(data)
        run(["mount.exfat-fuse", "-o", "ro", str(data), str(data_mount)])
        data_mounted = True
        state_image = regular(
            data_mount / ".ordax/state/persistent-state.img",
            "one-shot persistent-state image",
            minimum=16 * 1024 * 1024,
        )
        state_copy = work / "inspected-persistent-state.img"
        prepare_state_inspection_copy(state_image, state_copy)
        unmount(data_mount)
        data_mounted = False
        run(["mount", "-t", "ext4", "-o", "loop,ro,noload", str(state_copy), str(state_mount)])
        state_mounted = True
        release_state = state_mount / "ordax/portable-release"

        def slot_value(name: str) -> str | None:
            path = release_state / name
            if not path.exists():
                return None
            value = path.read_text(encoding="ascii").strip()
            if COMMIT_RE.fullmatch(value) is None:
                raise ProofError(f"final one-shot state has invalid {name} identity")
            return value

        current = slot_value("current")
        known_good = slot_value("known-good")
        rejected = slot_value("rejected")
        candidate = slot_value("candidate")
        transaction_present = (release_state / "activation-transaction.json").exists()
        checks = {
            "current_restored_to_previous": current == previous_commit,
            "known_good_preserved_as_previous": known_good == previous_commit,
            "candidate_persisted_as_rejected": rejected == candidate_commit,
            "candidate_file_removed": candidate is None,
            "activation_transaction_removed": not transaction_present,
        }
        if not all(checks.values()):
            raise ProofError(
                "final one-shot state mismatch: "
                f"current={current!r}, known_good={known_good!r}, "
                f"rejected={rejected!r}, candidate={candidate!r}, "
                f"activation_transaction_present={transaction_present}, checks={checks}"
            )
        return checks
    finally:
        if state_mounted:
            unmount(state_mount)
        if data_mounted:
            unmount(data_mount)
        if loop:
            run(["losetup", "-d", loop])



def prove(args: argparse.Namespace) -> dict[str, Any]:
    if os.name != "posix" or os.geteuid() != 0:
        raise ProofError("portable-v2 QEMU proof requires root on POSIX CI")
    require_programs()
    inputs = validate_inputs(args)
    work = Path(tempfile.mkdtemp(prefix="ordax-portable-v2-qemu-"))
    disk: Path | None = None
    checks = {
        "real_pinned_inputs_bound": True,
        "regular_sparse_guest_disk_only": False,
        "final_two_partition_layout": False,
        "portable_pid1_handoff_marker": False,
        "stable_init_handoff_marker": False,
        "activation_state_durable_marker": False,
        "qemu_network_disabled": False,
        "qemu_durable_cache_mode": False,
        "candidate_rdinit_used": False,
        "current_slot_selected": False,
        "portable_source_sha_exact": False,
        "stable_init_source_sha_exact": False,
        "portable_manifest_selected": False,
        "surface_runtime_handoff_marker": False,
        "surface_runtime_sha_exact": False,
        "local_ai_runtime_requirement_satisfied": False,
        "local_ai_runtime_handoff_marker": False,
        "local_ai_runtime_sha_exact": False,
        "local_ai_backend_started": False,
        "physical_target_device_untouched": True,
        "guest_disk_destroyed": False,
    }
    try:
        disk = stage_disk(args, inputs, work)
        checks["regular_sparse_guest_disk_only"] = True
        checks["final_two_partition_layout"] = True
        activation = None
        if args.previous_commit:
            first_serial, first_checks = boot_qemu_expected(
                args,
                inputs,
                disk,
                work,
                expected_slot="candidate",
                expected_commit=args.source_commit,
                serial_name="serial-candidate.log",
            )
            second_serial, second_checks = boot_qemu_expected(
                args,
                inputs,
                disk,
                work,
                expected_slot="current",
                expected_commit=args.previous_commit,
                serial_name="serial-fallback.log",
            )
            state_checks = inspect_one_shot_state(
                disk,
                work,
                previous_commit=args.previous_commit,
                candidate_commit=args.source_commit,
            )
            activation_checks = {
                "candidate_boot_selected_once": first_checks["expected_slot_selected"],
                "candidate_source_sha_exact": first_checks["portable_source_sha_exact"],
                "fallback_previous_selected": second_checks["expected_slot_selected"],
                "fallback_previous_source_sha_exact": second_checks["portable_source_sha_exact"],
                **state_checks,
            }
            if not all(activation_checks.values()):
                raise ProofError(
                    f"portable one-shot activation checks incomplete: {activation_checks}"
                )
            checks.update({
                "portable_pid1_handoff_marker": (
                    first_checks["portable_pid1_handoff_marker"]
                    and second_checks["portable_pid1_handoff_marker"]
                ),
                "stable_init_handoff_marker": (
                    first_checks["stable_init_handoff_marker"]
                    and second_checks["stable_init_handoff_marker"]
                ),
                "activation_state_durable_marker": (
                    first_checks["activation_state_durable_marker"]
                    and second_checks["activation_state_durable_marker"]
                ),
                "qemu_network_disabled": (
                    first_checks["qemu_network_disabled"]
                    and second_checks["qemu_network_disabled"]
                ),
                "qemu_durable_cache_mode": (
                    first_checks["qemu_durable_cache_mode"]
                    and second_checks["qemu_durable_cache_mode"]
                ),
                "candidate_rdinit_used": (
                    first_checks["candidate_rdinit_used"]
                    and second_checks["candidate_rdinit_used"]
                ),
                "current_slot_selected": second_checks["expected_slot_selected"],
                "portable_source_sha_exact": first_checks["portable_source_sha_exact"],
                "stable_init_source_sha_exact": (
                    first_checks["stable_init_source_sha_exact"]
                    and second_checks["stable_init_source_sha_exact"]
                ),
                "portable_manifest_selected": (
                    first_checks["portable_manifest_selected"]
                    and second_checks["portable_manifest_selected"]
                ),
                "surface_runtime_handoff_marker": (
                    first_checks["surface_runtime_handoff_marker"]
                    and second_checks["surface_runtime_handoff_marker"]
                ),
                "surface_runtime_sha_exact": (
                    first_checks["surface_runtime_sha_exact"]
                    and second_checks["surface_runtime_sha_exact"]
                ),
                "local_ai_runtime_requirement_satisfied": (
                    first_checks["local_ai_runtime_requirement_satisfied"]
                    and second_checks["local_ai_runtime_requirement_satisfied"]
                ),
                "local_ai_runtime_handoff_marker": (
                    first_checks["local_ai_runtime_handoff_marker"]
                    and second_checks["local_ai_runtime_handoff_marker"]
                ),
                "local_ai_runtime_sha_exact": (
                    first_checks["local_ai_runtime_sha_exact"]
                    and second_checks["local_ai_runtime_sha_exact"]
                ),
                "local_ai_backend_started": (
                    first_checks["local_ai_backend_started"]
                    and second_checks["local_ai_backend_started"]
                ),
            })
            serial_text = first_serial + "\n--- SECOND BOOT ---\n" + second_serial
            activation = {
                "proven": True,
                "candidate_commit": args.source_commit,
                "previous_commit": args.previous_commit,
                "candidate_boot_count": 1,
                "fallback_boot_count": 1,
                "cold_health_commit_proven": False,
                "failure_fallback_proven": True,
                "rejected_state_proven": True,
                "checks": activation_checks,
            }
        else:
            serial_text, qemu_checks = boot_qemu(args, inputs, disk, work)
            checks.update(qemu_checks)
        disk_sha = sha256_file(disk)
        disk.unlink()
        checks["guest_disk_destroyed"] = not disk.exists()
        if not all(checks.values()):
            raise ProofError(f"portable-v2 QEMU checks incomplete: {checks}")

        def markers_for(release_info: dict[str, Any], slot: str) -> list[str]:
            markers = [
                SUCCESS,
                STABLE,
                ACTIVATION_DURABLE,
                "ORDAX_PORTABLE_V2_SLOT=" + slot,
                "ORDAX_PORTABLE_V2_SOURCE_SHA=" + release_info["commit"],
                "ORDAX_STABLE_INIT_SOURCE_SHA=" + release_info["commit"],
                "ORDAX_PORTABLE_RELEASE_MANIFEST_SCHEMA=" + str(release_info["manifest_schema"]),
                "ORDAX_SURFACE_RUNTIME_HANDOFF=VERIFIED",
                "ORDAX_SURFACE_RUNTIME_SHA256=" + release_info["runtime_sha256"],
            ]
            if release_info["manifest_schema"] == 4:
                markers.extend([
                    "ORDAX_LOCAL_AI_RUNTIME_HANDOFF=VERIFIED",
                    "ORDAX_LOCAL_AI_RUNTIME_SHA256=" + release_info["ai_runtime_sha256"],
                    "ORDAX_LOCAL_AI_BACKEND=STARTED",
                ])
            return markers

        if activation:
            serial_markers = markers_for(inputs["candidate"], "candidate")
            serial_markers.extend(markers_for(inputs["previous"], "current"))
        else:
            serial_markers = markers_for(inputs["candidate"], "current")

        result = {
            "$schema": SCHEMA,
            "status": "pass",
            "source_commit": args.source_commit,
            "physical_target_device_touched": False,
            "host_loop_devices_used": True,
            "physical_write_authorized": False,
            "qemu_direct_kernel_boot_proven": True,
            "qemu_uefi_boot_proven": False,
            "physical_usb_boot_proven": False,
            "public_physical_promotion_allowed": False,
            "candidate_pid1_default_changed": False,
            "network_required_for_first_boot": False,
            "armed_candidate_one_shot_proven": bool(activation),
            "activation_one_shot": activation,
            "serial_markers": serial_markers,
            "guest_disk": {
                "sha256_before_destruction": disk_sha,
                "retained": False,
                "layout": ["ORDAX-ESP", "ORDAX-DATA"],
            },
            "artifacts": {
                "kernel_sha256": sha256_file(inputs["kernel"]),
                "initramfs_sha256": sha256_file(inputs["initramfs"]),
                "capsule_sha256": sha256_file(inputs["capsule"]),
                "stable_base_sha256": sha256_file(inputs["stable_base"]),
                "state_image_sha256": sha256_file(inputs["state_image"]),
                "surface_runtime_sha256": sha256_file(inputs["runtime"]),
                "release_manifest_schema": inputs["manifest_schema"],
                "local_ai_runtime_sha256": (
                    sha256_file(inputs["ai_runtime"])
                    if inputs["ai_runtime"] is not None
                    else None
                ),
            },
            "checks": checks,
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return result
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
    parser.add_argument("--previous-commit")
    parser.add_argument("--out", required=True, type=Path)
    args = parser.parse_args()
    for name in (
        "kernel", "initramfs", "initramfs_provenance", "capsule",
        "stable_base", "state_image", "portable_root", "trust", "out",
    ):
        setattr(args, name, getattr(args, name).resolve())
    try:
        result = prove(args)
    except (ProofError, OSError, json.JSONDecodeError, KeyError) as exc:
        print(f"portable-v2-qemu-boot-proof: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    print("PORTABLE_V2_QEMU_DIRECT_KERNEL_BOOT_PROOF=PASS")
    print("PORTABLE_V2_UEFI_BOOT_PROVEN=NO")
    print("PORTABLE_V2_PHYSICAL_BOOT_PROVEN=NO")
    print("PORTABLE_V2_PHYSICAL_WRITE_AUTHORIZED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
