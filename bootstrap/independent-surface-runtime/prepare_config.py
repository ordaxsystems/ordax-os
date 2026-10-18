#!/usr/bin/env python3
"""Resolve the Independent Surface Buildroot config from canonical OrdaX SSOTs.

The source defconfig intentionally does not duplicate the Linux header version.
This helper materializes the exact kernel-header binding from
bootstrap/kernel/source.json immediately before Buildroot resolves Kconfig, and
can preflight the resolved Kconfig before the expensive graphical compilation.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import shutil
import sys
import tempfile

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
SOURCE = HERE / "source.json"
BASE_CONFIG = HERE / "configs/ordax_surface_defconfig"
KERNEL = ROOT / "bootstrap/kernel/source.json"
BUILDER = HERE / "build.py"

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


def load_builder():
    spec = importlib.util.spec_from_file_location("ordax_independent_surface_builder", BUILDER)
    if spec is None or spec.loader is None:
        raise ConfigError("cannot load Independent Surface builder")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


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


def kernel_series_symbol(version: str) -> str:
    major, minor, _ = version.split(".")
    return f"BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_{major}_{minor}=y"


def rendered_config() -> str:
    if not BASE_CONFIG.is_file():
        raise ConfigError("Independent Surface base defconfig missing")
    text = BASE_CONFIG.read_text(encoding="utf-8")
    if (
        "BR2_KERNEL_HEADERS_VERSION=" in text
        or "BR2_DEFAULT_KERNEL_VERSION=" in text
        or "BR2_PACKAGE_HOST_LINUX_HEADERS_CUSTOM_" in text
    ):
        raise ConfigError("kernel header identity must not be duplicated in source defconfig")
    version = kernel_version()
    series = kernel_series_symbol(version)
    return (
        text.rstrip()
        + "\nBR2_KERNEL_HEADERS_VERSION=y\n"
        + f'BR2_DEFAULT_KERNEL_VERSION="{version}"\n'
        + series
        + "\n"
    )


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
    # The builder owns Kconfig parsing. A commented-out or duplicated option
    # must never count as an active build dependency in either verification.
    builder = load_builder()
    try:
        settings = builder.resolved_kconfig(config)
    except builder.SurfaceBuildError as exc:
        raise ConfigError(f"invalid resolved Buildroot Kconfig: {exc}") from exc
    expected_version = f'BR2_DEFAULT_KERNEL_VERSION="{version}"'
    series = kernel_series_symbol(version)
    markers = (
        *builder.GRAPHICAL_KCONFIG_REQUIRED,
        "BR2_KERNEL_HEADERS_VERSION=y",
        expected_version,
        series,
    )
    missing = [
        marker for marker in markers
        if settings.get(marker.split("=", 1)[0]) != marker.split("=", 1)[1]
    ]
    if missing:
        raise ConfigError(f"resolved Buildroot config lost required Surface/kernel settings: {missing}")
    if settings.get("BR2_STATIC_LIBS") == "y":
        raise ConfigError("resolved graphical Surface config became static-only")


def preflight(cache: Path) -> None:
    """Resolve the exact Buildroot Kconfig without compiling the graphical stack."""
    if not BASE_CONFIG.is_file():
        raise ConfigError("materialized Surface defconfig is missing")
    text = BASE_CONFIG.read_text(encoding="utf-8")
    version = kernel_version()
    series = kernel_series_symbol(version)
    if (
        "BR2_KERNEL_HEADERS_VERSION=y" not in text
        or f'BR2_DEFAULT_KERNEL_VERSION="{version}"' not in text
        or series not in text
    ):
        raise ConfigError("Surface defconfig was not materialized from canonical kernel SSOT")

    builder = load_builder()
    try:
        _, base = builder.contracts()
        cache = cache.resolve()
        cache.mkdir(parents=True, exist_ok=True)
        work = Path(tempfile.mkdtemp(prefix="ordax-surface-kconfig-preflight-"))
        try:
            archive = builder.source_archive(base, cache)
            buildroot = base["buildroot"]
            tree = builder.safe_unpack(archive, work, buildroot["version"])
            build_dir = work / "build"
            builder.run([
                "make", "-C", str(tree), f"O={build_dir}",
                f"BR2_DEFCONFIG={BASE_CONFIG}", "defconfig",
            ])
            verify_resolved(build_dir / ".config")
        finally:
            shutil.rmtree(work, ignore_errors=True)
    except ConfigError:
        raise
    except Exception as exc:
        raise ConfigError(f"Buildroot Surface Kconfig preflight failed: {exc}") from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    render = sub.add_parser("materialize")
    render.add_argument("--out", type=Path, required=True)
    verify = sub.add_parser("verify-resolved")
    verify.add_argument("--config", type=Path, required=True)
    preflight_parser = sub.add_parser("preflight")
    preflight_parser.add_argument("--cache", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.command == "check":
            rendered_config()
        elif args.command == "materialize":
            materialize(args.out)
        elif args.command == "verify-resolved":
            verify_resolved(args.config)
        elif args.command == "preflight":
            preflight(args.cache)
        return 0
    except ConfigError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
