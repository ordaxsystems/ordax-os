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


# The canonical Dev Base ships small statically linked kernel UAPI helpers.
# They are build outputs, not runtime APK/Buildroot downloads or parallel services.
_ORIGINAL_INSTALL_RUNTIME = CORE.install_runtime
_ORIGINAL_VERIFY_ROOTFS = CORE.verify_rootfs
_NATIVE_HELPERS = (
    (THIS_DIR / "ordax_usb_mountattr.c", Path("usr/local/bin/ordax-usb-mountattr")),
    (THIS_DIR / "ordax_checkout_exchange.c", Path("usr/local/bin/ordax-checkout-exchange")),
)
# Reuse exact kernel UAPI exported by the fixed-initramfs builder. No
# mixed glibc/musl headers, host-architecture substitution or build fallback.
_OWNER_KERNEL_UAPI = THIS_DIR.parent.parent / "out/initramfs-work/kernel-uapi-install/include"


def _verify_native_helpers(rootfs: Path) -> None:
    for _, relative in _NATIVE_HELPERS:
        target = rootfs / relative
        if not target.is_file() or target.is_symlink() or not os.access(target, os.X_OK):
            raise BuildError(f"Owner USB native helper missing or unsafe: {relative}")
        inspected = subprocess.run(
            ["readelf", "-l", str(target)],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
        if inspected.returncode != 0 or "INTERP" in inspected.stdout:
            raise BuildError(f"Owner USB helper is not a static executable: {relative}")


def install_runtime(rootfs: Path, kernel_modules: Path) -> None:
    _ORIGINAL_INSTALL_RUNTIME(rootfs, kernel_modules)
    compiler = shutil.which("musl-gcc")
    if compiler is None or any(not source.is_file() or source.is_symlink()
                               for source, _ in _NATIVE_HELPERS):
        raise BuildError("Owner USB native helpers or static musl compiler unavailable")
    if (_OWNER_KERNEL_UAPI.is_symlink() or
            not (_OWNER_KERNEL_UAPI / "linux/mount.h").is_file() or
            not (_OWNER_KERNEL_UAPI / "linux/fs.h").is_file()):
        raise BuildError("Owner USB native helpers require canonical exported kernel UAPI")
    for source, relative in _NATIVE_HELPERS:
        destination = rootfs / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        result = subprocess.run(
            [
                compiler, "-static", "-Os", "-s", "-Wall", "-Wextra", "-Werror",
                "-Wl,--build-id=none", "-ffile-prefix-map=" + str(THIS_DIR.parent.parent) + "=/ordax",
                "-I" + str(_OWNER_KERNEL_UAPI),
                "-o", str(destination), str(source),
            ],
            capture_output=True,
            text=True,
            timeout=120,
            check=False,
        )
        if result.returncode != 0:
            raise BuildError("Owner USB native helper compilation failed: "
                             + str(relative) + ": " + result.stderr[-1500:])
        destination.chmod(0o755)
    _verify_native_helpers(rootfs)


def verify_rootfs(rootfs: Path) -> None:
    _ORIGINAL_VERIFY_ROOTFS(rootfs)
    _verify_native_helpers(rootfs)


# The core builder resolves these symbols from its own module globals at runtime.
CORE.required_firmware_names = required_firmware_names
CORE.prune_firmware = _prune_firmware_then_build_only_runtime
CORE.install_runtime = install_runtime
CORE.verify_rootfs = verify_rootfs


def main() -> int:
    return CORE.main()


if __name__ == "__main__":
    raise SystemExit(main())
