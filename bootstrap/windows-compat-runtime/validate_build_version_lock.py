#!/usr/bin/env python3
"""Validate the fail-closed Wine build package version lock."""

from __future__ import annotations

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LOCK_PATH = HERE / "build-version-lock.json"
SOURCE_PATH = HERE / "source.json"
ENVIRONMENT_PATH = HERE / "build-environment.json"

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")
PACKAGE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]{0,127}$")
VERSION_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._~:-]{0,255}$")


class BuildVersionLockError(RuntimeError):
    pass


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BuildVersionLockError(f"cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise BuildVersionLockError(f"{path.name} must contain an object")
    return value


def validate_package_map(value: object, label: str) -> dict[str, str]:
    if not isinstance(value, dict) or not value:
        raise BuildVersionLockError(f"{label} must be a non-empty object")
    result: dict[str, str] = {}
    for name, version in value.items():
        if not isinstance(name, str) or not PACKAGE_RE.fullmatch(name):
            raise BuildVersionLockError(f"invalid package name in {label}: {name!r}")
        if not isinstance(version, str) or not VERSION_RE.fullmatch(version):
            raise BuildVersionLockError(f"invalid package version in {label}: {name}={version!r}")
        result[name] = version
    return result


def validate_lock(lock: dict, source: dict, environment: dict) -> dict:
    if lock.get("$schema") != "prototype-ordax.windows-compat-build-version-lock/1":
        raise BuildVersionLockError("unexpected version lock schema")
    if lock.get("status") != "reviewed-network-closure-refresh-not-build-proven":
        raise BuildVersionLockError("version lock status drifted")

    if lock.get("runtime_id") != source.get("runtime_id") or lock.get("wine_version") != source.get("version"):
        raise BuildVersionLockError("runtime/source identity drifted")
    source_lock = lock.get("source")
    upstream = source.get("upstream")
    expected_source = {
        "archive_sha256": upstream.get("archive_sha256") if isinstance(upstream, dict) else None,
        "archive_size_bytes": upstream.get("archive_size_bytes") if isinstance(upstream, dict) else None,
    }
    if source_lock != expected_source:
        raise BuildVersionLockError("source archive identity drifted")
    if not isinstance(source_lock, dict) or not SHA256_RE.fullmatch(str(source_lock.get("archive_sha256", ""))):
        raise BuildVersionLockError("invalid source archive sha256")

    if lock.get("host") != environment.get("host"):
        raise BuildVersionLockError("host identity drifted")

    configure = lock.get("configure")
    env_configure = environment.get("configure")
    if not isinstance(configure, dict) or not isinstance(env_configure, dict):
        raise BuildVersionLockError("configure identity missing")
    expected_flags = [
        f"--prefix={env_configure.get('prefix')}",
        f"--libdir={env_configure.get('libdir')}",
        f"--sysconfdir={env_configure.get('sysconfdir')}",
        f"--localstatedir={env_configure.get('localstatedir')}",
        *env_configure.get("flags", []),
    ]
    if configure.get("flags") != expected_flags:
        raise BuildVersionLockError("configure flags drifted")
    if configure.get("native_compiler_triplet") != "x86_64-alpine-linux-musl":
        raise BuildVersionLockError("native compiler triplet drifted")
    toolchain = configure.get("toolchain")
    if not isinstance(toolchain, dict) or set(toolchain) != {"gcc", "x86_64_mingw_gcc", "i686_mingw_gcc"}:
        raise BuildVersionLockError("toolchain identity incomplete")
    if any(not isinstance(value, str) or not value.strip() for value in toolchain.values()):
        raise BuildVersionLockError("toolchain identity invalid")

    requested = validate_package_map(lock.get("requested_build_packages"), "requested_build_packages")
    expected_requested = environment.get("base_build_packages", []) + environment.get("wine_build_packages", [])
    if set(requested) != set(expected_requested):
        raise BuildVersionLockError("requested build package set drifted")

    closure = lock.get("resolved_closure")
    if not isinstance(closure, dict) or closure.get("canonicalization") != "sorted-object-keys-utf8-json-no-whitespace":
        raise BuildVersionLockError("closure canonicalization drifted")
    if not isinstance(closure.get("package_count"), int) or closure["package_count"] < len(requested):
        raise BuildVersionLockError("closure package count invalid")
    if not SHA256_RE.fullmatch(str(closure.get("canonical_json_sha256", ""))):
        raise BuildVersionLockError("closure digest invalid")

    refresh = lock.get("lock_refresh")
    if not isinstance(refresh, dict) or refresh.get("status") != "reviewed-two-version-drift-offline-content-reproof-required":
        raise BuildVersionLockError("reviewed closure refresh evidence missing")
    previous = refresh.get("historical_artifact")
    current = refresh.get("current_observation")
    if not isinstance(previous, dict) or not isinstance(current, dict):
        raise BuildVersionLockError("closure refresh provenance missing")
    if previous.get("resolved_closure_sha256") != "99f0881664ee6a089755baa74e71513a671d8073e91a8256d36ef2c4c303243e":
        raise BuildVersionLockError("previous closure digest drifted")
    if previous.get("source_commit") != "3c29aa03a7b26cdcfb95b74694e5ba4954ae9cb0" or previous.get("workflow_run_id") != 36895104347 or previous.get("artifact_id") != 11179727536:
        raise BuildVersionLockError("historical source artifact identity drifted")
    if previous.get("archive_sha256") != "c5b381e5439452eb0a460efbc59e3af00f85ca4d92ed8d020f72d1c0180d1670":
        raise BuildVersionLockError("historical source artifact digest drifted")
    if current.get("resolved_closure_sha256") != closure["canonical_json_sha256"] or current.get("resolved_closure_sha256") != "e393674aac035f51e0e7b42c85e25850cfb026d9ab79499e0ca444bb0803ecdd":
        raise BuildVersionLockError("current closure digest is not the reviewed observation")
    if current.get("resolved_package_count") != closure["package_count"] or previous.get("resolved_package_count") != closure["package_count"]:
        raise BuildVersionLockError("closure package count drifted")
    if any(not isinstance(current.get(key), int) or current[key] <= 0 for key in ("apk_discovery_run_id", "full_build_run_id", "dependency_diagnostic_run_id")):
        raise BuildVersionLockError("refresh CI evidence missing")
    if refresh.get("changed_packages") != [
        {"name": "zlib", "from": "1.3.2-r0", "to": "1.3.2-r1"},
        {"name": "zlib-dev", "from": "1.3.2-r0", "to": "1.3.2-r1"},
    ]:
        raise BuildVersionLockError("reviewed package drift does not match source evidence")
    if (
        refresh.get("offline_apk_content_reproof_required") is not True
        or refresh.get("full_build_reproof_required") is not True
        or refresh.get("activation_authorized") is not False
        or refresh.get("execution_authorized") is not False
    ):
        raise BuildVersionLockError("closure refresh cannot promote Wine")

    provenance = lock.get("provenance")
    if not isinstance(provenance, dict):
        raise BuildVersionLockError("provenance missing")
    if provenance.get("configure_proof_head_sha") != "3c29aa03a7b26cdcfb95b74694e5ba4954ae9cb0":
        raise BuildVersionLockError("configure proof source commit drifted")
    if provenance.get("configure_proof_workflow_run_id") != 36895104347:
        raise BuildVersionLockError("configure proof workflow provenance drifted")
    if provenance.get("configure_proof_artifact_id") != 11179727536:
        raise BuildVersionLockError("configure proof artifact provenance drifted")
    if provenance.get("configure_proof_artifact_digest") != "sha256:c5b381e5439452eb0a460efbc59e3af00f85ca4d92ed8d020f72d1c0180d1670":
        raise BuildVersionLockError("configure proof artifact digest drifted")
    if not ARTIFACT_DIGEST_RE.fullmatch(str(provenance.get("configure_proof_artifact_digest", ""))):
        raise BuildVersionLockError("configure proof artifact digest invalid")

    expected_gates = {
        "configure_proof_passed": True,
        "package_versions_pinned": True,
        "transitive_closure_digest_pinned": True,
        "apk_content_hashes_pinned": False,
        "full_build_proof_passed": False,
        "runtime_dependency_inventory_complete": False,
        "binary_artifact_pinned": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }
    if lock.get("gates") != expected_gates:
        raise BuildVersionLockError("version lock overclaims readiness")
    return lock


def main() -> int:
    validate_lock(load_json(LOCK_PATH), load_json(SOURCE_PATH), load_json(ENVIRONMENT_PATH))
    print("windows compatibility build version lock: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BuildVersionLockError as exc:
        print(f"windows-compat-build-version-lock: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
