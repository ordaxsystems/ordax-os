#!/usr/bin/env python3
"""Generate a content-addressed candidate lock for Wine build APK inputs.

The probe consumes a successful configure proof and its temporary Alpine rootfs.
It compares that rootfs with the pinned pristine minirootfs, refreshes only the
repository indexes, fetches every APK whose installed identity differs from the
pristine base, verifies the APKs with Alpine's package verifier, and records
SHA-256 + size for every fetched archive.

This command does not compile Wine, install a runtime into OrdaX, materialize a
compatibility profile, or authorize foreign application execution.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import shutil

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CONFIGURE_PROBE = HERE / "configure_probe.py"
SOURCE_FILE = HERE / "source.json"
ENVIRONMENT_FILE = HERE / "build-environment.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SAFE_PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]{0,127}$")
SAFE_VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._~:-]{0,255}$")
EXPECTED_REPOSITORIES = (
    "https://dl-cdn.alpinelinux.org/alpine/v3.22/main",
    "https://dl-cdn.alpinelinux.org/alpine/v3.22/community",
)


class PackageLockError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise PackageLockError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CONFIGURE = load_module("ordax_windows_compat_configure_for_lock", CONFIGURE_PROBE)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PackageLockError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise PackageLockError(f"{label} must be an object")
    return value


def validated_source() -> dict:
    try:
        return CONFIGURE.SOURCE.validate_source(CONFIGURE.SOURCE.load_source())
    except CONFIGURE.SOURCE.RuntimeSourceError as exc:
        raise PackageLockError(f"runtime source contract is invalid: {exc}") from exc


def validated_environment() -> dict:
    environment = CONFIGURE.validate_environment(load_json(ENVIRONMENT_FILE, "build environment"))
    repositories = environment.get("repositories")
    if repositories != list(EXPECTED_REPOSITORIES):
        raise PackageLockError("Alpine repository set drifted from compatibility build policy")
    return environment


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def validate_package_map(value: object, label: str) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise PackageLockError(f"{label} must be a non-empty object")
    normalized: dict[str, str] = {}
    for name, version in value.items():
        if not isinstance(name, str) or not SAFE_PACKAGE_RE.fullmatch(name):
            raise PackageLockError(f"unsafe package name in {label}: {name!r}")
        if not isinstance(version, str) or not SAFE_VERSION_RE.fullmatch(version):
            raise PackageLockError(f"unsafe package version in {label}: {name}={version!r}")
        normalized[name] = version
    return normalized


def declared_build_packages(environment: dict) -> tuple[str, ...]:
    packages = tuple(environment["base_build_packages"] + environment["wine_build_packages"])
    if not packages or len(set(packages)) != len(packages):
        raise PackageLockError("declared build package set is invalid")
    return packages


def validate_configure_proof(proof: dict) -> dict:
    if proof.get("$schema") != "prototype-ordax.windows-compat-configure-proof/1":
        raise PackageLockError("unexpected configure proof schema")
    if proof.get("configure_proof_passed") is not True:
        raise PackageLockError("configure proof is not successful")
    for key in (
        "package_versions_pinned",
        "full_build_proof_passed",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
    ):
        if proof.get(key) is not False:
            raise PackageLockError(f"configure proof overclaims readiness: {key}")

    source = validated_source()
    environment = validated_environment()
    if proof.get("runtime_id") != source.get("runtime_id") or proof.get("wine_version") != source.get("version"):
        raise PackageLockError("configure proof runtime identity drifted")
    if proof.get("host") != environment.get("host"):
        raise PackageLockError("configure proof host identity drifted")

    requested = validate_package_map(proof.get("resolved_build_packages"), "resolved_build_packages")
    installed = validate_package_map(proof.get("resolved_installed_packages"), "resolved_installed_packages")
    declared = declared_build_packages(environment)
    if set(requested) != set(declared):
        missing = sorted(set(declared) - set(requested))
        unexpected = sorted(set(requested) - set(declared))
        raise PackageLockError(
            f"configure proof build package set diverged from declaration: missing={missing} unexpected={unexpected}"
        )
    for name in declared:
        version = requested[name]
        if installed.get(name) != version:
            raise PackageLockError(f"requested package identity not present in installed graph: {name}")
    return proof


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def pristine_package_versions(work_dir: Path, host: dict) -> dict[str, str]:
    cache = work_dir / "cache"
    archive = CONFIGURE.download_exact(
        host["rootfs_url"],
        cache / Path(host["rootfs_url"]).name,
        host["rootfs_sha256"],
        CONFIGURE.MAX_ALPINE_ROOTFS_BYTES,
    )
    pristine = work_dir / "pristine-rootfs"
    if pristine.exists():
        shutil.rmtree(pristine)
    try:
        CONFIGURE.ALPINE.safe_extract(archive, pristine)
    except CONFIGURE.ALPINE.BuildError as exc:
        raise PackageLockError(f"canonical pristine Alpine extraction failed: {exc}") from exc
    return CONFIGURE.installed_package_versions(pristine)


def changed_packages(pristine: dict[str, str], resolved: dict[str, str]) -> dict[str, str]:
    removed = sorted(set(pristine) - set(resolved))
    if removed:
        raise PackageLockError(f"build dependency transaction removed pinned base packages: {', '.join(removed)}")
    changed = {name: version for name, version in resolved.items() if pristine.get(name) != version}
    if not changed:
        raise PackageLockError("build dependency transaction produced no package delta")
    return dict(sorted(changed.items()))


def refresh_repository_indexes(rootfs: Path) -> None:
    """Refresh repository indexes and prove the installed graph did not mutate."""
    before = CONFIGURE.installed_package_versions(rootfs)
    try:
        CONFIGURE.proot(rootfs, "apk update")
    except CONFIGURE.ConfigureProofError as exc:
        raise PackageLockError(f"Alpine repository index refresh failed: {exc}") from exc
    after = CONFIGURE.installed_package_versions(rootfs)
    if after != before:
        raise PackageLockError("repository index refresh mutated installed package graph")


def fetch_and_verify_archives(rootfs: Path, package_map: dict[str, str]) -> list[dict]:
    cache = rootfs / "build/package-cache"
    if cache.exists():
        shutil.rmtree(cache)
    cache.mkdir(parents=True)

    refresh_repository_indexes(rootfs)

    specs = [f"{name}={version}" for name, version in package_map.items()]
    command = "apk fetch --output /build/package-cache " + " ".join(shell_quote(spec) for spec in specs)
    try:
        CONFIGURE.proot(rootfs, command)
    except CONFIGURE.ConfigureProofError as exc:
        raise PackageLockError(f"exact APK fetch failed: {exc}") from exc

    expected = {f"{name}-{version}.apk": (name, version) for name, version in package_map.items()}
    actual_paths = {path.name: path for path in cache.iterdir() if path.is_file()}
    missing = sorted(set(expected) - set(actual_paths))
    unexpected = sorted(set(actual_paths) - set(expected))
    if missing or unexpected:
        raise PackageLockError(f"APK fetch set mismatch: missing={missing} unexpected={unexpected}")

    verify_paths = " ".join(shell_quote(f"/build/package-cache/{filename}") for filename in sorted(expected))
    try:
        CONFIGURE.proot(rootfs, "apk verify " + verify_paths)
    except CONFIGURE.ConfigureProofError as exc:
        raise PackageLockError(f"Alpine APK signature/integrity verification failed: {exc}") from exc

    records = []
    for filename in sorted(expected):
        name, version = expected[filename]
        path = actual_paths[filename]
        if path.is_symlink():
            raise PackageLockError(f"fetched APK must be a regular file, not symlink: {filename}")
        size = path.stat().st_size
        if size <= 0:
            raise PackageLockError(f"fetched APK is empty: {filename}")
        records.append({
            "name": name,
            "version": version,
            "filename": filename,
            "size_bytes": size,
            "sha256": sha256_file(path),
        })
    return records


def package_set_digest(records: list[dict]) -> str:
    digest = hashlib.sha256()
    for record in records:
        line = f"{record['name']}={record['version']} {record['sha256']} {record['size_bytes']}\n"
        digest.update(line.encode("utf-8"))
    return digest.hexdigest()


def build_candidate_manifest(
    configure_proof: dict,
    pristine: dict[str, str],
    changed: dict[str, str],
    archives: list[dict],
    proof_sha256: str,
) -> dict:
    source = validated_source()
    environment = validated_environment()
    if len(archives) != len(changed):
        raise PackageLockError("archive count does not match changed package graph")
    archive_identities = {(record.get("name"), record.get("version")) for record in archives}
    if archive_identities != set(changed.items()):
        raise PackageLockError("archive identities do not match changed package graph")
    for record in archives:
        if not SHA256_RE.fullmatch(record.get("sha256", "")):
            raise PackageLockError("invalid APK digest in candidate lock")
        if not isinstance(record.get("size_bytes"), int) or record["size_bytes"] <= 0:
            raise PackageLockError("invalid APK size in candidate lock")
    return {
        "$schema": "prototype-ordax.windows-compat-build-input-lock-candidate/1",
        "status": "candidate-not-committed-not-build-authorized",
        "runtime_id": configure_proof["runtime_id"],
        "wine_version": configure_proof["wine_version"],
        "wine_source_sha256": source["upstream"]["archive_sha256"],
        "host": configure_proof["host"],
        "repositories": environment["repositories"],
        "repository_index_status": "mutable-discovery-input-not-build-authority",
        "configure_proof_sha256": proof_sha256,
        "configure_flags": configure_proof["configure_flags"],
        "native_compiler_triplet": configure_proof["native_compiler_triplet"],
        "toolchain": configure_proof["toolchain"],
        "pristine_rootfs_package_count": len(pristine),
        "resolved_installed_package_count": len(configure_proof["resolved_installed_packages"]),
        "changed_package_count": len(changed),
        "changed_packages": changed,
        "package_archives": archives,
        "package_set_sha256": package_set_digest(archives),
        "trust": {
            "alpine_apk_verify_passed": True,
            "alpine_trust_keys_source": "pinned-minirootfs",
            "archive_sha256_recorded": True,
        },
        "promotion": {
            "committed_lock": False,
            "package_archive_bytes_pinned": True,
            "full_build_proof_passed": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
        },
    }


def perform_probe(configure_proof_path: Path, rootfs: Path, work_dir: Path) -> dict:
    proof = validate_configure_proof(load_json(configure_proof_path, "configure proof"))
    proof_sha256 = sha256_file(configure_proof_path)
    installed_now = CONFIGURE.installed_package_versions(rootfs)
    expected_installed = validate_package_map(proof["resolved_installed_packages"], "resolved_installed_packages")
    if installed_now != expected_installed:
        raise PackageLockError("temporary rootfs package graph does not match configure proof")

    pristine = pristine_package_versions(work_dir, proof["host"])
    changed = changed_packages(pristine, expected_installed)
    archives = fetch_and_verify_archives(rootfs, changed)
    return build_candidate_manifest(proof, pristine, changed, archives, proof_sha256)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "probe"])
    parser.add_argument("--configure-proof", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--manifest-out", type=Path)
    args = parser.parse_args()

    validated_environment()
    source = validated_source()
    if source.get("build_intent", {}).get("binary_artifact_pinned") is not False:
        raise PackageLockError("source contract already claims a binary artifact")
    if args.command == "check":
        print("windows compatibility package lock probe: PASS")
        return 0
    if args.configure_proof is None or args.rootfs is None or args.work_dir is None:
        raise PackageLockError("probe requires --configure-proof, --rootfs and --work-dir")

    manifest = perform_probe(
        args.configure_proof.resolve(),
        args.rootfs.resolve(),
        args.work_dir.resolve(),
    )
    encoded = json.dumps(manifest, indent=2, sort_keys=True) + "\n"
    if args.manifest_out:
        args.manifest_out.parent.mkdir(parents=True, exist_ok=True)
        args.manifest_out.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PackageLockError as exc:
        print(f"windows-compat-package-lock: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
