#!/usr/bin/env python3
"""Resolve the Independent Surface Buildroot config from canonical OrdaX SSOTs.

The source defconfig intentionally does not duplicate the Linux header version.
This helper materializes the exact kernel-header binding from
bootstrap/kernel/source.json immediately before Buildroot resolves Kconfig.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = HERE / "source.json"
BASE_CONFIG = HERE / "configs/ordax_surface_defconfig"
KERNEL = ROOT / "bootstrap/kernel/source.json"

REQUIRED_RESOLVED = (
    "BR2_x86_64=y",
    "BR2_TOOLCHAIN_BUILDROOT_MUSL=y",
    "BR2_SHARED_LIBS=y",
    "BR2_KERNEL_HEADERS_VERSION=y",
    "BR2_PACKAGE_EUDEV=y",
    "BR2_PACKAGE_CAGE=y",
    "BR2_PACKAGE_WEBKITGTK=y",
    "BR2_PACKAGE_WEBKITGTK_WAYLAND=y",
    "BR2_PACKAGE_WEBKITGTK_HTTPS=y",
    "BR2_PACKAGE_WEBKITGTK_SANDBOX=y",
    "BR2_PACKAGE_WEBKITGTK_MULTIMEDIA=y",
    "BR2_PACKAGE_LIBGTK3=y",
    "BR2_PACKAGE_LIBGTK3_WAYLAND=y",
    "BR2_PACKAGE_PYTHON3=y",
    "BR2_PACKAGE_PYTHON_GOBJECT=y",
    "BR2_PACKAGE_XWAYLAND=y",
    "BR2_PACKAGE_SEATD=y",
)


class ConfigError(RuntimeError):
    pass


def load(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfigError(f"cannot read {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfigError(f"contract is not an object: {path}")
    return value


def kernel_version() -> str:
    source = load(SOURCE)
    kernel = load(KERNEL)
    expected = str(KERNEL.relative_to(ROOT))
    if source.get("kernel_source_contract") != expected:
        raise ConfigError("Independent Surface kernel source SSOT drift")
    if kernel.get("$schema") != "prototype-ordax.kernel-source/1":
        raise ConfigError("canonical kernel source schema mismatch")
    version = kernel.get("version", "")
    if not isinstance(version, str) or re.fullmatch(r"\d+\.\d+\.\d+", version) is None:
        raise ConfigError("canonical kernel version is invalid")
    return version


def rendered_config() -> str:
    if not BASE_CONFIG.is_file():
        raise ConfigError("Independent Surface base defconfig missing")
    text = BASE_CONFIG.read_text(encoding="utf-8")
    if "BR2_KERNEL_HEADERS_VERSION=" in text or "BR2_DEFAULT_KERNEL_VERSION=" in text:
        raise ConfigError("kernel header identity must not be duplicated in source defconfig")
    version = kernel_version()
    return text.rstrip() + "\nBR2_KERNEL_HEADERS_VERSION=y\n" + f'BR2_DEFAULT_KERNEL_VERSION="{version}"\n'


def materialize(destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = rendered_config()
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=destination.parent, delete=False) as handle:
        handle.write(payload)
        temporary = Path(handle.name)
    temporary.replace(destination)


def verify_resolved(config: Path) -> None:
    version = kernel_version()
    if not config.is_file():
        raise ConfigError(f"resolved Buildroot config missing: {config}")
    text = config.read_text(encoding="utf-8")
    expected_version = f'BR2_DEFAULT_KERNEL_VERSION="{version}"'
    missing = [marker for marker in (*REQUIRED_RESOLVED, expected_version) if marker not in text]
    if missing:
        raise ConfigError(f"resolved Buildroot config lost required Surface/kernel settings: {missing}")
    if "BR2_STATIC_LIBS=y" in text:
        raise ConfigError("resolved graphical Surface config became static-only")


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    render = sub.add_parser("materialize")
    render.add_argument("--out", type=Path, required=True)
    verify = sub.add_parser("verify-resolved")
    verify.add_argument("--config", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "check":
            rendered_config()
        elif args.command == "materialize":
            materialize(args.out)
        elif args.command == "verify-resolved":
            verify_resolved(args.config)
        return 0
    except ConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
