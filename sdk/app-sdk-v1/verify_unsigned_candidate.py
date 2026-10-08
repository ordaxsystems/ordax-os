#!/usr/bin/env python3
"""Verify a public-only unsigned external first-party app candidate.

This verifier is deliberately read-only. It validates the deterministic
ordax-apps handoff before any external runtime-component signing operation.
It never reads a private key, signs, publishes, stages, installs or activates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import stat
from pathlib import Path, PurePosixPath
import zipfile

HANDOFF_SCHEMA = "ordax-apps.unsigned-component-candidate/1"
PACKAGE_SCHEMA = "prototype-ordax.runtime-component-package/1"
RELEASE_SCHEMA = "prototype-ordax.runtime-component-release/2"
COMPATIBILITY_SCHEMA = "ordax.component-compatibility/1"
POLICY_SCHEMA = "prototype-ordax.runtime-component-package-policy/1"
TRUST_DOMAIN = "runtime-components"
KEY_ID = "ordax-runtime-components-v1"
EXPECTED_SOURCE_REPOSITORY = "ordaxsystems/ordax-apps"
PACKAGE_POLICY = Path("docs/contracts/runtime-component-package.json")

SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")
APP_ID = re.compile(r"^[a-z][a-z0-9-]{0,63}$")
SEMVER = re.compile(r"^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$")
MAX_PACKAGE_BYTES = 32 * 1024 * 1024
MAX_DESCRIPTOR_BYTES = 512 * 1024
MAX_FILES = 256
MAX_FILE_BYTES = 2 * 1024 * 1024
MAX_TOTAL_BYTES = 16 * 1024 * 1024


class CandidateError(RuntimeError):
    pass


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise CandidateError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _canonical_json(value: object) -> bytes:
    return (json.dumps(value, indent=2, sort_keys=True, ensure_ascii=False) + "\n").encode("utf-8")


def _sha256(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _regular_bytes(path: Path, *, label: str, max_bytes: int) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise CandidateError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise CandidateError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise CandidateError(f"{label} size is outside allowed bounds")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise CandidateError(f"cannot read {label}") from exc


def _json_bytes(payload: bytes, label: str, *, canonical: bool = True) -> dict:
    try:
        value = json.loads(
            payload.decode("utf-8"),
            object_pairs_hook=_no_duplicates,
        )
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise CandidateError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise CandidateError(f"{label} must contain one JSON object")
    if canonical and payload != _canonical_json(value):
        raise CandidateError(f"{label} is not canonical deterministic JSON")
    return value


def _safe_package_path(value: str) -> PurePosixPath:
    if (
        not isinstance(value, str)
        or not value
        or value.startswith("/")
        or "\\" in value
        or "\x00" in value
    ):
        raise CandidateError("package path is unsafe")
    path = PurePosixPath(value)
    if any(part in {"", ".", ".."} for part in path.parts):
        raise CandidateError("package path is unsafe")
    return path


def _validate_package(
    package_path: Path,
    *,
    app_id: str,
    version: str,
    source_commit: str,
    source_repository: str,
) -> tuple[dict, bytes, bytes]:
    package_bytes = _regular_bytes(
        package_path,
        label="unsigned package",
        max_bytes=MAX_PACKAGE_BYTES,
    )
    try:
        archive = zipfile.ZipFile(package_path, "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise CandidateError("unsigned package is not a valid ZIP") from exc

    with archive:
        infos = archive.infolist()
        if not infos or len(infos) > MAX_FILES + 1:
            raise CandidateError("unsigned package entry count is outside allowed bounds")
        names = [info.filename for info in infos]
        if len(names) != len(set(names)) or "component-package.json" not in names:
            raise CandidateError("unsigned package entries are duplicated or manifest is missing")
        for info in infos:
            _safe_package_path(info.filename)
            mode = (info.external_attr >> 16) & 0o170000
            permissions = (info.external_attr >> 16) & 0o777
            if (
                info.is_dir()
                or mode == stat.S_IFLNK
                or info.compress_type != zipfile.ZIP_STORED
                or info.date_time != (1980, 1, 1, 0, 0, 0)
                or permissions != 0o644
            ):
                raise CandidateError("unsigned package is not in canonical deterministic ZIP form")

        manifest_bytes = archive.read("component-package.json")
        manifest = _json_bytes(manifest_bytes, "component package manifest")
        if set(manifest) != {
            "$schema",
            "status",
            "component",
            "source_commit",
            "entrypoint",
            "self_contained_source_graph",
            "remote_runtime_dependencies",
            "activation_allowed",
            "signature_required_before_activation",
            "native_adapters_packaged",
            "composition_packaged",
            "files",
        }:
            raise CandidateError("component package manifest fields are not canonical")
        if manifest.get("$schema") != PACKAGE_SCHEMA or manifest.get("status") != "candidate":
            raise CandidateError("component package manifest schema/status is invalid")
        if manifest.get("source_commit") != source_commit:
            raise CandidateError("component package source commit does not match handoff")

        component = manifest.get("component")
        if not isinstance(component, dict) or set(component) != {
            "id",
            "title",
            "kind",
            "version",
            "releaseMode",
            "criticality",
            "failureDomain",
            "restartScope",
            "healthMode",
            "owner",
            "dependencies",
        }:
            raise CandidateError("component package identity shape is invalid")
        if (
            component.get("id") != app_id
            or component.get("version") != version
            or component.get("releaseMode") != "component-slot"
            or component.get("owner") != source_repository
            or component.get("kind") != "app"
        ):
            raise CandidateError("component package identity does not match external app handoff")
        if component.get("dependencies") is None or not isinstance(component["dependencies"], list):
            raise CandidateError("component package dependencies are invalid")

        expected_entrypoint = f"system/apps/{app_id}/src/runtime.mjs"
        if manifest.get("entrypoint") != expected_entrypoint:
            raise CandidateError("component package entrypoint is not canonical")
        for field, expected in {
            "self_contained_source_graph": True,
            "remote_runtime_dependencies": False,
            "activation_allowed": False,
            "signature_required_before_activation": True,
            "native_adapters_packaged": False,
            "composition_packaged": False,
        }.items():
            if manifest.get(field) is not expected:
                raise CandidateError(f"component package safety boundary drifted: {field}")

        records = manifest.get("files")
        if not isinstance(records, list) or not records or len(records) > MAX_FILES:
            raise CandidateError("component package file records are invalid")
        expected_names = {"component-package.json"}
        seen = set()
        total = 0
        for record in records:
            if not isinstance(record, dict) or set(record) != {"path", "sha256", "size"}:
                raise CandidateError("component package file record is malformed")
            path = _safe_package_path(record["path"]).as_posix()
            if not path.startswith(f"system/apps/{app_id}/") or path in seen:
                raise CandidateError("component package file crossed ownership or is duplicated")
            size = record["size"]
            digest = record["sha256"]
            if (
                isinstance(size, bool)
                or not isinstance(size, int)
                or size <= 0
                or size > MAX_FILE_BYTES
                or not isinstance(digest, str)
                or SHA256.fullmatch(digest) is None
            ):
                raise CandidateError("component package file record bounds are invalid")
            try:
                body = archive.read(path)
            except KeyError as exc:
                raise CandidateError(f"component package file is missing: {path}") from exc
            if len(body) != size or _sha256(body) != digest:
                raise CandidateError(f"component package file integrity mismatch: {path}")
            seen.add(path)
            expected_names.add(path)
            total += size
            if total > MAX_TOTAL_BYTES:
                raise CandidateError("component package total payload exceeds allowed bound")

        if set(names) != expected_names:
            raise CandidateError("component package archive set does not match manifest")
        for required in {
            expected_entrypoint,
            f"system/apps/{app_id}/ai/manifest.json",
            f"system/apps/{app_id}/actions/manifest.json",
        }:
            if required not in seen:
                raise CandidateError(f"component package required app file is missing: {required}")

    return manifest, manifest_bytes, package_bytes


def _validate_sha256s(candidate_dir: Path, expected_files: set[str]) -> None:
    sums_path = candidate_dir / "SHA256SUMS"
    payload = _regular_bytes(sums_path, label="SHA256SUMS", max_bytes=16 * 1024)
    try:
        lines = payload.decode("utf-8").splitlines()
    except UnicodeError as exc:
        raise CandidateError("SHA256SUMS is not UTF-8") from exc
    actual = {}
    for line in lines:
        if len(line) < 67 or line[64:66] not in {"  ", " *"}:
            raise CandidateError("SHA256SUMS line is malformed")
        digest = line[:64]
        name = line[66:]
        if SHA256.fullmatch(digest) is None or not name or "/" in name or "\\" in name:
            raise CandidateError("SHA256SUMS entry is invalid")
        if name in actual:
            raise CandidateError("SHA256SUMS contains duplicate filenames")
        actual[name] = digest
    if set(actual) != expected_files:
        raise CandidateError("SHA256SUMS file set does not match candidate")
    for name, digest in actual.items():
        body = _regular_bytes(
            candidate_dir / name,
            label=f"candidate artifact {name}",
            max_bytes=MAX_PACKAGE_BYTES,
        )
        if _sha256(body) != digest:
            raise CandidateError(f"SHA256SUMS digest mismatch: {name}")


def verify(candidate_dir: Path, package_policy_path: Path) -> dict:
    root = candidate_dir.resolve()
    try:
        metadata = root.lstat()
    except OSError as exc:
        raise CandidateError("candidate directory is unavailable") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise CandidateError("candidate directory must be a real directory")

    policy_bytes = _regular_bytes(
        package_policy_path,
        label="runtime-component package policy",
        max_bytes=MAX_DESCRIPTOR_BYTES,
    )
    policy = _json_bytes(policy_bytes, "runtime-component package policy", canonical=False)
    if policy.get("$schema") != POLICY_SCHEMA or policy.get("trust_domain") != TRUST_DOMAIN:
        raise CandidateError("runtime-component package policy identity is invalid")
    external_sources = policy.get("canonical_external_source_repository_by_component")
    if not isinstance(external_sources, dict):
        raise CandidateError("runtime-component external source policy is missing")

    handoff_files = [
        path for path in root.iterdir()
        if path.name.endswith(".unsigned-candidate.json")
    ]
    if len(handoff_files) != 1:
        raise CandidateError("candidate directory must contain exactly one unsigned handoff")
    handoff_path = handoff_files[0]
    handoff_bytes = _regular_bytes(
        handoff_path,
        label="unsigned candidate handoff",
        max_bytes=MAX_DESCRIPTOR_BYTES,
    )
    handoff = _json_bytes(handoff_bytes, "unsigned candidate handoff")

    if set(handoff) != {
        "$schema",
        "status",
        "component",
        "source",
        "artifacts",
        "trust",
        "authority",
        "safety",
    }:
        raise CandidateError("unsigned candidate handoff fields are not canonical")
    if handoff.get("$schema") != HANDOFF_SCHEMA or handoff.get("status") != "unsigned-candidate":
        raise CandidateError("unsigned candidate handoff schema/status is invalid")

    component = handoff.get("component")
    if not isinstance(component, dict) or set(component) != {"id", "version", "releaseMode"}:
        raise CandidateError("unsigned candidate component identity is invalid")
    app_id = component.get("id")
    version = component.get("version")
    if (
        not isinstance(app_id, str)
        or APP_ID.fullmatch(app_id) is None
        or not isinstance(version, str)
        or SEMVER.fullmatch(version) is None
        or component.get("releaseMode") != "component-slot"
    ):
        raise CandidateError("unsigned candidate component identity is invalid")

    source = handoff.get("source")
    if not isinstance(source, dict) or set(source) != {"repository", "commit"}:
        raise CandidateError("unsigned candidate source identity is invalid")
    source_repository = source.get("repository")
    source_commit = source.get("commit")
    if (
        source_repository != EXPECTED_SOURCE_REPOSITORY
        or external_sources.get(app_id) != source_repository
        or not isinstance(source_commit, str)
        or SHA40.fullmatch(source_commit) is None
    ):
        raise CandidateError("unsigned candidate source is not canonical for this component")

    trust = handoff.get("trust")
    if trust != {
        "domain": TRUST_DOMAIN,
        "requiredKeyId": KEY_ID,
        "canonicalPublicAnchorRequiredBeforeProductionSigning": True,
    }:
        raise CandidateError("unsigned candidate trust requirements drifted")
    if handoff.get("authority") != {
        "signing": False,
        "publication": False,
        "installation": False,
        "activation": False,
    }:
        raise CandidateError("unsigned candidate must carry no authority")
    if handoff.get("safety") != {
        "containsPrivateKeyMaterial": False,
        "directActivationAllowed": False,
        "platformLifecycleRequired": True,
    }:
        raise CandidateError("unsigned candidate safety boundary drifted")

    artifacts = handoff.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != {
        "package",
        "release",
        "compatibility",
    }:
        raise CandidateError("unsigned candidate artifact bindings are invalid")

    expected_names = {
        "package": f"{app_id}.zip",
        "release": f"{app_id}.release.json",
        "compatibility": f"{app_id}.compatibility.json",
    }
    artifact_bytes = {}
    for kind, expected_name in expected_names.items():
        binding = artifacts.get(kind)
        if not isinstance(binding, dict) or set(binding) != {"name", "sha256", "size"}:
            raise CandidateError(f"unsigned candidate {kind} binding is malformed")
        if binding.get("name") != expected_name:
            raise CandidateError(f"unsigned candidate {kind} filename is not canonical")
        expected_digest = binding.get("sha256")
        expected_size = binding.get("size")
        if (
            not isinstance(expected_digest, str)
            or SHA256.fullmatch(expected_digest) is None
            or isinstance(expected_size, bool)
            or not isinstance(expected_size, int)
            or expected_size <= 0
        ):
            raise CandidateError(f"unsigned candidate {kind} binding is invalid")
        limit = MAX_PACKAGE_BYTES if kind == "package" else MAX_DESCRIPTOR_BYTES
        payload = _regular_bytes(root / expected_name, label=f"unsigned {kind}", max_bytes=limit)
        if len(payload) != expected_size or _sha256(payload) != expected_digest:
            raise CandidateError(f"unsigned candidate {kind} does not match handoff")
        artifact_bytes[kind] = payload

    manifest, manifest_bytes, package_bytes = _validate_package(
        root / expected_names["package"],
        app_id=app_id,
        version=version,
        source_commit=source_commit,
        source_repository=source_repository,
    )
    if package_bytes != artifact_bytes["package"]:
        raise CandidateError("package bytes changed during verification")

    release = _json_bytes(artifact_bytes["release"], "unsigned release descriptor")
    if set(release) != {
        "$schema",
        "source_repository",
        "source_commit",
        "created_from_ci_recipe",
        "component",
        "package",
        "activation",
        "compatibility",
    }:
        raise CandidateError("unsigned release descriptor fields are not canonical")
    if (
        release.get("$schema") != RELEASE_SCHEMA
        or release.get("source_repository") != source_repository
        or release.get("source_commit") != source_commit
        or release.get("created_from_ci_recipe") != "runtime-component/package/1"
    ):
        raise CandidateError("unsigned release provenance is invalid")
    if release.get("component") != {
        "id": app_id,
        "version": version,
        "release_mode": "component-slot",
        "package_schema": PACKAGE_SCHEMA,
    }:
        raise CandidateError("unsigned release component identity is invalid")
    if release.get("activation") != {
        "direct_activation_allowed": False,
        "pending_health_required": True,
    }:
        raise CandidateError("unsigned release activation boundary is invalid")

    package_binding = release.get("package")
    if not isinstance(package_binding, dict) or set(package_binding) != {
        "name",
        "sha256",
        "size",
        "manifest_sha256",
    }:
        raise CandidateError("unsigned release package binding is malformed")
    if package_binding != {
        "name": expected_names["package"],
        "sha256": _sha256(package_bytes),
        "size": len(package_bytes),
        "manifest_sha256": _sha256(manifest_bytes),
    }:
        raise CandidateError("unsigned release package binding does not match package")

    compatibility = _json_bytes(
        artifact_bytes["compatibility"],
        "unsigned compatibility descriptor",
    )
    if set(compatibility) != {
        "schema",
        "componentId",
        "componentVersion",
        "provides",
        "requires",
        "state",
        "authority",
    }:
        raise CandidateError("unsigned compatibility descriptor fields are not canonical")
    if (
        compatibility.get("schema") != COMPATIBILITY_SCHEMA
        or compatibility.get("componentId") != app_id
        or compatibility.get("componentVersion") != version
        or compatibility.get("authority") != "none"
    ):
        raise CandidateError("unsigned compatibility identity is invalid")

    compatibility_binding = release.get("compatibility")
    if not isinstance(compatibility_binding, dict) or set(compatibility_binding) != {
        "name",
        "schema",
        "sha256",
        "size",
    }:
        raise CandidateError("unsigned release compatibility binding is malformed")
    if compatibility_binding != {
        "name": expected_names["compatibility"],
        "schema": COMPATIBILITY_SCHEMA,
        "sha256": _sha256(artifact_bytes["compatibility"]),
        "size": len(artifact_bytes["compatibility"]),
    }:
        raise CandidateError("unsigned release compatibility binding does not match sidecar")

    expected_artifacts = {
        expected_names["package"],
        expected_names["release"],
        expected_names["compatibility"],
        handoff_path.name,
    }
    actual_files = {
        path.name for path in root.iterdir()
        if path.is_file() and not path.is_symlink()
    }
    if actual_files != expected_artifacts | {"SHA256SUMS"}:
        raise CandidateError("candidate directory contains unexpected or missing files")
    _validate_sha256s(root, expected_artifacts)

    return {
        "component_id": app_id,
        "version": version,
        "source_repository": source_repository,
        "source_commit": source_commit,
        "handoff_sha256": _sha256(handoff_bytes),
        "package_sha256": _sha256(package_bytes),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--candidate-dir", type=Path, required=True)
    parser.add_argument(
        "--package-policy",
        type=Path,
        default=Path(__file__).resolve().parents[2] / PACKAGE_POLICY,
    )
    args = parser.parse_args()

    try:
        result = verify(args.candidate_dir, args.package_policy)
    except (CandidateError, OSError, ValueError, zipfile.BadZipFile) as exc:
        print(f"RUNTIME_COMPONENT_UNSIGNED_CANDIDATE=FAIL\n{exc}")
        return 1

    print("RUNTIME_COMPONENT_UNSIGNED_CANDIDATE=PASS")
    print(f"COMPONENT_ID={result['component_id']}")
    print(f"COMPONENT_VERSION={result['version']}")
    print(f"SOURCE_REPOSITORY={result['source_repository']}")
    print(f"SOURCE_COMMIT={result['source_commit']}")
    print(f"HANDOFF_SHA256={result['handoff_sha256']}")
    print(f"PACKAGE_SHA256={result['package_sha256']}")
    print("PRIVATE_KEY_READ=NO")
    print("SIGNING_PERFORMED=NO")
    print("PUBLICATION_PERFORMED=NO")
    print("INSTALLATION_PERFORMED=NO")
    print("ACTIVATION_PERFORMED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
