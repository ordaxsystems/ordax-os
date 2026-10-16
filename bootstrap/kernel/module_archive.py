#!/usr/bin/env python3
"""Distribution-neutral selection of verified OrdaX kernel modules.

This module owns only the kernel-module archive boundary. It deliberately knows
nothing about Alpine/APK, Buildroot, firmware packaging, physical USB writing or
hardware promotion. Consumers provide the already-verified kernel module
archive and a target root; this helper selects the exact requested modules plus
the dependency closure described by modules.dep and the release metadata needed
by modprobe.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

ROOT = Path(__file__).resolve().parents[2]
HARDWARE_MATRIX = ROOT / "docs/contracts/hardware-support-matrix.json"
MATRIX_SCHEMA = "prototype-ordax.hardware-support-matrix/1"
SAFE_RELEASE = re.compile(r"^[A-Za-z0-9._+-]+$")


class ModuleArchiveError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def module_basename(path: str) -> str:
    name = PurePosixPath(path).name
    for suffix in (".zst", ".xz", ".gz"):
        if name.endswith(suffix):
            name = name[: -len(suffix)]
            break
    if name.endswith(".ko"):
        name = name[:-3]
    return name.replace("-", "_")


def _safe_member_name(name: str) -> PurePosixPath:
    path = PurePosixPath(name)
    if not name or path.is_absolute() or ".." in path.parts:
        raise ModuleArchiveError(f"unsafe kernel-module archive entry: {name!r}")
    return path


def load_wifi_policy(matrix_path: Path = HARDWARE_MATRIX) -> dict:
    try:
        value = json.loads(matrix_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ModuleArchiveError(f"cannot read hardware support matrix: {exc}") from exc
    if value.get("$schema") != MATRIX_SCHEMA:
        raise ModuleArchiveError("unexpected hardware support matrix schema")
    if value.get("architecture") != "x86_64":
        raise ModuleArchiveError("Independent Base kernel module policy requires x86_64 matrix")
    policy = value.get("support_claim_policy")
    if not isinstance(policy, dict) or policy.get("driver_present_is_supported_hardware_claim") is not False:
        raise ModuleArchiveError("hardware support claim policy drifted")

    matches = [
        item
        for item in value.get("required_mvp_capabilities", [])
        if isinstance(item, dict) and item.get("id") == "wifi-after-base-start"
    ]
    if len(matches) != 1:
        raise ModuleArchiveError("hardware matrix must contain exactly one Wi-Fi capability")
    wifi = matches[0]
    modules = wifi.get("module_basenames")
    coldplug = wifi.get("coldplug_entrypoints")
    if not isinstance(modules, list) or not modules:
        raise ModuleArchiveError("Wi-Fi module basename policy is missing")
    if not isinstance(coldplug, list) or not coldplug:
        raise ModuleArchiveError("Wi-Fi coldplug policy is missing")
    if any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9_+-]+", item) for item in modules):
        raise ModuleArchiveError("Wi-Fi module basename policy contains an invalid name")
    if any(not isinstance(item, str) or not re.fullmatch(r"[A-Za-z0-9_+-]+", item) for item in coldplug):
        raise ModuleArchiveError("Wi-Fi coldplug policy contains an invalid name")
    if len(set(modules)) != len(modules) or len(set(coldplug)) != len(coldplug):
        raise ModuleArchiveError("Wi-Fi module policy contains duplicates")
    if not set(coldplug).issubset(set(modules)):
        raise ModuleArchiveError("Wi-Fi coldplug entrypoints must be a subset of packaged modules")
    return {
        "module_basenames": tuple(modules),
        "coldplug_entrypoints": tuple(coldplug),
        "claim_limit": str(wifi.get("claim_limit", "")),
    }


def _regular_members(archive: tarfile.TarFile) -> dict[str, tarfile.TarInfo]:
    regular: dict[str, tarfile.TarInfo] = {}
    for member in archive.getmembers():
        _safe_member_name(member.name)
        if member.isdev() or member.isfifo():
            raise ModuleArchiveError(f"unsafe kernel-module archive object: {member.name}")
        if member.isfile():
            if member.name in regular:
                raise ModuleArchiveError(f"duplicate kernel-module archive entry: {member.name}")
            regular[member.name] = member
    return regular


def select_module_members(
    archive: tarfile.TarFile,
    target_basenames: set[str],
) -> tuple[list[tarfile.TarInfo], dict]:
    if not target_basenames or any(
        not isinstance(name, str) or not re.fullmatch(r"[A-Za-z0-9_+-]+", name)
        for name in target_basenames
    ):
        raise ModuleArchiveError("requested kernel module basenames are invalid")

    regular = _regular_members(archive)
    dep_names = [
        name
        for name in regular
        if name.startswith("lib/modules/") and name.endswith("/modules.dep")
    ]
    if len(dep_names) != 1:
        raise ModuleArchiveError(
            f"kernel modules archive must contain one modules.dep, found {len(dep_names)}"
        )

    dep_name = dep_names[0]
    prefix = dep_name[: -len("modules.dep")]
    release = PurePosixPath(prefix.rstrip("/")).name
    if not SAFE_RELEASE.fullmatch(release):
        raise ModuleArchiveError("kernel module archive release identity is invalid")
    dep_file = archive.extractfile(regular[dep_name])
    if dep_file is None:
        raise ModuleArchiveError("could not read modules.dep")
    try:
        lines = dep_file.read().decode("utf-8").splitlines()
    except UnicodeDecodeError as exc:
        raise ModuleArchiveError("modules.dep is not valid UTF-8") from exc

    dependencies: dict[str, list[str]] = {}
    for raw_line in lines:
        if not raw_line.strip():
            continue
        module_path, separator, dependency_text = raw_line.partition(":")
        if not separator:
            raise ModuleArchiveError(f"invalid modules.dep entry: {raw_line}")
        module_path = module_path.strip()
        _safe_member_name(module_path)
        if module_path in dependencies:
            raise ModuleArchiveError(f"duplicate modules.dep entry: {module_path}")
        dependency_paths = dependency_text.split()
        for dependency in dependency_paths:
            _safe_member_name(dependency)
        dependencies[module_path] = dependency_paths

    targets: dict[str, str] = {}
    for module_path in dependencies:
        basename = module_basename(module_path)
        if basename in target_basenames:
            if basename in targets and targets[basename] != module_path:
                raise ModuleArchiveError(f"ambiguous module basename in archive: {basename}")
            targets[basename] = module_path
    missing = sorted(target_basenames - targets.keys())
    if missing:
        raise ModuleArchiveError(f"required kernel modules missing from archive: {missing}")

    selected_paths = set(targets.values())
    pending = list(selected_paths)
    while pending:
        module_path = pending.pop()
        for dependency in dependencies.get(module_path, []):
            if dependency not in dependencies:
                raise ModuleArchiveError(
                    f"dependency metadata missing for {module_path}: {dependency}"
                )
            if dependency not in selected_paths:
                selected_paths.add(dependency)
                pending.append(dependency)

    selected_names = {prefix + path for path in selected_paths}
    metadata_names = {
        name
        for name in regular
        if name.startswith(prefix)
        and "/" not in name[len(prefix):]
        and PurePosixPath(name).name.startswith("modules.")
    }
    selected_names.update(metadata_names)
    missing_files = sorted(name for name in selected_names if name not in regular)
    if missing_files:
        raise ModuleArchiveError(
            f"kernel module files missing from archive: {missing_files[:10]}"
        )

    receipt = {
        "kernel_release": release,
        "requested_module_basenames": sorted(target_basenames),
        "selected_module_basenames": sorted(module_basename(path) for path in selected_paths),
        "selected_module_paths": sorted(selected_paths),
        "selected_module_count": len(selected_paths),
        "metadata": sorted(PurePosixPath(name).name for name in metadata_names),
    }
    return [regular[name] for name in sorted(selected_names)], receipt


def install_module_subset(
    archive_path: Path,
    target_root: Path,
    target_basenames: set[str],
) -> dict:
    if archive_path.is_symlink() or not archive_path.is_file():
        raise ModuleArchiveError("kernel modules archive is missing or unsafe")
    if target_root.is_symlink() or not target_root.is_dir():
        raise ModuleArchiveError("kernel module target root is missing or unsafe")
    with tarfile.open(archive_path, "r") as archive:
        members, receipt = select_module_members(archive, target_basenames)
        archive.extractall(target_root, members=members, filter="data")
    receipt["archive_sha256"] = sha256_file(archive_path)
    receipt["target"] = "/lib/modules"
    return receipt


def install_matrix_wifi_modules(
    archive_path: Path,
    target_root: Path,
    matrix_path: Path = HARDWARE_MATRIX,
) -> dict:
    policy = load_wifi_policy(matrix_path)
    receipt = install_module_subset(
        archive_path,
        target_root,
        set(policy["module_basenames"]),
    )
    receipt["policy_source"] = str(matrix_path.resolve().relative_to(ROOT.resolve()))
    receipt["policy_sha256"] = sha256_file(matrix_path)
    receipt["coldplug_entrypoints"] = list(policy["coldplug_entrypoints"])
    receipt["physical_support_claimed"] = False
    return receipt


def write_receipt(path: Path, receipt: dict) -> None:
    if path.is_symlink():
        raise ModuleArchiveError("kernel module receipt path is unsafe")
    if not path.parent.is_dir() or path.parent.is_symlink():
        raise ModuleArchiveError("kernel module receipt parent is missing or unsafe")
    path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="action", required=True)
    install = subparsers.add_parser("install-wifi")
    install.add_argument("--archive", type=Path, required=True)
    install.add_argument("--target", type=Path, required=True)
    install.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.action != "install-wifi":
            raise ModuleArchiveError("unsupported kernel module archive action")
        if args.receipt.exists():
            raise ModuleArchiveError("kernel module receipt already exists")
        receipt = install_matrix_wifi_modules(args.archive, args.target)
        write_receipt(args.receipt, receipt)
        print(json.dumps(receipt, sort_keys=True))
        return 0
    except (ModuleArchiveError, OSError, tarfile.TarError, ValueError) as exc:
        print(f"ordax-kernel-module-archive: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
