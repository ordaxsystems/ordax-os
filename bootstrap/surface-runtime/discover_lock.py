#!/usr/bin/env python3
"""Resolve or revalidate the full Alpine package lock for the offline Surface runtime.

# Upstream c-ares drift is handled only through this exact full resolver; the
# review must never infer a 253-package lock from a single apk error.

The tool may use the network in CI to resolve package metadata, but it never
creates a promotable runtime artifact and never touches a physical device. Once
the reviewed full transitive lock is committed, the same resolver must reproduce
that exact lock or fail closed.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import platform
import re
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "bootstrap/surface-runtime/source.json"
STABLE = ROOT / "bootstrap/stable-base/source.json"


class DiscoveryError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise DiscoveryError(f"cannot load shared module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_module("ordax_surface_runtime_alpine_core", ROOT / "bootstrap/base/alpine_core.py")


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DiscoveryError(f"cannot load {path}: {exc}") from exc
    if not isinstance(value, dict):
        raise DiscoveryError(f"{path} must contain one JSON object")
    return value


def validate_contract() -> tuple[dict, dict]:
    contract = load_json(CONTRACT)
    stable = load_json(STABLE)
    if contract.get("$schema") != "prototype-ordax.surface-runtime-source/1":
        raise DiscoveryError("unexpected Surface runtime contract schema")
    status = contract.get("status")
    if status not in {"lock-discovery-required", "candidate-not-promotable"}:
        raise DiscoveryError("unsupported Surface runtime contract status")
    if contract.get("first_boot_offline_required") is not True:
        raise DiscoveryError("Stable/MVP Surface first boot must remain offline-capable")
    if contract.get("network_package_install_during_stable_boot_allowed") is not False:
        raise DiscoveryError("Stable/MVP runtime contract may not permit boot-time package downloads")
    pinned = contract.get("apk_package_versions_pinned")
    lock = contract.get("apk_package_lock")
    if status == "lock-discovery-required":
        if pinned is not False or lock is not None:
            raise DiscoveryError("discovery contract unexpectedly claims a committed APK lock")
    else:
        if pinned is not True or not isinstance(lock, dict) or not lock:
            raise DiscoveryError("candidate contract requires the reviewed full APK lock")
        if contract.get("apk_package_lock_count") != len(lock):
            raise DiscoveryError("candidate APK lock count disagrees with committed lock")
    artifact = contract.get("artifact", {})
    if artifact.get("physical_artifact_authorized") is not False:
        raise DiscoveryError("discovery contract may not authorize a physical artifact")
    if artifact.get("portable_v3_boot_handoff_candidate_connected") is not True:
        raise DiscoveryError("discovery contract lost the portable v3 candidate handoff binding")
    if artifact.get("physical_boot_connected") is not False:
        raise DiscoveryError("discovery contract may not claim physical boot integration")
    packages = contract.get("packages")
    if not isinstance(packages, list) or not packages or len(packages) != len(set(packages)):
        raise DiscoveryError("Surface runtime package request must be a non-empty unique list")
    for package in packages:
        if not isinstance(package, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.-]*", package) is None:
            raise DiscoveryError(f"unsafe APK package name: {package!r}")

    alpine = contract.get("alpine", {})
    stable_alpine = stable.get("alpine", {})
    for field in ("version", "branch", "arch", "archive_sha256"):
        if alpine.get(field) != stable_alpine.get(field):
            raise DiscoveryError(f"Surface runtime Alpine {field} differs from Stable Base")
    if alpine.get("archive_sha256") != "4b4daa9fe2fc696c4919c4412a4c3d3e770d8fb70292a004a2c72f5096175282":
        raise DiscoveryError("Surface runtime Alpine archive pin is unexpected")
    return contract, stable


def installed_lock(rootfs: Path) -> dict[str, str]:
    database = rootfs / "lib/apk/db/installed"
    if database.is_symlink() or not database.is_file():
        raise DiscoveryError("Alpine installed package database is missing")
    packages: dict[str, str] = {}
    name = ""
    version = ""
    for line in database.read_text(encoding="utf-8", errors="strict").splitlines() + [""]:
        if line.startswith("P:"):
            name = line[2:].strip()
        elif line.startswith("V:"):
            version = line[2:].strip()
        elif line == "":
            if name or version:
                if (
                    not name
                    or not version
                    or name in packages
                    or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9+_.-]*", name) is None
                    or any(ch.isspace() for ch in version)
                ):
                    raise DiscoveryError("installed APK database contains an unsafe or duplicate entry")
                packages[name] = version
            name = ""
            version = ""
    if not packages:
        raise DiscoveryError("resolved APK lock is empty")
    return dict(sorted(packages.items()))


def discover(out: Path, cache: Path) -> dict:
    contract, _ = validate_contract()
    if platform.system() != "Linux" or platform.machine() not in {"x86_64", "amd64"}:
        raise DiscoveryError("Surface runtime lock discovery requires x86_64 Linux")
    if shutil.which("proot") is None:
        raise DiscoveryError("proot is required for bounded Alpine package discovery")

    work = Path(tempfile.mkdtemp(prefix="ordax-surface-runtime-lock-"))
    try:
        rootfs = work / "rootfs"
        rootfs.mkdir()
        archive, actual_sha = CORE.download_verified(cache)
        expected_sha = contract["alpine"]["archive_sha256"]
        if actual_sha != expected_sha:
            raise DiscoveryError(
                f"pinned Alpine archive mismatch: expected={expected_sha} actual={actual_sha}"
            )
        CORE.safe_extract(archive, rootfs)

        (rootfs / "etc/apk").mkdir(parents=True, exist_ok=True)
        (rootfs / "etc/apk/repositories").write_text(
            f"https://dl-cdn.alpinelinux.org/alpine/{CORE.ALPINE_BRANCH}/main\n"
            f"https://dl-cdn.alpinelinux.org/alpine/{CORE.ALPINE_BRANCH}/community\n",
            encoding="utf-8",
        )
        host_resolv = Path("/etc/resolv.conf")
        if host_resolv.is_file():
            shutil.copy2(host_resolv, rootfs / "etc/resolv.conf", follow_symlinks=True)

        requested = list(contract["packages"])
        CORE.proot_rootfs(rootfs, "apk add --no-cache " + " ".join(requested))
        lock = installed_lock(rootfs)
        missing = sorted(set(requested) - set(lock))
        if missing:
            raise DiscoveryError(f"requested packages missing from resolved lock: {missing}")

        expected_lock = contract.get("apk_package_lock")
        drift = None
        normalized_expected = None
        if isinstance(expected_lock, dict):
            normalized_expected = dict(sorted((str(k), str(v)) for k, v in expected_lock.items()))
            if lock != normalized_expected:
                missing = sorted(set(normalized_expected) - set(lock))
                extra = sorted(set(lock) - set(normalized_expected))
                changed = sorted(
                    name
                    for name in set(normalized_expected) & set(lock)
                    if normalized_expected[name] != lock[name]
                )
                drift = {
                    "expected_package_count": len(normalized_expected),
                    "resolved_package_count": len(lock),
                    "missing": missing,
                    "extra": extra,
                    "changed": [
                        {
                            "name": name,
                            "expected": normalized_expected[name],
                            "resolved": lock[name],
                        }
                        for name in changed
                    ],
                }

        result = {
            "$schema": "prototype-ordax.surface-runtime-apk-lock-discovery/1",
            "status": (
                "drift-detected-not-promotable"
                if drift is not None
                else "verified-pinned-lock"
                if isinstance(expected_lock, dict)
                else "discovered-not-promotable"
            ),
            "alpine_version": contract["alpine"]["version"],
            "alpine_archive_sha256": actual_sha,
            "requested_packages": requested,
            "resolved_package_count": len(lock),
            "apk_package_lock": lock,
            "apk_package_lock_sha256": CORE.canonical_apk_lock_sha256(lock),
            "first_boot_offline_required": True,
            "physical_artifact_created": False,
            "physical_write_authorized": False,
            "portable_v3_boot_handoff_candidate_connected": True,
            "physical_boot_connected": False,
        }
        if drift is not None:
            result["drift"] = drift

        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")

        if drift is not None:
            changed_names = [entry["name"] for entry in drift["changed"]]
            raise DiscoveryError(
                "resolved package lock differs from committed candidate lock; "
                "full drift report was written before failing closed: "
                f"missing={drift['missing'][:8]} extra={drift['extra'][:8]} "
                f"changed={changed_names[:8]}"
            )

        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = discover(args.out.resolve(), args.cache_dir.resolve())
    except (DiscoveryError, OSError, json.JSONDecodeError, CORE.BuildError) as exc:
        print(f"surface-runtime-lock-discovery: ERROR: {exc}", file=__import__("sys").stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    print("SURFACE_RUNTIME_APK_LOCK_RESOLUTION=PASS")
    print("SURFACE_RUNTIME_PROMOTABLE=NO")
    print("PHYSICAL_WRITE_AUTHORIZED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
