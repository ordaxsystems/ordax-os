#!/usr/bin/env python3
"""Distribution-neutral OrdaX kernel-module payload selector.

The canonical kernel build owns the complete module archive. This helper selects
only the hardware baseline requested by docs/contracts/hardware-support-matrix.json
and delegates dependency resolution to kmod/modprobe using the archive's own
modules.dep metadata. It never builds a kernel, downloads modules, or owns a
second hardware-support list.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tarfile
import tempfile

ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MATRIX = ROOT / "docs/contracts/hardware-support-matrix.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_RELEASE_RE = re.compile(r"^[A-Za-z0-9._+-]+$")
SAFE_MODULE_RE = re.compile(r"^[A-Za-z0-9_+-]+$")


class KernelModulePayloadError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_wifi_policy(matrix_path: Path = DEFAULT_MATRIX) -> dict:
    try:
        value = json.loads(matrix_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise KernelModulePayloadError(f"cannot load hardware support matrix: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.hardware-support-matrix/1":
        raise KernelModulePayloadError("unexpected hardware support matrix schema")
    capabilities = value.get("required_mvp_capabilities")
    if not isinstance(capabilities, list):
        raise KernelModulePayloadError("hardware support matrix capabilities are missing")
    matches = [item for item in capabilities if isinstance(item, dict) and item.get("id") == "wifi-after-base-start"]
    if len(matches) != 1:
        raise KernelModulePayloadError("hardware matrix must define exactly one Wi-Fi baseline")
    wifi = matches[0]
    modules = wifi.get("module_basenames")
    coldplug = wifi.get("coldplug_entrypoints")
    if (
        not isinstance(modules, list)
        or not modules
        or len(modules) != len(set(modules))
        or any(not isinstance(name, str) or SAFE_MODULE_RE.fullmatch(name) is None for name in modules)
    ):
        raise KernelModulePayloadError("Wi-Fi module baseline is invalid")
    if (
        not isinstance(coldplug, list)
        or not coldplug
        or len(coldplug) != len(set(coldplug))
        or any(not isinstance(name, str) or SAFE_MODULE_RE.fullmatch(name) is None for name in coldplug)
        or not set(coldplug).issubset(modules)
    ):
        raise KernelModulePayloadError("Wi-Fi coldplug baseline is invalid")
    return {
        "module_basenames": modules,
        "coldplug_entrypoints": coldplug,
        "matrix_sha256": sha256_file(matrix_path),
    }


def validate_archive_members(archive: tarfile.TarFile) -> list[tarfile.TarInfo]:
    members = archive.getmembers()
    if not members:
        raise KernelModulePayloadError("kernel module archive is empty")
    for member in members:
        raw = member.name
        path = Path(raw)
        if not raw or path.is_absolute() or ".." in path.parts:
            raise KernelModulePayloadError(f"unsafe kernel-module archive path: {raw}")
        if member.isdev() or member.isfifo() or member.issym() or member.islnk():
            raise KernelModulePayloadError(f"unsafe kernel-module archive object: {raw}")
    return members


def extract_archive(archive_path: Path, destination: Path) -> tuple[Path, str]:
    archive_path = archive_path.resolve()
    if archive_path.is_symlink() or not archive_path.is_file():
        raise KernelModulePayloadError("kernel module archive is missing or unsafe")
    with tarfile.open(archive_path, "r") as archive:
        members = validate_archive_members(archive)
        archive.extractall(destination, members=members, filter="data")

    modules_root = destination / "lib/modules"
    if not modules_root.is_dir():
        raise KernelModulePayloadError("kernel module archive has no lib/modules root")
    releases = [item for item in modules_root.iterdir() if item.is_dir() and not item.is_symlink()]
    if len(releases) != 1:
        raise KernelModulePayloadError(f"expected one kernel module release, found {len(releases)}")
    release_root = releases[0]
    release = release_root.name
    if SAFE_RELEASE_RE.fullmatch(release) is None:
        raise KernelModulePayloadError("kernel module release identity is unsafe")
    if not (release_root / "modules.dep").is_file():
        raise KernelModulePayloadError("kernel module archive is missing modules.dep")
    return release_root, release


def parse_modprobe_output(output: str, extracted_root: Path, release_root: Path) -> set[Path]:
    selected: set[Path] = set()
    extracted_root = extracted_root.resolve()
    release_root = release_root.resolve()
    for raw_line in output.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("builtin "):
            continue
        argv = shlex.split(line)
        if len(argv) < 2 or argv[0] != "insmod":
            raise KernelModulePayloadError(f"unexpected modprobe dependency output: {raw_line}")
        candidate = Path(argv[1])
        if not candidate.is_absolute():
            raise KernelModulePayloadError("modprobe returned a non-absolute module path")
        try:
            relative_from_root = candidate.relative_to(extracted_root)
        except ValueError as exc:
            # kmod may print /lib/modules/... even when --dirname points at a
            # staging root. Map only that canonical target-root form.
            try:
                relative_from_root = candidate.relative_to("/")
            except ValueError as nested:
                raise KernelModulePayloadError("modprobe module path escaped staging root") from nested
        resolved = (extracted_root / relative_from_root).resolve()
        try:
            resolved.relative_to(release_root)
        except ValueError as exc:
            raise KernelModulePayloadError("modprobe selected a module outside the canonical release") from exc
        if resolved.is_symlink() or not resolved.is_file() or not resolved.name.endswith(".ko"):
            raise KernelModulePayloadError(f"selected kernel module is missing or unsafe: {resolved}")
        selected.add(resolved)
    if not selected:
        raise KernelModulePayloadError("modprobe selected no kernel modules")
    return selected


def resolve_modules(extracted_root: Path, release_root: Path, release: str, requested: list[str]) -> set[Path]:
    modprobe = shutil.which("modprobe")
    if not modprobe:
        raise KernelModulePayloadError("host kmod/modprobe is required for module dependency resolution")
    empty_config = extracted_root / "empty-modprobe.d"
    empty_config.mkdir()
    selected: set[Path] = set()
    for name in requested:
        completed = subprocess.run(
            [modprobe, "-C", str(empty_config), "-d", str(extracted_root), "-S", release, "-D", name],
            check=False,
            capture_output=True,
            text=True,
        )
        if completed.returncode != 0:
            detail = (completed.stderr or completed.stdout).strip()[-2000:]
            raise KernelModulePayloadError(f"cannot resolve module {name}: {detail}")
        selected.update(parse_modprobe_output(completed.stdout, extracted_root, release_root))
    return selected


def copy_payload(extracted_root: Path, release_root: Path, target_root: Path, selected: set[Path]) -> list[dict]:
    target_root = target_root.resolve()
    target_release = target_root / release_root.relative_to(extracted_root)
    target_release.mkdir(parents=True, exist_ok=True)

    module_receipts: list[dict] = []
    for source in sorted(selected, key=lambda path: path.relative_to(extracted_root).as_posix()):
        relative = source.relative_to(extracted_root)
        destination = target_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        module_receipts.append({
            "path": "/" + relative.as_posix(),
            "sha256": sha256_file(destination),
            "size": destination.stat().st_size,
        })

    metadata_receipts: list[dict] = []
    for source in sorted(release_root.iterdir(), key=lambda path: path.name):
        if not source.is_file() or source.is_symlink():
            continue
        if not (source.name.startswith("modules.") or source.name in {"modules.order"}):
            continue
        relative = source.relative_to(extracted_root)
        destination = target_root / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, destination)
        metadata_receipts.append({
            "path": "/" + relative.as_posix(),
            "sha256": sha256_file(destination),
            "size": destination.stat().st_size,
        })

    if not metadata_receipts:
        raise KernelModulePayloadError("no kernel module metadata was copied")
    return module_receipts + metadata_receipts


def install(archive_path: Path, target_root: Path, receipt_path: Path, matrix_path: Path) -> dict:
    policy = load_wifi_policy(matrix_path)
    target_root = target_root.resolve()
    if target_root.is_symlink() or not target_root.is_dir():
        raise KernelModulePayloadError("target root must be an existing real directory")

    work = Path(tempfile.mkdtemp(prefix="ordax-kernel-module-payload-"))
    try:
        release_root, release = extract_archive(archive_path, work)
        selected = resolve_modules(work, release_root, release, policy["module_basenames"])
        files = copy_payload(work, release_root, target_root, selected)
        selected_basenames = {
            Path(item["path"]).name.removesuffix(".ko").replace("-", "_")
            for item in files
            if item["path"].endswith(".ko")
        }
        missing = sorted(set(policy["module_basenames"]) - selected_basenames)
        if missing:
            raise KernelModulePayloadError(f"required Wi-Fi modules were not materialized: {missing}")

        receipt = {
            "$schema": "prototype-ordax.kernel-module-payload/1",
            "status": "selected-from-canonical-kernel-artifact",
            "kernel_release": release,
            "kernel_module_archive_sha256": sha256_file(archive_path.resolve()),
            "hardware_matrix": str(matrix_path.resolve().relative_to(ROOT)),
            "hardware_matrix_sha256": policy["matrix_sha256"],
            "requested_module_basenames": policy["module_basenames"],
            "coldplug_entrypoints": policy["coldplug_entrypoints"],
            "selected_module_count": sum(1 for item in files if item["path"].endswith(".ko")),
            "files": files,
            "kernel_built_here": False,
            "network_download_used": False,
        }
        receipt_path = receipt_path.resolve()
        receipt_path.parent.mkdir(parents=True, exist_ok=True)
        receipt_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return receipt
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check", "install"))
    parser.add_argument("--matrix", type=Path, default=DEFAULT_MATRIX)
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--target", type=Path)
    parser.add_argument("--receipt", type=Path)
    args = parser.parse_args()
    try:
        if args.action == "check":
            result = load_wifi_policy(args.matrix.resolve())
        else:
            if args.archive is None or args.target is None or args.receipt is None:
                raise KernelModulePayloadError("install requires --archive, --target and --receipt")
            result = install(args.archive, args.target, args.receipt, args.matrix.resolve())
    except (KernelModulePayloadError, OSError, tarfile.TarError, ValueError) as exc:
        print(f"ordax-kernel-module-payload: ERROR: {exc}", file=__import__("sys").stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
