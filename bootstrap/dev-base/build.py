#!/usr/bin/env python3
"""Git-first development base builder with firmware/runtime pruning policy."""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path

THIS_DIR = Path(__file__).resolve().parent


def _load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"could not load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BASE_DIR = THIS_DIR.parent / "base"
CORE = _load_module("ordax_alpine_base_core", BASE_DIR / "alpine_core.py")
POLICY = _load_module("ordax_base_firmware_policy", BASE_DIR / "firmware_policy.py")
RUNTIME_POLICY = _load_module("ordax_base_runtime_policy", BASE_DIR / "runtime_policy.py")

BuildError = CORE.BuildError
# Owner/Development recovery may stage this userspace into initramfs RAM and run
# `e2fsck -p` only while the ORDAX filesystem is unmounted. Stable/MVP does not
# inherit this package or this automatic repair authority.
PACKAGES = [*CORE.PACKAGES, "e2fsprogs"]
CORE.PACKAGES = PACKAGES
MAX_ROOTFS_BYTES = CORE.MAX_ROOTFS_BYTES
prune_firmware = CORE.prune_firmware

BUILD_ONLY_PACKAGES = RUNTIME_POLICY.BUILD_ONLY_PACKAGES
RUNTIME_PRUNE_PATHS = RUNTIME_POLICY.RUNTIME_PRUNE_PATHS


def required_firmware_names(rootfs: Path) -> set[str]:
    try:
        return POLICY.available_firmware_names(rootfs)
    except POLICY.FirmwareSelectionError as exc:
        raise BuildError(str(exc)) from exc


def verify_runtime_acquisition_client(rootfs: Path) -> None:
    """Keep only the tiny trusted client needed by runtime setup."""
    RUNTIME_POLICY.verify_runtime_acquisition_client(rootfs, BuildError)


def prune_build_only_runtime(rootfs: Path) -> None:
    """Remove build-only tooling while retaining the signed package client."""
    RUNTIME_POLICY.prune_build_only_runtime(
        rootfs,
        proot_rootfs=CORE.proot_rootfs,
        error_type=BuildError,
        log_prefix="ORDAX_DEV_BASE",
    )


def _prune_firmware_then_build_only_runtime(rootfs: Path, required: set[str]) -> None:
    # Firmware is shipped compressed by Alpine. Materialize it first while zstd
    # still exists, then remove zstd and package-manager metadata from the image.
    prune_firmware(rootfs, required)
    prune_build_only_runtime(rootfs)


def _verify_owner_repair_runtime(rootfs: Path) -> None:
    e2fsck = rootfs / "sbin/e2fsck"
    if not e2fsck.is_file() or not os.access(e2fsck, os.X_OK):
        raise BuildError("Owner/Development filesystem repair runtime is missing: /sbin/e2fsck")


_core_verify_rootfs = CORE.verify_rootfs


def _verify_rootfs_with_owner_repair(rootfs: Path) -> None:
    _core_verify_rootfs(rootfs)
    _verify_owner_repair_runtime(rootfs)


# The core builder resolves these symbols from its own module globals at runtime.
CORE.required_firmware_names = required_firmware_names
CORE.prune_firmware = _prune_firmware_then_build_only_runtime
CORE.verify_rootfs = _verify_rootfs_with_owner_repair


def main() -> int:
    return CORE.main()


if __name__ == "__main__":
    raise SystemExit(main())
