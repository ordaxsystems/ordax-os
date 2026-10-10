#!/usr/bin/env python3
"""Build the candidate Stable/MVP minimal OS base for portable USB v2.

The Stable Base reuses the same Alpine/kernel/firmware primitives as the owner
Development Base but deliberately excludes Git, development helpers and source
checkout. It produces a deterministic EROFS rootfs candidate. Physical use and
signed Base updates remain blocked until the source/package locks and later
boot/update gates are complete.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import platform
import re
import shutil
import stat
import subprocess
import sys
import tarfile
import tempfile
import uuid

ROOT = Path(__file__).resolve().parents[2]
HERE = ROOT / "bootstrap" / "stable-base"
CONTRACT_PATH = HERE / "source.json"
UUID_NAMESPACE = uuid.UUID("9cfae4d5-c5f4-5c64-91d0-8c9f661553b4")


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load shared base module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_module("ordax_stable_alpine_core", ROOT / "bootstrap/base/alpine_core.py")
FIRMWARE = load_module("ordax_stable_firmware_policy", ROOT / "bootstrap/base/firmware_policy.py")
RUNTIME = load_module("ordax_stable_runtime_policy", ROOT / "bootstrap/base/runtime_policy.py")


class StableBaseError(RuntimeError):
    pass


def stage(name: str) -> None:
    print(f"ORDAX_STABLE_BASE_STAGE={name}", flush=True)


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StableBaseError(f"cannot load Stable Base source contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.stable-base-source/1":
        raise StableBaseError("unexpected Stable Base contract schema")
    if value.get("status") != "candidate-not-promotable":
        raise StableBaseError("Stable Base must remain candidate-not-promotable")
    alpine = value.get("alpine", {})
    if (
        alpine.get("version") != CORE.ALPINE_VERSION
        or alpine.get("branch") != CORE.ALPINE_BRANCH
        or alpine.get("arch") != CORE.ARCH
        or alpine.get("archive_url") != CORE.ARCHIVE_URL
        or alpine.get("checksum_sidecar_url") != CORE.CHECKSUM_URL
    ):
        raise StableBaseError("Stable Base Alpine identity differs from shared core")
    packages = value.get("packages")
    if not isinstance(packages, list) or not packages:
        raise StableBaseError("Stable Base package list is empty")
    if "git" in packages or value.get("git_client_allowed") is not False:
        raise StableBaseError("Stable Base may not contain Git")
    if value.get("source_checkout_allowed") is not False:
        raise StableBaseError("Stable Base may not contain a source checkout")
    if value.get("development_helpers_allowed") is not False:
        raise StableBaseError("Stable Base may not contain development helpers")
    kernel_modules = value.get("kernel_modules")
    if not isinstance(kernel_modules, dict):
        raise StableBaseError("Stable Base kernel module policy is missing")
    required_modules = kernel_modules.get("required_basenames")
    coldplug_entrypoints = kernel_modules.get("coldplug_entrypoints")
    if (
        not isinstance(required_modules, list)
        or not required_modules
        or len(required_modules) != len(set(required_modules))
        or any(
            not isinstance(name, str)
            or re.fullmatch(r"[A-Za-z0-9_+-]{1,80}", name) is None
            for name in required_modules
        )
    ):
        raise StableBaseError("Stable Base required kernel module list is invalid")
    if (
        not isinstance(coldplug_entrypoints, list)
        or not coldplug_entrypoints
        or len(coldplug_entrypoints) != len(set(coldplug_entrypoints))
        or any(
            not isinstance(name, str)
            or re.fullmatch(r"[A-Za-z0-9_+-]{1,80}", name) is None
            for name in coldplug_entrypoints
        )
        or not set(coldplug_entrypoints).issubset(required_modules)
    ):
        raise StableBaseError("Stable Base coldplug entrypoints are invalid")

    if value.get("build", {}).get("physical_artifact_authorized") is not False:
        raise StableBaseError("Stable Base physical artifact must remain unauthorized")
    pinned = alpine.get("archive_sha256")
    if not re.fullmatch(r"[0-9a-f]{64}", str(pinned or "")):
        raise StableBaseError("Stable Base Alpine SHA-256 must be pinned before candidate build")
    if alpine.get("archive_hash_pin_status", "").startswith("pinned-from-verified-candidate-") is not True:
        raise StableBaseError("Stable Base Alpine pin provenance is missing")

    package_lock = value.get("apk_package_lock")
    if value.get("apk_package_versions_pinned") is not True:
        raise StableBaseError("Stable Base APK versions must be pinned before candidate build")
    if not isinstance(package_lock, dict) or not package_lock:
        raise StableBaseError("Stable Base full transitive APK lock is missing")
    if value.get("apk_package_lock_count") != len(package_lock):
        raise StableBaseError("Stable Base APK lock count disagrees with the lock")
    if value.get("apk_install_policy") != "full-transitive-lock-exact-version-specs":
        raise StableBaseError("Stable Base APK install policy is not fail-closed")
    for name, version in package_lock.items():
        if (
            not isinstance(name, str)
            or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.-]*", name)
            or not isinstance(version, str)
            or not version
            or any(ch.isspace() for ch in version)
        ):
            raise StableBaseError("Stable Base APK lock contains an unsafe name/version")
    if not set(value["packages"]).issubset(package_lock):
        raise StableBaseError("Stable Base requested packages are not all present in the full lock")
    return value


def sha256_file(path: Path) -> str:
    return CORE.sha256_file(path)


def source_commit() -> str:
    expected = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    if expected:
        if not re.fullmatch(r"[0-9a-f]{40}", expected):
            raise StableBaseError("ORDAX_SOURCE_COMMIT must be lowercase 40-hex")
        return expected
    value = CORE.source_commit().lower()
    if not re.fullmatch(r"[0-9a-f]{40}", value):
        raise StableBaseError("Stable Base source commit is unavailable")
    return value


def install_kernel_modules(rootfs: Path, archive_path: Path, required: set[str]) -> None:
    archive_path = archive_path.resolve()
    if archive_path.is_symlink() or not archive_path.is_file():
        raise StableBaseError("kernel modules archive is missing or unsafe")
    with tarfile.open(archive_path, "r") as archive:
        for member in archive.getmembers():
            if member.isdev() or member.isfifo():
                raise StableBaseError(f"unsafe kernel-module archive entry: {member.name}")
        selected = CORE.select_module_members(
            archive,
            required,
            log_prefix="ORDAX_STABLE_BASE",
        )
        archive.extractall(rootfs, members=selected, filter="data")


def installed_apk_lock(rootfs: Path) -> dict[str, str]:
    database = rootfs / "lib/apk/db/installed"
    if database.is_symlink() or not database.is_file():
        raise StableBaseError("Alpine installed-package database is missing before runtime pruning")
    packages: dict[str, str] = {}
    current_name = ""
    current_version = ""
    for raw in database.read_text(encoding="utf-8", errors="strict").splitlines() + [""]:
        if raw.startswith("P:"):
            current_name = raw[2:].strip()
        elif raw.startswith("V:"):
            current_version = raw[2:].strip()
        elif raw == "":
            if current_name or current_version:
                if (
                    not current_name
                    or not current_version
                    or current_name in packages
                    or any(ch.isspace() for ch in current_name + current_version)
                ):
                    raise StableBaseError("Alpine installed-package database is malformed")
                packages[current_name] = current_version
            current_name = ""
            current_version = ""
    if not packages:
        raise StableBaseError("Alpine installed-package lock is empty")
    return dict(sorted(packages.items()))


def verify_apk_lock(contract: dict, installed: dict[str, str]) -> None:
    expected = contract.get("apk_package_lock")
    if expected is None:
        return
    if not isinstance(expected, dict) or not expected:
        raise StableBaseError("Stable Base apk_package_lock must be null or a non-empty object")
    normalized = {str(name): str(version) for name, version in expected.items()}
    if dict(sorted(normalized.items())) != installed:
        missing = sorted(set(normalized) - set(installed))
        extra = sorted(set(installed) - set(normalized))
        changed = sorted(
            name
            for name in set(normalized) & set(installed)
            if normalized[name] != installed[name]
        )
        raise StableBaseError(
            "Stable Base APK lock mismatch: "
            f"missing={missing[:8]} extra={extra[:8]} changed={changed[:8]}"
        )


def exact_apk_install_specs(contract: dict) -> list[str]:
    lock = contract.get("apk_package_lock")
    if contract.get("apk_package_versions_pinned") is not True or not isinstance(lock, dict) or not lock:
        raise StableBaseError("Stable Base exact APK install requested without a full pinned lock")
    return [f"{name}={version}" for name, version in sorted(lock.items())]


def install_stable_runtime(rootfs: Path, kernel_modules: Path, contract: dict) -> set[str]:
    required = set(contract["kernel_modules"]["required_basenames"])
    install_kernel_modules(rootfs, kernel_modules, required)

    init_source = (ROOT / contract["entrypoint"]["source"]).resolve()
    if init_source.is_symlink() or not init_source.is_file():
        raise StableBaseError("Stable Base entrypoint source is missing or unsafe")
    init_target = rootfs / contract["entrypoint"]["path"].lstrip("/")
    init_target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(init_source, init_target)
    init_target.chmod(0o755)

    for relative in (
        "state",
        "system",
        "ordax",
        "ordax-data",
        "ordax-esp",
        "home",
        "run",
        "tmp",
        "proc",
        "sys",
        "dev",
        "root",
    ):
        (rootfs / relative).mkdir(parents=True, exist_ok=True)
    (rootfs / "tmp").chmod(0o1777)

    for directory in (rootfs / "dev", rootfs / "proc", rootfs / "sys", rootfs / "run"):
        for child in list(directory.iterdir()):
            if child.is_dir() and not child.is_symlink():
                shutil.rmtree(child)
            else:
                child.unlink()

    try:
        required_firmware = FIRMWARE.available_firmware_names(
            rootfs,
            log_prefix="ORDAX_STABLE_BASE",
        )
    except FIRMWARE.FirmwareSelectionError as exc:
        raise StableBaseError(str(exc)) from exc
    CORE.prune_firmware(
        rootfs,
        required_firmware,
        log_prefix="ORDAX_STABLE_BASE",
    )
    RUNTIME.prune_build_only_runtime(
        rootfs,
        proot_rootfs=CORE.proot_rootfs,
        error_type=StableBaseError,
        log_prefix="ORDAX_STABLE_BASE",
    )
    return required_firmware


def verify_rootfs(rootfs: Path, contract: dict) -> None:
    forbidden_paths = (
        "usr/bin/git",
        "usr/local/bin/ordax-pull",
        "usr/local/bin/ordax-rollback",
        "usr/local/bin/ordax-run",
        "sbin/ordax-dev-init",
        "workspace",
        ".git",
    )
    for relative in forbidden_paths:
        path = rootfs / relative
        if path.exists() or path.is_symlink():
            raise StableBaseError(f"forbidden development path in Stable Base: /{relative}")

    required = (
        "bin/sh",
        "sbin/apk",
        contract["entrypoint"]["path"].lstrip("/"),
    )
    for relative in required:
        path = rootfs / relative
        if not path.is_file() or not os.access(path, os.X_OK):
            raise StableBaseError(f"required Stable Base executable missing: /{relative}")

    keys = rootfs / "etc/apk/keys"
    if not keys.is_dir() or not any(path.is_file() for path in keys.glob("*.pub")):
        raise StableBaseError("Stable Base Alpine package trust keys are missing")

    bad = []
    for path in rootfs.rglob("*"):
        mode = path.lstat().st_mode
        if stat.S_ISLNK(mode) or not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
            bad.append(path.relative_to(rootfs).as_posix())
            if len(bad) >= 20:
                break
    if bad:
        raise StableBaseError(f"Stable Base contains unsafe filesystem objects: {bad}")


def normalized_tar(rootfs: Path, destination: Path) -> None:
    paths = [rootfs] + sorted(rootfs.rglob("*"), key=lambda p: p.relative_to(rootfs).as_posix())
    # The rootfs intentionally flattens Alpine symlinks into regular files or
    # directories. Regular files may share an inode through hard links; the
    # portable EROFS source tar must still serialize every path as file bytes
    # rather than reintroducing tar hard-link entries.
    with tarfile.open(
        destination,
        "w",
        format=tarfile.USTAR_FORMAT,
        dereference=True,
    ) as archive:
        for path in paths:
            relative = "." if path == rootfs else path.relative_to(rootfs).as_posix()
            info = archive.gettarinfo(str(path), arcname=relative)
            info.uid = info.gid = 0
            info.uname = info.gname = ""
            info.mtime = 0
            if info.isfile():
                with path.open("rb") as handle:
                    archive.addfile(info, handle)
            elif info.isdir():
                archive.addfile(info)
            else:
                raise StableBaseError(f"non-regular object reached Stable Base archive: {relative}")


def run(argv: list[str]) -> None:
    print("+", " ".join(argv), flush=True)
    try:
        subprocess.run(argv, check=True)
    except (OSError, subprocess.CalledProcessError) as exc:
        raise StableBaseError(f"command failed: {' '.join(argv)}") from exc


def erofs_identity(image: Path) -> dict[str, str]:
    result = subprocess.run(
        ["blkid", "-p", "-o", "export", str(image)],
        check=True,
        capture_output=True,
        text=True,
    )
    values: dict[str, str] = {}
    for line in result.stdout.splitlines():
        if "=" in line:
            key, value = line.split("=", 1)
            values[key] = value
    return values


def build(kernel_modules: Path, out_dir: Path, cache_dir: Path) -> dict:
    contract = load_contract()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise StableBaseError("Stable Base build requires x86_64 Linux")
    if os.geteuid() != 0:
        raise StableBaseError("Stable Base build requires root for package ownership/proot")
    for program in ("proot", "mkfs.erofs", "fsck.erofs", "blkid"):
        if not shutil.which(program):
            raise StableBaseError(f"required Stable Base tool is missing: {program}")

    out_dir = out_dir.resolve()
    cache_dir = cache_dir.resolve()
    shutil.rmtree(out_dir, ignore_errors=True)
    out_dir.mkdir(parents=True)
    cache_dir.mkdir(parents=True, exist_ok=True)
    work = Path(tempfile.mkdtemp(prefix="ordax-stable-base-"))
    try:
        stage("download-alpine")
        archive, actual_archive_sha = CORE.download_verified(cache_dir)
        pinned = contract["alpine"]["archive_sha256"]
        if pinned is not None and actual_archive_sha != pinned:
            raise StableBaseError(
                f"pinned Alpine digest mismatch: expected={pinned} actual={actual_archive_sha}"
            )
        stage("extract-alpine")
        rootfs = work / "rootfs"
        rootfs.mkdir()
        CORE.safe_extract(archive, rootfs)

        (rootfs / "etc/apk").mkdir(parents=True, exist_ok=True)
        (rootfs / "etc/apk/repositories").write_text(
            f"https://dl-cdn.alpinelinux.org/alpine/{CORE.ALPINE_BRANCH}/main\n"
            f"https://dl-cdn.alpinelinux.org/alpine/{CORE.ALPINE_BRANCH}/community\n",
            encoding="utf-8",
        )
        host_resolv = Path("/etc/resolv.conf")
        if host_resolv.exists():
            shutil.copy2(host_resolv, rootfs / "etc/resolv.conf", follow_symlinks=True)
        (rootfs / "dev").mkdir(parents=True, exist_ok=True)

        stage("install-packages")
        package_specs = exact_apk_install_specs(contract)
        CORE.proot_rootfs(rootfs, "apk add --no-cache " + " ".join(package_specs))
        installed_packages = installed_apk_lock(rootfs)
        verify_apk_lock(contract, installed_packages)
        stage("install-runtime")
        firmware = install_stable_runtime(rootfs, kernel_modules.resolve(), contract)

        stage("flatten-symlinks")
        flattened = CORE.flatten_symlinks(rootfs)
        verify_rootfs(rootfs, contract)
        unique_bytes = CORE.unique_regular_bytes(rootfs)
        limit = int(contract["rootfs"]["maximum_unique_regular_bytes"])
        if unique_bytes > limit:
            raise StableBaseError(f"Stable Base too large: {unique_bytes} > {limit}")

        normalized = work / "stable-base.tar"
        normalized_tar(rootfs, normalized)
        tar_sha = sha256_file(normalized)
        image_uuid = str(uuid.uuid5(UUID_NAMESPACE, tar_sha))
        image = out_dir / contract["rootfs"]["artifact_name"]
        run([
            "mkfs.erofs",
            "--tar=f",
            "-zlz4",
            "-T", "0",
            "-U", image_uuid,
            "-L", contract["rootfs"]["volume_label"],
            "--all-root",
            str(image),
            str(normalized),
        ])
        run(["fsck.erofs", str(image)])
        identity = erofs_identity(image)
        if (
            identity.get("TYPE") != "erofs"
            or identity.get("LABEL") != contract["rootfs"]["volume_label"]
            or identity.get("UUID", "").lower() != image_uuid
        ):
            raise StableBaseError("Stable Base EROFS identity mismatch")

        provenance = {
            "$schema": "prototype-ordax.stable-base-provenance/1",
            "status": "candidate-not-promotable",
            "source_commit": source_commit(),
            "alpine_version": contract["alpine"]["version"],
            "alpine_archive_sha256": actual_archive_sha,
            "alpine_archive_sha256_pinned_in_contract": pinned is not None,
            "apk_package_versions_pinned": bool(contract["apk_package_versions_pinned"]),
            "kernel_modules_sha256": sha256_file(kernel_modules.resolve()),
            "kernel_module_basenames": contract["kernel_modules"]["required_basenames"],
            "coldplug_entrypoints": contract["kernel_modules"]["coldplug_entrypoints"],
            "packages": contract["packages"],
            "apk_install_policy": contract["apk_install_policy"],
            "exact_package_spec_count": len(package_specs),
            "installed_packages": installed_packages,
            "installed_package_count": len(installed_packages),
            "apk_package_lock_matches_contract": contract.get("apk_package_lock") is not None,
            "firmware_selection": "shared-selected-kernel-module-declarations",
            "firmware_files": len(firmware),
            "symlinks_flattened": flattened,
            "unique_regular_bytes": unique_bytes,
            "git_client_preseeded": False,
            "source_checkout_preseeded": False,
            "development_helpers_preseeded": False,
            "runtime_package_client_retained": True,
            "runtime_package_trust_keys_retained": True,
            "normalized_rootfs_tar_sha256": tar_sha,
            "erofs_sha256": sha256_file(image),
            "erofs_size": image.stat().st_size,
            "erofs_uuid": image_uuid,
            "erofs_label": contract["rootfs"]["volume_label"],
            "physical_artifact_authorized": False,
            "signed_update_integration_implemented": False,
            "qemu_boot_proven": False,
            "physical_boot_proven": False,
        }
        provenance_path = out_dir / "provenance.json"
        provenance_path.write_text(
            json.dumps(provenance, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        (out_dir / "SHA256SUMS").write_text(
            f"{sha256_file(image)}  {image.name}\n"
            f"{sha256_file(provenance_path)}  provenance.json\n",
            encoding="ascii",
        )
        print(f"STABLE_BASE_ALPINE_SHA256={actual_archive_sha}")
        print(f"STABLE_BASE_APK_PACKAGE_COUNT={len(installed_packages)}")
        print("STABLE_BASE_APK_LOCK_JSON=" + json.dumps(installed_packages, sort_keys=True, separators=(",", ":")))
        print(f"STABLE_BASE_EROFS_SHA256={provenance['erofs_sha256']}")
        print("STABLE_BASE_GIT=NO")
        print("STABLE_BASE_PHYSICAL_AUTHORIZED=NO")
        return provenance
    finally:
        shutil.rmtree(work, ignore_errors=True)


def verify(out_dir: Path) -> dict:
    contract = load_contract()
    out_dir = out_dir.resolve()
    image = out_dir / contract["rootfs"]["artifact_name"]
    provenance_path = out_dir / "provenance.json"
    if image.is_symlink() or not image.is_file() or provenance_path.is_symlink() or not provenance_path.is_file():
        raise StableBaseError("Stable Base output is missing or unsafe")
    provenance = json.loads(provenance_path.read_text(encoding="utf-8"))
    if provenance.get("$schema") != "prototype-ordax.stable-base-provenance/1":
        raise StableBaseError("unexpected Stable Base provenance schema")
    if provenance.get("git_client_preseeded") is not False:
        raise StableBaseError("Stable Base provenance claims a Git client")
    if provenance.get("physical_artifact_authorized") is not False:
        raise StableBaseError("Stable Base provenance authorized physical use")
    if provenance.get("kernel_module_basenames") != contract["kernel_modules"]["required_basenames"]:
        raise StableBaseError("Stable Base provenance kernel module baseline drifted")
    if provenance.get("coldplug_entrypoints") != contract["kernel_modules"]["coldplug_entrypoints"]:
        raise StableBaseError("Stable Base provenance coldplug baseline drifted")
    if sha256_file(image) != provenance.get("erofs_sha256"):
        raise StableBaseError("Stable Base EROFS digest differs from provenance")
    run(["fsck.erofs", str(image)])
    identity = erofs_identity(image)
    if identity.get("TYPE") != "erofs" or identity.get("LABEL") != "ORDAX-BASE":
        raise StableBaseError("Stable Base EROFS verification failed")
    return {
        "status": "verified-candidate",
        "source_commit": provenance.get("source_commit"),
        "alpine_archive_sha256": provenance.get("alpine_archive_sha256"),
        "erofs_sha256": provenance.get("erofs_sha256"),
        "physical_artifact_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    build_parser = sub.add_parser("build")
    build_parser.add_argument(
        "--kernel-modules",
        type=Path,
        default=CORE.kernel_module_archive_path(),
    )
    build_parser.add_argument("--out-dir", type=Path, default=ROOT / "out/stable-base")
    build_parser.add_argument("--cache-dir", type=Path, default=ROOT / "out/stable-base-cache")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--out-dir", type=Path, default=ROOT / "out/stable-base")
    args = parser.parse_args()
    try:
        if args.command == "check":
            result = load_contract()
        elif args.command == "build":
            result = build(args.kernel_modules, args.out_dir, args.cache_dir)
        else:
            result = verify(args.out_dir)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0
    except (StableBaseError, CORE.BuildError, OSError, subprocess.CalledProcessError) as exc:
        print(f"ordax-stable-base: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
