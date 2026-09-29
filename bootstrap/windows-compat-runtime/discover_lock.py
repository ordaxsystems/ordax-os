#!/usr/bin/env python3
"""Revalidate exact Alpine package locks for the OrdaX Windows compatibility runtime.

The committed locks are authority only after the initial review. This tool
re-resolves both package closures from the canonical Alpine source and requires
byte-for-byte package identity equality. It never compiles Wine, creates a
launchable runtime, authorizes execution, or mutates physical media.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
CONTRACT = ROOT / "bootstrap/windows-compat-runtime/source.json"
STABLE_BASE = ROOT / "bootstrap/stable-base/source.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+_.-]*$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")


class DiscoveryError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise DiscoveryError(f"cannot load shared module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CORE = load_module("ordax_windows_compat_alpine_core", ROOT / "bootstrap/base/alpine_core.py")


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DiscoveryError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise DiscoveryError(f"{label} must be a JSON object")
    return value


def require_unique_packages(value, label: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise DiscoveryError(f"{label} must be a non-empty array")
    result: list[str] = []
    for item in value:
        if not isinstance(item, str) or PACKAGE_RE.fullmatch(item) is None:
            raise DiscoveryError(f"{label} contains unsafe package name")
        result.append(item)
    if len(result) != len(set(result)):
        raise DiscoveryError(f"{label} must not contain duplicates")
    return result


def require_lock(value, count, label: str, requested: list[str]) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise DiscoveryError(f"{label} must be a non-empty object")
    if count != len(value) or not isinstance(count, int):
        raise DiscoveryError(f"{label} count disagrees with lock")
    normalized: dict[str, str] = {}
    for name, version in value.items():
        if (
            not isinstance(name, str)
            or PACKAGE_RE.fullmatch(name) is None
            or not isinstance(version, str)
            or not version
            or any(ch.isspace() for ch in version)
        ):
            raise DiscoveryError(f"{label} contains unsafe entry")
        normalized[name] = version
    if not set(requested).issubset(normalized):
        raise DiscoveryError(f"{label} does not contain every requested package")
    return dict(sorted(normalized.items()))


def load_contract() -> dict:
    value = load_json(CONTRACT, "Windows compatibility runtime source contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1":
        raise DiscoveryError("unexpected Windows compatibility runtime source schema")
    if value.get("status") != "candidate-build-locked-not-executable":
        raise DiscoveryError("Windows compatibility runtime is not in pinned build-candidate state")
    if value.get("product_scope") != "owner-development-only":
        raise DiscoveryError("initial Windows compatibility runtime must remain Owner/Development only")
    for field in (
        "public_availability",
        "stable_mvp_enabled",
        "execution_adapter_connected",
        "installation_adapter_connected",
        "boot_critical",
    ):
        if value.get(field) is not False:
            raise DiscoveryError(f"{field} must remain false before runtime execution proof")

    engine = value.get("engine")
    if not isinstance(engine, dict):
        raise DiscoveryError("Wine engine source section is missing")
    expected_identity = {
        "id": "wine",
        "version": "11.0",
        "release_channel": "stable",
        "source_url": "https://dl.winehq.org/wine/source/11.0/wine-11.0.tar.xz",
        "source_size_bytes": 33172240,
        "source_sha256": "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701",
        "license": "LGPL-2.1-or-later",
        "upstream_release_date": "2026-01-13",
        "host_architecture": "x86_64",
        "windows_architectures": ["x86", "x86_64"],
        "wow64_mode": "new",
    }
    for field, expected in expected_identity.items():
        if engine.get(field) != expected:
            raise DiscoveryError(f"Wine engine identity drifted at {field}")
    if SHA256_RE.fullmatch(engine["source_sha256"]) is None:
        raise DiscoveryError("Wine source SHA-256 is invalid")

    configure = engine.get("configure_args")
    if (
        not isinstance(configure, list)
        or not configure
        or any(not isinstance(item, str) or not item for item in configure)
        or len(configure) != len(set(configure))
    ):
        raise DiscoveryError("Wine configure arguments are invalid")
    required = {
        "--enable-archs=i386,x86_64",
        "--disable-tests",
        "--with-x",
        "--with-alsa",
        "--with-gnutls",
        "--with-gstreamer",
        "--with-vulkan",
        "--without-usb",
        "--without-pcap",
        "--without-gphoto",
        "--without-sane",
        "--without-cups",
        "--without-v4l2",
        "--without-wayland",
    }
    if not required.issubset(configure):
        raise DiscoveryError("Wine configure policy lost a required capability or deny-by-default boundary")

    stable = load_json(STABLE_BASE, "Stable Base source contract")
    stable_alpine = stable.get("alpine", {})
    alpine = value.get("alpine")
    if not isinstance(alpine, dict):
        raise DiscoveryError("Alpine runtime identity is missing")
    expected_alpine = {
        "version": stable_alpine.get("version"),
        "branch": stable_alpine.get("branch"),
        "arch": stable_alpine.get("arch"),
        "archive_sha256": stable_alpine.get("archive_sha256"),
    }
    for field, expected in expected_alpine.items():
        if alpine.get(field) != expected:
            raise DiscoveryError(f"Windows compatibility runtime Alpine identity drifted at {field}")
    if alpine.get("identity_owner") != "bootstrap/stable-base/source.json":
        raise DiscoveryError("Windows compatibility runtime must reuse the Stable Base Alpine identity")
    if (
        alpine["version"] != CORE.ALPINE_VERSION
        or alpine["branch"] != CORE.ALPINE_BRANCH
        or alpine["arch"] != CORE.ARCH
    ):
        raise DiscoveryError("shared Alpine build core and runtime contract disagree")

    build_requested = require_unique_packages(value.get("build_packages"), "build_packages")
    runtime_requested = require_unique_packages(value.get("runtime_packages"), "runtime_packages")
    if value.get("apk_locks_pinned") is not True:
        raise DiscoveryError("APK locks must be pinned before candidate build")
    require_lock(
        value.get("build_apk_package_lock"),
        value.get("build_apk_package_lock_count"),
        "build_apk_package_lock",
        build_requested,
    )
    require_lock(
        value.get("runtime_apk_package_lock"),
        value.get("runtime_apk_package_lock_count"),
        "runtime_apk_package_lock",
        runtime_requested,
    )

    evidence = value.get("lock_discovery_evidence")
    if not isinstance(evidence, dict):
        raise DiscoveryError("reviewed lock discovery evidence is missing")
    if evidence.get("workflow") != "Windows Compatibility Runtime Lock Discovery":
        raise DiscoveryError("lock discovery workflow identity drifted")
    if COMMIT_RE.fullmatch(str(evidence.get("source_commit", ""))) is None:
        raise DiscoveryError("lock discovery source commit is invalid")
    if evidence.get("wine_source_sha256") != engine["source_sha256"]:
        raise DiscoveryError("lock discovery Wine digest differs from engine identity")
    if evidence.get("wine_source_size_bytes") != engine["source_size_bytes"]:
        raise DiscoveryError("lock discovery Wine size differs from engine identity")
    if evidence.get("alpine_archive_sha256") != alpine["archive_sha256"]:
        raise DiscoveryError("lock discovery Alpine digest differs from canonical identity")
    if evidence.get("build_apk_package_lock_count") != value["build_apk_package_lock_count"]:
        raise DiscoveryError("lock discovery build count differs from pinned lock")
    if evidence.get("runtime_apk_package_lock_count") != value["runtime_apk_package_lock_count"]:
        raise DiscoveryError("lock discovery runtime count differs from pinned lock")
    if DIGEST_RE.fullmatch(str(evidence.get("artifact_digest", ""))) is None:
        raise DiscoveryError("lock discovery artifact digest is invalid")

    expected_security = {
        "runtime_network_download_allowed": False,
        "raw_usb_passthrough_allowed": False,
        "packet_capture_allowed": False,
        "camera_passthrough_allowed": False,
        "scanner_passthrough_allowed": False,
        "printing_passthrough_allowed": False,
        "host_filesystem_authority": "none",
        "profile_storage_required": True,
        "sandbox_required": True,
    }
    if value.get("security") != expected_security:
        raise DiscoveryError("Windows compatibility runtime security policy drifted")

    artifact = value.get("artifact")
    if not isinstance(artifact, dict):
        raise DiscoveryError("runtime artifact policy is missing")
    if artifact.get("name") != "windows-compat-runtime.erofs" or artifact.get("filesystem") != "erofs":
        raise DiscoveryError("runtime artifact identity drifted")
    for field in ("physical_artifact_authorized", "release_manifest_connected", "component_slot_connected"):
        if artifact.get(field) is not False:
            raise DiscoveryError(f"{field} must remain false before promotion path exists")
    if artifact.get("read_only") is not True:
        raise DiscoveryError("compatibility runtime artifact must remain read-only")
    return value


def source_commit() -> str:
    value = os.environ.get("ORDAX_SOURCE_COMMIT", "").strip().lower()
    if not value:
        try:
            value = subprocess.check_output(
                ["git", "-C", str(ROOT), "rev-parse", "HEAD"], text=True
            ).strip().lower()
        except (OSError, subprocess.CalledProcessError) as exc:
            raise DiscoveryError("source commit is unavailable") from exc
    if COMMIT_RE.fullmatch(value) is None:
        raise DiscoveryError("source commit must be lowercase 40-hex")
    return value


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_exact(url: str, destination: Path, expected_sha256: str, expected_size: int) -> Path:
    destination.parent.mkdir(parents=True, exist_ok=True)
    if (
        destination.is_file()
        and destination.stat().st_size == expected_size
        and sha256_file(destination) == expected_sha256
    ):
        return destination
    if destination.exists() or destination.is_symlink():
        destination.unlink()
    partial = destination.with_name(destination.name + ".part")
    partial.unlink(missing_ok=True)
    digest = hashlib.sha256()
    total = 0
    request = urllib.request.Request(
        url, headers={"User-Agent": "OrdaX-windows-compat-lock-revalidation/1"}
    )
    try:
        with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > expected_size:
                    raise DiscoveryError("Wine source download exceeded exact pinned size")
                digest.update(chunk)
                output.write(chunk)
    except Exception as exc:
        partial.unlink(missing_ok=True)
        if isinstance(exc, DiscoveryError):
            raise
        raise DiscoveryError(f"Wine source download failed: {exc}") from exc
    if total != expected_size:
        partial.unlink(missing_ok=True)
        raise DiscoveryError(
            f"Wine source size mismatch: expected={expected_size} actual={total}"
        )
    actual = digest.hexdigest()
    if actual != expected_sha256:
        partial.unlink(missing_ok=True)
        raise DiscoveryError(
            f"Wine source digest mismatch: expected={expected_sha256} actual={actual}"
        )
    partial.replace(destination)
    return destination


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
                if not name or not version or name in packages:
                    raise DiscoveryError("Alpine installed package database is malformed")
                packages[name] = version
            name = ""
            version = ""
    if not packages:
        raise DiscoveryError("Alpine installed package lock is empty")
    return dict(sorted(packages.items()))


def resolve_package_lock(
    contract: dict,
    packages: list[str],
    work: Path,
    cache_dir: Path,
    label: str,
) -> tuple[dict[str, str], str]:
    archive, actual_alpine_sha = CORE.download_verified(cache_dir)
    if actual_alpine_sha != contract["alpine"]["archive_sha256"]:
        raise DiscoveryError(
            "pinned Alpine archive mismatch: "
            f"expected={contract['alpine']['archive_sha256']} actual={actual_alpine_sha}"
        )
    rootfs = work / label
    rootfs.mkdir()
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
    CORE.proot_rootfs(rootfs, "apk add --no-cache " + " ".join(packages))
    resolved = installed_lock(rootfs)
    missing_requested = sorted(set(packages) - set(resolved))
    if missing_requested:
        raise DiscoveryError(
            f"{label} lock did not contain requested packages: {missing_requested}"
        )
    return resolved, actual_alpine_sha


def compare_lock(actual: dict[str, str], expected: dict[str, str], label: str) -> None:
    if actual == expected:
        return
    missing = sorted(set(expected) - set(actual))
    extra = sorted(set(actual) - set(expected))
    changed = sorted(
        name for name in set(actual) & set(expected) if actual[name] != expected[name]
    )
    raise DiscoveryError(
        f"{label} drift: missing={missing[:12]} extra={extra[:12]} changed={changed[:12]}"
    )


def revalidate(out: Path, cache_dir: Path) -> dict:
    contract = load_contract()
    if shutil.which("proot") is None:
        raise DiscoveryError("proot is required for APK lock revalidation")
    cache_dir = cache_dir.resolve()
    cache_dir.mkdir(parents=True, exist_ok=True)

    source_name = Path(contract["engine"]["source_url"]).name
    source_path = cache_dir / source_name
    download_exact(
        contract["engine"]["source_url"],
        source_path,
        contract["engine"]["source_sha256"],
        contract["engine"]["source_size_bytes"],
    )

    work = Path(tempfile.mkdtemp(prefix="ordax-windows-compat-lock-"))
    try:
        build_lock, alpine_sha = resolve_package_lock(
            contract,
            require_unique_packages(contract["build_packages"], "build_packages"),
            work,
            cache_dir,
            "build-rootfs",
        )
        runtime_lock, runtime_alpine_sha = resolve_package_lock(
            contract,
            require_unique_packages(contract["runtime_packages"], "runtime_packages"),
            work,
            cache_dir,
            "runtime-rootfs",
        )
        if runtime_alpine_sha != alpine_sha:
            raise DiscoveryError("build/runtime Alpine source identities disagree")
        compare_lock(
            build_lock,
            dict(sorted(contract["build_apk_package_lock"].items())),
            "build APK lock",
        )
        compare_lock(
            runtime_lock,
            dict(sorted(contract["runtime_apk_package_lock"].items())),
            "runtime APK lock",
        )
        result = {
            "$schema": "prototype-ordax.windows-compat-runtime-lock-discovery/1",
            "status": "verified-pinned-lock",
            "source_commit": source_commit(),
            "runtime_id": contract["runtime_id"],
            "wine_source": {
                "url": contract["engine"]["source_url"],
                "size_bytes": source_path.stat().st_size,
                "sha256": sha256_file(source_path),
            },
            "alpine_archive_sha256": alpine_sha,
            "build_apk_package_lock_count": len(build_lock),
            "build_apk_package_lock": build_lock,
            "runtime_apk_package_lock_count": len(runtime_lock),
            "runtime_apk_package_lock": runtime_lock,
            "execution_adapter_connected": False,
            "installation_adapter_connected": False,
            "physical_artifact_authorized": False,
        }
        out = out.resolve()
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return result
    finally:
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--cache-dir", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = revalidate(args.out, args.cache_dir)
    except (DiscoveryError, OSError, json.JSONDecodeError, CORE.BuildError) as exc:
        print(f"windows-compat-runtime-lock-revalidation: ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
