#!/usr/bin/env python3
"""Git-first development base builder with firmware/runtime pruning policy."""

from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
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
PACKAGES = CORE.PACKAGES
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


# Power transitions use a tiny static native kernel API helper. The Owner
# runtime never installs an alternative mount utility or downloads binaries.
# This is built from canonical source once, alongside the normal Dev Base.
_ORIGINAL_INSTALL_RUNTIME = CORE.install_runtime
_ORIGINAL_VERIFY_ROOTFS = CORE.verify_rootfs
_POWER_MOUNT_SOURCE = THIS_DIR / "ordax_usb_mountattr.c"
_POWER_MOUNT_TARGET = Path("usr/local/bin/ordax-usb-mountattr")


def _verify_power_mountattr_binary(rootfs: Path) -> None:
    target = rootfs / _POWER_MOUNT_TARGET
    if not target.is_file() or target.is_symlink() or not os.access(target, os.X_OK):
        raise BuildError("Owner USB native mountattr helper missing or unsafe")
    inspected = subprocess.run(
        ["readelf", "-l", str(target)],
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )
    if inspected.returncode != 0 or "INTERP" in inspected.stdout:
        raise BuildError("Owner USB mountattr helper is not a static executable")


def install_runtime(rootfs: Path, kernel_modules: Path) -> None:
    _ORIGINAL_INSTALL_RUNTIME(rootfs, kernel_modules)
    compiler = shutil.which("musl-gcc")
    if compiler is None or not _POWER_MOUNT_SOURCE.is_file() or _POWER_MOUNT_SOURCE.is_symlink():
        raise BuildError("Owner USB kernel mount helper source/compiler unavailable")
    destination = rootfs / _POWER_MOUNT_TARGET
    destination.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(
        [
            compiler, "-static", "-Os", "-s", "-Wall", "-Wextra", "-Werror",
            "-Wl,--build-id=none", "-ffile-prefix-map=" + str(THIS_DIR.parent.parent) + "=/ordax",
            "-o", str(destination), str(_POWER_MOUNT_SOURCE),
        ],
        capture_output=True,
        text=True,
        timeout=120,
        check=False,
    )
    if result.returncode != 0:
        raise BuildError("Owner USB native mountattr helper compilation failed: " + result.stderr[-1500:])
    destination.chmod(0o755)
    _verify_power_mountattr_binary(rootfs)


def verify_rootfs(rootfs: Path) -> None:
    _ORIGINAL_VERIFY_ROOTFS(rootfs)
    _verify_power_mountattr_binary(rootfs)


# The core builder resolves these symbols from its own module globals at runtime.
CORE.required_firmware_names = required_firmware_names
CORE.prune_firmware = _prune_firmware_then_build_only_runtime
CORE.install_runtime = install_runtime
CORE.verify_rootfs = verify_rootfs


def main() -> int:
    return CORE.main()


if __name__ == "__main__":
    raise SystemExit(main())
