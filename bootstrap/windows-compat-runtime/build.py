#!/usr/bin/env python3
"""Validate and fetch the pinned Windows compatibility runtime source.

This stage proves source identity only. It deliberately does not configure, build,
install, activate, or execute Wine.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import tarfile
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).with_name("source.json")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
RUNTIME_ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,127}$")
MAX_SOURCE_BYTES = 64 * 1024 * 1024
MAX_ARCHIVE_MEMBERS = 250_000
MAX_UNPACKED_BYTES = 2 * 1024 * 1024 * 1024


class CompatibilityRuntimeBuildError(RuntimeError):
    pass


def load_source(path: Path = SOURCE) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CompatibilityRuntimeBuildError(f"cannot load source contract: {exc}") from exc
    if not isinstance(value, dict):
        raise CompatibilityRuntimeBuildError("source contract must be an object")
    return value


def validate_source(source: dict) -> dict:
    if source.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1":
        raise CompatibilityRuntimeBuildError("unexpected source schema")
    if source.get("status") != "source-candidate-not-built-not-activatable":
        raise CompatibilityRuntimeBuildError("source candidate status drifted")
    if source.get("product_scope") != "owner-development-only":
        raise CompatibilityRuntimeBuildError("runtime source must remain Owner/Development only")
    if source.get("engine") != "wine" or source.get("version") != "11.0":
        raise CompatibilityRuntimeBuildError("unexpected compatibility engine identity")
    if not RUNTIME_ID_RE.fullmatch(str(source.get("runtime_id", ""))):
        raise CompatibilityRuntimeBuildError("unsafe runtime id")

    host = source.get("host")
    if host != {"os": "linux", "arch": "x86_64", "libc_target": "musl"}:
        raise CompatibilityRuntimeBuildError("host target drifted")
    if source.get("windows_architectures_targeted") != ["x86_64", "x86"]:
        raise CompatibilityRuntimeBuildError("Windows architecture target drifted")

    upstream = source.get("upstream")
    if not isinstance(upstream, dict):
        raise CompatibilityRuntimeBuildError("upstream section missing")
    expected_upstream = {
        "release_page": "https://www.winehq.org/news/2026011301",
        "source_url": "https://dl.winehq.org/wine/source/11.0/wine-11.0.tar.xz",
        "archive_name": "wine-11.0.tar.xz",
        "archive_size_bytes": 33172240,
        "archive_sha256": "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701",
        "archive_root": "wine-11.0",
        "version_file": "VERSION",
        "version_file_expected": "Wine version 11.0",
    }
    if upstream != expected_upstream:
        raise CompatibilityRuntimeBuildError("pinned Wine upstream identity drifted")
    if not SHA256_RE.fullmatch(upstream["archive_sha256"]):
        raise CompatibilityRuntimeBuildError("source SHA-256 is invalid")
    if not 0 < upstream["archive_size_bytes"] <= MAX_SOURCE_BYTES:
        raise CompatibilityRuntimeBuildError("source archive size is outside bounds")

    build_intent = source.get("build_intent")
    expected_build_intent = {
        "configure_archs": ["x86_64", "i386"],
        "configure_flag": "--enable-archs=x86_64,i386",
        "new_wow64_required": True,
        "pure_win32_prefixes_supported": False,
        "build_recipe_validated": False,
        "binary_artifact_pinned": False,
    }
    if build_intent != expected_build_intent:
        raise CompatibilityRuntimeBuildError("build intent drifted or claims unproven readiness")

    distribution = source.get("distribution")
    expected_distribution = {
        "committed_binary_allowed": False,
        "network_download_at_runtime_allowed": False,
        "stable_base_inclusion_allowed": False,
        "stable_mvp_activation_allowed": False,
        "signed_component_required_before_activation": True,
        "content_addressed_artifact_required_before_activation": True,
    }
    if distribution != expected_distribution:
        raise CompatibilityRuntimeBuildError("distribution safety policy drifted")

    security = source.get("security")
    expected_security = {
        "boot_critical": False,
        "source_proof_grants_execution": False,
        "source_proof_grants_installation": False,
        "runtime_must_be_sandboxed": True,
        "profile_isolation_required": True,
        "host_authority": "none",
    }
    if security != expected_security:
        raise CompatibilityRuntimeBuildError("runtime security policy drifted")
    return source


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_exact(source: dict, cache_dir: Path) -> Path:
    upstream = source["upstream"]
    destination = cache_dir / upstream["archive_name"]
    cache_dir.mkdir(parents=True, exist_ok=True)
    if destination.is_file():
        if destination.stat().st_size == upstream["archive_size_bytes"] and sha256_file(destination) == upstream["archive_sha256"]:
            return destination
        destination.unlink()

    partial = destination.with_suffix(destination.suffix + ".part")
    partial.unlink(missing_ok=True)
    request = urllib.request.Request(
        upstream["source_url"],
        headers={"User-Agent": "OrdaX-windows-compat-source-proof/1"},
    )
    digest = hashlib.sha256()
    total = 0
    try:
        with urllib.request.urlopen(request, timeout=180) as response, partial.open("wb") as output:
            while True:
                chunk = response.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > upstream["archive_size_bytes"] or total > MAX_SOURCE_BYTES:
                    raise CompatibilityRuntimeBuildError("source download exceeded exact bound")
                digest.update(chunk)
                output.write(chunk)
    except Exception as exc:
        partial.unlink(missing_ok=True)
        if isinstance(exc, CompatibilityRuntimeBuildError):
            raise
        raise CompatibilityRuntimeBuildError(f"source download failed: {exc}") from exc

    if total != upstream["archive_size_bytes"]:
        partial.unlink(missing_ok=True)
        raise CompatibilityRuntimeBuildError(
            f"source size mismatch: expected={upstream['archive_size_bytes']} actual={total}"
        )
    actual_sha = digest.hexdigest()
    if actual_sha != upstream["archive_sha256"]:
        partial.unlink(missing_ok=True)
        raise CompatibilityRuntimeBuildError(
            f"source digest mismatch: expected={upstream['archive_sha256']} actual={actual_sha}"
        )
    partial.replace(destination)
    return destination


def validate_member_link(member: tarfile.TarInfo, expected_root: str) -> None:
    """Prove that a TAR link resolves within the single pinned archive root.

    Symlink targets resolve relative to their containing directory; TAR
    hardlink names are archive-root-relative. Do not permit links to escape
    the source tree even when the containing member name itself is safe.
    """
    if not (member.issym() or member.islnk()):
        return
    target = member.linkname
    if not target or target.startswith("/") or "\\" in target:
        raise CompatibilityRuntimeBuildError(f"unsafe archive link target: {member.name}")

    parts = list(PurePosixPath(member.name).parts[:-1]) if member.issym() else []
    for segment in PurePosixPath(target).parts:
        if segment == "..":
            if len(parts) <= 1:
                raise CompatibilityRuntimeBuildError(f"archive link escapes expected root: {member.name}")
            parts.pop()
        elif segment != ".":
            parts.append(segment)
    if not parts or parts[0] != expected_root:
        raise CompatibilityRuntimeBuildError(f"archive link escapes expected root: {member.name}")


def validate_archive(source: dict, archive: Path) -> dict:
    upstream = source["upstream"]
    if archive.stat().st_size != upstream["archive_size_bytes"]:
        raise CompatibilityRuntimeBuildError("cached archive size changed")
    if sha256_file(archive) != upstream["archive_sha256"]:
        raise CompatibilityRuntimeBuildError("cached archive digest changed")

    expected_root = upstream["archive_root"]
    version_member = f"{expected_root}/{upstream['version_file']}"
    seen_version = None
    member_count = 0
    unpacked_bytes = 0
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                member_count += 1
                if member_count > MAX_ARCHIVE_MEMBERS:
                    raise CompatibilityRuntimeBuildError("Wine source archive member count exceeded bound")
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts:
                    raise CompatibilityRuntimeBuildError(f"unsafe archive path: {member.name}")
                if not path.parts or path.parts[0] != expected_root:
                    raise CompatibilityRuntimeBuildError(f"archive member escapes expected root: {member.name}")
                if not (member.isfile() or member.isdir() or member.issym() or member.islnk()):
                    raise CompatibilityRuntimeBuildError(f"unsupported archive object: {member.name}")
                validate_member_link(member, expected_root)
                if member.isfile():
                    unpacked_bytes += member.size
                    if unpacked_bytes > MAX_UNPACKED_BYTES:
                        raise CompatibilityRuntimeBuildError("Wine source archive unpacked size exceeded bound")
                if member.name == version_member:
                    if seen_version is not None:
                        raise CompatibilityRuntimeBuildError("duplicate Wine VERSION member")
                    if not member.isfile() or member.size > 128:
                        raise CompatibilityRuntimeBuildError("VERSION member must be a bounded regular file")
                    handle = tar.extractfile(member)
                    if handle is None:
                        raise CompatibilityRuntimeBuildError("VERSION member is not a regular file")
                    raw = handle.read(129)
                    if len(raw) != member.size or len(raw) > 128:
                        raise CompatibilityRuntimeBuildError("VERSION member changed size or exceeded bound")
                    seen_version = raw.decode("utf-8").strip()
    except (tarfile.TarError, UnicodeDecodeError, OSError) as exc:
        raise CompatibilityRuntimeBuildError(f"cannot validate Wine source archive: {exc}") from exc

    if member_count < 1000:
        raise CompatibilityRuntimeBuildError("Wine source archive is unexpectedly sparse")
    if seen_version != upstream["version_file_expected"]:
        raise CompatibilityRuntimeBuildError(
            f"Wine VERSION mismatch: expected={upstream['version_file_expected']!r} actual={seen_version!r}"
        )
    return {
        "$schema": "prototype-ordax.windows-compat-source-proof/1",
        "runtime_id": source["runtime_id"],
        "engine": source["engine"],
        "version": source["version"],
        "archive_name": archive.name,
        "archive_size_bytes": archive.stat().st_size,
        "archive_sha256": upstream["archive_sha256"],
        "archive_member_count": member_count,
        "archive_unpacked_bytes": unpacked_bytes,
        "archive_link_targets_root_bounded": True,
        "version_file_value": seen_version,
        "build_performed": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    fetch = sub.add_parser("fetch-source")
    fetch.add_argument("--cache-dir", type=Path, required=True)
    fetch.add_argument("--proof-out", type=Path)
    args = parser.parse_args()

    source = validate_source(load_source())
    if args.command == "check":
        print("windows compatibility runtime source contract: PASS")
        return 0

    archive = download_exact(source, args.cache_dir.resolve())
    proof = validate_archive(source, archive)
    encoded = json.dumps(proof, indent=2, sort_keys=True) + "\n"
    if args.proof_out:
        args.proof_out.parent.mkdir(parents=True, exist_ok=True)
        args.proof_out.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CompatibilityRuntimeBuildError as exc:
        print(f"windows-compat-runtime: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
