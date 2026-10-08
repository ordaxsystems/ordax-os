#!/usr/bin/env python3
"""Validate the pinned APK content identity for the Wine build environment."""

from __future__ import annotations

import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
CONTENT_LOCK_PATH = HERE / "apk-content-lock.json"
VERSION_LOCK_PATH = HERE / "build-version-lock.json"
SOURCE_PATH = HERE / "source.json"

SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_DIGEST_RE = re.compile(r"^sha256:[0-9a-f]{64}$")


class ApkContentLockError(RuntimeError):
    pass


def load_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ApkContentLockError(f"cannot read {path.name}: {exc}") from exc
    if not isinstance(value, dict):
        raise ApkContentLockError(f"{path.name} must contain an object")
    return value


def validate_lock(lock: dict, version_lock: dict, source: dict) -> dict:
    if lock.get("$schema") != "prototype-ordax.windows-compat-apk-content-lock/1":
        raise ApkContentLockError("unexpected APK content lock schema")
    if lock.get("status") != "content-locked-from-offline-replayed-discovery-not-build-proven":
        raise ApkContentLockError("APK content lock status drifted")

    if lock.get("runtime_id") != version_lock.get("runtime_id") or lock.get("runtime_id") != source.get("runtime_id"):
        raise ApkContentLockError("runtime identity drifted")
    if lock.get("wine_version") != version_lock.get("wine_version") or lock.get("wine_version") != source.get("version"):
        raise ApkContentLockError("Wine version drifted")
    if lock.get("host_rootfs_sha256") != version_lock.get("host", {}).get("rootfs_sha256"):
        raise ApkContentLockError("host rootfs identity drifted")
    if not SHA256_RE.fullmatch(str(lock.get("host_rootfs_sha256", ""))):
        raise ApkContentLockError("host rootfs digest invalid")

    closure = lock.get("resolved_closure")
    version_closure = version_lock.get("resolved_closure")
    if not isinstance(closure, dict) or not isinstance(version_closure, dict):
        raise ApkContentLockError("resolved closure identity missing")
    expected_closure = {
        "package_count": version_closure.get("package_count"),
        "canonical_json_sha256": version_closure.get("canonical_json_sha256"),
    }
    if closure != expected_closure:
        raise ApkContentLockError("resolved closure drifted")
    if not SHA256_RE.fullmatch(str(closure.get("canonical_json_sha256", ""))):
        raise ApkContentLockError("resolved closure digest invalid")

    apk_set = lock.get("external_apk_set")
    expected_fields = ["filename", "sha256", "size_bytes", "version"]
    if not isinstance(apk_set, dict):
        raise ApkContentLockError("external APK set missing")
    if apk_set.get("package_count") != 327:
        raise ApkContentLockError("external APK package count drifted")
    if apk_set.get("total_size_bytes") != 595197429:
        raise ApkContentLockError("external APK byte size drifted")
    if apk_set.get("canonical_manifest_sha256") != "a3ccadb533a23b3c5362df177740cef4478cd79ea3b361ed03eb04534485d2c9":
        raise ApkContentLockError("external APK manifest digest drifted")
    if not SHA256_RE.fullmatch(str(apk_set.get("canonical_manifest_sha256", ""))):
        raise ApkContentLockError("external APK manifest digest invalid")
    if apk_set.get("canonicalization") != "sorted-package-map-json-no-whitespace":
        raise ApkContentLockError("external APK manifest canonicalization drifted")
    if apk_set.get("manifest_entry_fields") != expected_fields:
        raise ApkContentLockError("external APK manifest field contract drifted")
    meaning = apk_set.get("meaning")
    if not isinstance(meaning, str) or "SHA-256" not in meaning or "exact version" not in meaning:
        raise ApkContentLockError("external APK manifest meaning is incomplete")

    provenance = lock.get("provenance")
    if not isinstance(provenance, dict):
        raise ApkContentLockError("content discovery provenance missing")
    if provenance.get("discovery_head_sha") != "9ef37e4a0191a655a8d6e957db32063ebf2b9802":
        raise ApkContentLockError("content discovery source commit drifted")
    if provenance.get("workflow_run_id") != 37812741652:
        raise ApkContentLockError("content discovery workflow provenance drifted")
    if provenance.get("artifact_id") != 11564979845:
        raise ApkContentLockError("content discovery artifact provenance drifted")
    if provenance.get("artifact_digest") != "sha256:134ac687d31a1f3a43aa17a7a123505bd005aa158c1db341343440f7969aa6a8":
        raise ApkContentLockError("content discovery artifact digest drifted")
    if not ARTIFACT_DIGEST_RE.fullmatch(str(provenance.get("artifact_digest", ""))):
        raise ApkContentLockError("content discovery artifact digest invalid")

    version_gates = version_lock.get("gates")
    if not isinstance(version_gates, dict):
        raise ApkContentLockError("version lock gates missing")
    if version_gates.get("package_versions_pinned") is not True or version_gates.get("transitive_closure_digest_pinned") is not True:
        raise ApkContentLockError("content lock requires a proven version/closure lock")
    if version_gates.get("apk_content_hashes_pinned") is not False:
        raise ApkContentLockError("version lock must remain the pre-content historical stage")

    expected_gates = {
        "version_lock_verified": True,
        "closure_reproduced": True,
        "offline_content_replay_passed": True,
        "apk_content_hashes_pinned": True,
        "full_build_proof_passed": False,
        "runtime_dependency_inventory_complete": False,
        "binary_artifact_pinned": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }
    if lock.get("gates") != expected_gates:
        raise ApkContentLockError("APK content lock overclaims readiness")
    return lock


def main() -> int:
    validate_lock(load_json(CONTENT_LOCK_PATH), load_json(VERSION_LOCK_PATH), load_json(SOURCE_PATH))
    print("windows compatibility APK content lock: PASS")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ApkContentLockError as exc:
        print(f"windows-compat-apk-content-lock: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
