#!/usr/bin/env python3
"""Reproduce the pinned Wine build closure and discover exact APK content hashes.

This is a CI-only discovery proof. It never builds Wine, creates a compatibility
profile, installs a runtime into OrdaX, or authorizes execution. The pinned
Alpine rootfs already content-addresses its initial package set; this tool only
fetches APK bytes for packages added or version-changed by the exact build
transaction.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LOCK_PATH = HERE / "build-version-lock.json"
SOURCE_PATH = HERE / "source.json"
ENVIRONMENT_PATH = HERE / "build-environment.json"
VALIDATOR_PATH = HERE / "validate_build_version_lock.py"
CONFIGURE_PROBE_PATH = HERE / "configure_probe.py"


class ContentDiscoveryError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ContentDiscoveryError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


VALIDATOR = load_module("ordax_windows_compat_version_lock_validator", VALIDATOR_PATH)
PROBE = load_module("ordax_windows_compat_configure_probe_for_content", CONFIGURE_PROBE_PATH)


def canonical_package_map_sha256(packages: dict[str, str]) -> str:
    encoded = json.dumps(dict(sorted(packages.items())), sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def exact_specs(packages: dict[str, str]) -> list[str]:
    return [f"{name}={version}" for name, version in sorted(packages.items())]


def validate_discovery_inputs() -> tuple[dict, dict, dict]:
    lock = VALIDATOR.load_json(LOCK_PATH)
    source = VALIDATOR.load_json(SOURCE_PATH)
    environment = VALIDATOR.load_json(ENVIRONMENT_PATH)
    VALIDATOR.validate_lock(lock, source, environment)
    gates = lock["gates"]
    if gates["apk_content_hashes_pinned"] is not False:
        raise ContentDiscoveryError("content discovery requires an unpinned APK content gate")
    if gates["full_build_proof_passed"] is not False:
        raise ContentDiscoveryError("content discovery may not start from a claimed full build")
    if gates["activation_authorized"] is not False or gates["execution_authorized"] is not False:
        raise ContentDiscoveryError("content discovery may not inherit activation or execution authority")
    return lock, source, environment


def reproduce_and_discover(work_dir: Path) -> dict:
    lock, _, environment = validate_discovery_inputs()
    host = lock["host"]
    cache = work_dir / "cache"
    rootfs_archive = PROBE.download_exact(
        host["rootfs_url"],
        cache / Path(host["rootfs_url"]).name,
        host["rootfs_sha256"],
        PROBE.MAX_ALPINE_ROOTFS_BYTES,
    )

    rootfs = work_dir / "rootfs"
    try:
        PROBE.ALPINE.safe_extract(rootfs_archive, rootfs)
    except PROBE.ALPINE.BuildError as exc:
        raise ContentDiscoveryError(f"canonical Alpine rootfs extraction failed: {exc}") from exc

    initial = PROBE.installed_package_versions(rootfs)
    (rootfs / "etc/apk/repositories").write_text(
        "https://dl-cdn.alpinelinux.org/alpine/v3.22/main\n"
        "https://dl-cdn.alpinelinux.org/alpine/v3.22/community\n",
        encoding="utf-8",
    )
    host_resolv = Path("/etc/resolv.conf")
    if host_resolv.is_file():
        shutil.copy2(host_resolv, rootfs / "etc/resolv.conf", follow_symlinks=True)

    requested = lock["requested_build_packages"]
    PROBE.proot(
        rootfs,
        "apk add --no-cache " + " ".join(shell_quote(spec) for spec in exact_specs(requested)),
    )
    resolved = PROBE.installed_package_versions(rootfs)

    expected_closure = lock["resolved_closure"]
    actual_digest = canonical_package_map_sha256(resolved)
    if len(resolved) != expected_closure["package_count"] or actual_digest != expected_closure["canonical_json_sha256"]:
        raise ContentDiscoveryError(
            "resolved package closure drifted: "
            f"expected_count={expected_closure['package_count']} actual_count={len(resolved)} "
            f"expected_sha256={expected_closure['canonical_json_sha256']} actual_sha256={actual_digest}"
        )

    missing_requested = sorted(name for name, version in requested.items() if resolved.get(name) != version)
    if missing_requested:
        raise ContentDiscoveryError(f"requested exact package versions were not installed: {missing_requested}")

    removed_initial = sorted(name for name in initial if name not in resolved)
    if removed_initial:
        raise ContentDiscoveryError(f"APK transaction removed initial rootfs packages: {removed_initial}")

    package_inputs = {
        name: version
        for name, version in resolved.items()
        if initial.get(name) != version
    }
    if not package_inputs:
        raise ContentDiscoveryError("APK transaction produced no external package inputs")

    package_dir = rootfs / "build/apks"
    package_dir.mkdir(parents=True, exist_ok=True)
    PROBE.proot(
        rootfs,
        "apk fetch --output /build/apks "
        + " ".join(shell_quote(spec) for spec in exact_specs(package_inputs)),
    )

    manifest: dict[str, dict[str, object]] = {}
    expected_filenames: set[str] = set()
    for name, version in sorted(package_inputs.items()):
        filename = f"{name}-{version}.apk"
        expected_filenames.add(filename)
        path = package_dir / filename
        if path.is_symlink() or not path.is_file():
            raise ContentDiscoveryError(f"exact APK archive missing after fetch: {filename}")
        size = path.stat().st_size
        if size <= 0:
            raise ContentDiscoveryError(f"empty APK archive: {filename}")
        manifest[name] = {
            "version": version,
            "filename": filename,
            "size_bytes": size,
            "sha256": sha256_file(path),
        }

    actual_filenames = {path.name for path in package_dir.iterdir() if path.is_file() and not path.is_symlink()}
    extra = sorted(actual_filenames - expected_filenames)
    missing = sorted(expected_filenames - actual_filenames)
    if extra or missing:
        raise ContentDiscoveryError(f"APK fetch output set drifted: missing={missing[:8]} extra={extra[:8]}")

    return {
        "$schema": "prototype-ordax.windows-compat-apk-content-discovery/1",
        "status": "content-discovered-not-pinned-not-build-proven",
        "runtime_id": lock["runtime_id"],
        "wine_version": lock["wine_version"],
        "host_rootfs_sha256": host["rootfs_sha256"],
        "requested_package_count": len(requested),
        "resolved_package_count": len(resolved),
        "resolved_closure_sha256": actual_digest,
        "initial_rootfs_package_count": len(initial),
        "external_apk_package_count": len(manifest),
        "external_apk_manifest": manifest,
        "gates": {
            "version_lock_verified": True,
            "closure_reproduced": True,
            "apk_content_discovered": True,
            "apk_content_hashes_pinned": False,
            "full_build_proof_passed": False,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "discover"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    validate_discovery_inputs()
    if args.command == "check":
        print("windows compatibility APK content discovery contract: PASS")
        return 0
    if args.work_dir is None or args.out is None:
        raise ContentDiscoveryError("--work-dir and --out are required for discover")

    proof = reproduce_and_discover(args.work_dir.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(proof, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ContentDiscoveryError, VALIDATOR.BuildVersionLockError, PROBE.ConfigureProofError) as exc:
        print(f"windows-compat-apk-content-discovery: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
