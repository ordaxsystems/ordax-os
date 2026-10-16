#!/usr/bin/env python3
"""Verify Independent Base kernel-module parity without claiming hardware support."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
KERNEL_SOURCE = ROOT / "bootstrap/kernel/source.json"
MODULE_HELPER = ROOT / "bootstrap/kernel/module_archive.py"
MATRIX = ROOT / "docs/contracts/hardware-support-matrix.json"
RECEIPT_IN_ROOTFS = "etc/ordax/kernel-module-selection.json"
SCHEMA = "prototype-ordax.independent-kernel-module-parity/1"
BASE_PROVENANCE_SCHEMA = "prototype-ordax.independent-base-provenance/1"


class ModuleParityError(RuntimeError):
    pass


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def load_helper():
    spec = importlib.util.spec_from_file_location("ordax_kernel_module_archive", MODULE_HELPER)
    if spec is None or spec.loader is None:
        raise ModuleParityError("cannot load neutral kernel module helper")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def normalized_member_name(name: str) -> str:
    path = PurePosixPath(name)
    if path.is_absolute() or ".." in path.parts:
        raise ModuleParityError(f"unsafe rootfs tar entry: {name!r}")
    parts = [part for part in path.parts if part not in ("", ".")]
    return "/".join(parts)


def load_json(path: Path, description: str) -> dict:
    if path.is_symlink() or not path.is_file():
        raise ModuleParityError(f"{description} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModuleParityError(f"cannot read {description}: {exc}") from exc
    if not isinstance(value, dict):
        raise ModuleParityError(f"{description} must be a JSON object")
    return value


def verify(*, kernel_modules: Path, selection_receipt: Path, rootfs_tar: Path) -> dict:
    helper = load_helper()
    kernel = load_json(KERNEL_SOURCE, "kernel source contract")
    receipt = load_json(selection_receipt, "kernel module selection receipt")
    policy = helper.load_wifi_policy(MATRIX)

    if kernel_modules.is_symlink() or not kernel_modules.is_file():
        raise ModuleParityError("kernel module archive is missing or unsafe")
    try:
        with tarfile.open(kernel_modules, "r") as archive:
            _, derived = helper.select_module_members(
                archive, set(policy["module_basenames"])
            )
    except (OSError, tarfile.TarError, helper.ModuleArchiveError) as exc:
        raise ModuleParityError(f"cannot derive kernel module selection: {exc}") from exc

    release = kernel.get("version")
    if not isinstance(release, str) or receipt.get("kernel_release") != release:
        raise ModuleParityError("kernel module release differs from canonical kernel source")
    for key in (
        "kernel_release",
        "requested_module_basenames",
        "selected_module_basenames",
        "selected_module_paths",
        "selected_module_count",
        "metadata",
    ):
        if receipt.get(key) != derived.get(key):
            raise ModuleParityError(f"kernel module selection receipt differs from archive: {key}")
    if receipt.get("archive_sha256") != digest(kernel_modules):
        raise ModuleParityError("kernel module archive digest differs from selection receipt")
    if receipt.get("policy_source") != str(MATRIX.relative_to(ROOT)):
        raise ModuleParityError("kernel module selection policy path drift")
    if receipt.get("policy_sha256") != digest(MATRIX):
        raise ModuleParityError("kernel module selection policy digest drift")
    if receipt.get("target") != "/lib/modules":
        raise ModuleParityError("kernel module target drift")
    if receipt.get("physical_support_claimed") is not False:
        raise ModuleParityError("module presence cannot claim physical hardware support")

    requested = receipt.get("requested_module_basenames")
    coldplug = receipt.get("coldplug_entrypoints")
    if requested != sorted(policy["module_basenames"]):
        raise ModuleParityError("requested Wi-Fi modules differ from hardware matrix")
    if coldplug != list(policy["coldplug_entrypoints"]):
        raise ModuleParityError("Wi-Fi coldplug entrypoints differ from hardware matrix")

    selected_paths = receipt["selected_module_paths"]
    selected_basenames = receipt["selected_module_basenames"]
    selected_count = receipt["selected_module_count"]
    metadata = receipt["metadata"]
    if not selected_paths or len(set(selected_paths)) != len(selected_paths):
        raise ModuleParityError("selected kernel module path receipt is invalid")
    for relative in selected_paths:
        path = PurePosixPath(relative)
        if path.is_absolute() or ".." in path.parts or not relative.startswith("kernel/"):
            raise ModuleParityError(f"unsafe selected kernel module path: {relative!r}")

    if rootfs_tar.is_symlink() or not rootfs_tar.is_file():
        raise ModuleParityError("rootfs tar is missing or unsafe")
    expected_module_files = {f"lib/modules/{release}/{relative}" for relative in selected_paths}
    expected_metadata = {f"lib/modules/{release}/{name}" for name in metadata}
    actual_module_files: set[str] = set()
    regular_files: dict[str, tarfile.TarInfo] = {}
    firmware_files: list[str] = []
    embedded_receipt: bytes | None = None
    selected_basename_set = set(selected_basenames)

    try:
        with tarfile.open(rootfs_tar, "r") as archive:
            for member in archive.getmembers():
                name = normalized_member_name(member.name)
                if not name:
                    continue
                if member.isdev() or member.isfifo():
                    raise ModuleParityError(f"unsafe rootfs tar object: {name}")
                if member.isfile():
                    if name in regular_files:
                        raise ModuleParityError(f"duplicate rootfs tar entry: {name}")
                    regular_files[name] = member
                    prefix = f"lib/modules/{release}/"
                    if name.startswith(prefix):
                        relative = name[len(prefix):]
                        if helper.module_basename(relative) in selected_basename_set:
                            actual_module_files.add(name)
                        elif relative.endswith((".ko", ".ko.gz", ".ko.xz", ".ko.zst")):
                            actual_module_files.add(name)
                    if name.startswith("lib/firmware/"):
                        firmware_files.append(name)
                    if name == RECEIPT_IN_ROOTFS:
                        stream = archive.extractfile(member)
                        if stream is None:
                            raise ModuleParityError("embedded module selection receipt is unreadable")
                        embedded_receipt = stream.read()
    except (OSError, tarfile.TarError) as exc:
        raise ModuleParityError(f"cannot inspect rootfs tar: {exc}") from exc

    if actual_module_files != expected_module_files:
        missing = sorted(expected_module_files - actual_module_files)
        extra = sorted(actual_module_files - expected_module_files)
        raise ModuleParityError(
            f"rootfs kernel module payload differs from receipt: missing={missing[:10]} extra={extra[:10]}"
        )
    missing_metadata = sorted(expected_metadata - regular_files.keys())
    if missing_metadata:
        raise ModuleParityError(f"rootfs kernel module metadata missing: {missing_metadata}")
    if firmware_files:
        raise ModuleParityError(f"firmware entered module-only parity slice: {firmware_files[:10]}")
    receipt_bytes = selection_receipt.read_bytes()
    if embedded_receipt is None or embedded_receipt != receipt_bytes:
        raise ModuleParityError("embedded kernel module selection receipt differs from external receipt")

    return {
        "$schema": SCHEMA,
        "kernel_release": release,
        "kernel_modules_sha256": digest(kernel_modules),
        "hardware_matrix_sha256": digest(MATRIX),
        "selection_receipt_sha256": digest(selection_receipt),
        "rootfs_tar_sha256": digest(rootfs_tar),
        "requested_module_basenames": requested,
        "selected_module_count": selected_count,
        "coldplug_entrypoints": coldplug,
        "firmware_files": 0,
        "physical_support_claimed": False,
    }


def bind_base_provenance(result: dict, *, base_provenance: Path, rootfs_tar: Path) -> dict:
    provenance = load_json(base_provenance, "Independent Base provenance")
    if provenance.get("$schema") != BASE_PROVENANCE_SCHEMA:
        raise ModuleParityError("Independent Base provenance schema mismatch")
    if provenance.get("physical_artifact_authorized") is not False:
        raise ModuleParityError("Independent Base provenance unexpectedly authorizes physical promotion")
    if provenance.get("kernel_source_version") != result.get("kernel_release"):
        raise ModuleParityError("Independent Base kernel identity differs from module parity")
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict):
        raise ModuleParityError("Independent Base provenance artifacts are missing")
    rootfs_sha256 = digest(rootfs_tar)
    if artifacts.get("rootfs.tar") != rootfs_sha256:
        raise ModuleParityError("Independent Base provenance is not bound to the verified rootfs tar")
    if result.get("rootfs_tar_sha256") != rootfs_sha256:
        raise ModuleParityError("module parity rootfs digest drift")
    bound = dict(result)
    bound["base_provenance_sha256"] = digest(base_provenance)
    bound["base_source_commit"] = provenance.get("source_commit")
    bound["base_rootfs_tar_sha256"] = rootfs_sha256
    return bound


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("verify",))
    parser.add_argument("--kernel-modules", type=Path, required=True)
    parser.add_argument("--selection-receipt", type=Path, required=True)
    parser.add_argument("--rootfs-tar", type=Path, required=True)
    parser.add_argument("--base-provenance", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = verify(
            kernel_modules=args.kernel_modules,
            selection_receipt=args.selection_receipt,
            rootfs_tar=args.rootfs_tar,
        )
        result = bind_base_provenance(
            result,
            base_provenance=args.base_provenance,
            rootfs_tar=args.rootfs_tar,
        )
        if args.out.exists() or args.out.is_symlink():
            raise ModuleParityError("module parity output must not already exist")
        if not args.out.parent.is_dir() or args.out.parent.is_symlink():
            raise ModuleParityError("module parity output parent is missing or unsafe")
        args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        print(json.dumps(result, sort_keys=True))
        return 0
    except (ModuleParityError, OSError, ValueError) as exc:
        print(f"ordax-independent-module-parity: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
