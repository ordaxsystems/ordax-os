#!/usr/bin/env python3
"""Validate the public-only Canonical v4 signing-request assembly boundary.

This tool never signs, publishes, activates, selects a physical target, or writes media.
It validates an operator request, exact GitHub Actions run/artifact identities, the
exported operator receipts and bytes, the pinned public trust, and the generated
release-manifest/4 before a small unsigned signing package is exported.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
from urllib.parse import urlsplit

REPOSITORY = "ordaxsystems/ordax-os"
REQUEST_SCHEMA = "prototype-ordax.canonical-v4-signing-request/1"
RECEIPT_SCHEMA = "prototype-ordax.canonical-v4-operator-artifact/1"
RESULT_SCHEMA = "prototype-ordax.canonical-v4-signing-request-validation/1"
TRUST_SCHEMA = "prototype-ordax.release-trust/1"
TRUST_KEY_ID = "ordax-prototype-release-v1"
MANIFEST_SCHEMA = "prototype-ordax.release-manifest/4"
SOURCE_LOCK_SCHEMA = "prototype-ordax.local-ai-source-lock/1"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

UNSAFE_FIELDS = (
    "publication_performed",
    "signing_performed",
    "release_activated",
    "physical_target_selected",
    "physical_write_authorized",
    "physical_write_performed",
)

KIND_SPECS = {
    "system": {
        "workflow_path": ".github/workflows/portable-release-image.yml",
        "artifact_prefix": "canonical-v4-operator-system-",
        "files": ("system.erofs",),
    },
    "surface": {
        "workflow_path": ".github/workflows/surface-runtime-lock-discovery.yml",
        "artifact_prefix": "canonical-v4-operator-surface-",
        "files": ("native-surface-runtime.erofs",),
    },
    "local-ai": {
        "workflow_path": ".github/workflows/local-ai-runtime-candidate.yml",
        "artifact_prefix": "canonical-v4-operator-local-ai-",
        "files": ("local-ai-runtime.erofs", "source-lock.json"),
    },
}

MANIFEST_ARTIFACTS = (
    ("system.erofs", "system-image", "system"),
    ("native-surface-runtime.erofs", "surface-runtime", "surface"),
    ("local-ai-runtime.erofs", "local-ai-runtime", "local-ai"),
)


class ValidationError(RuntimeError):
    pass


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValidationError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _regular_bytes(path: Path, label: str) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise ValidationError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise ValidationError(f"{label} must be a regular non-symlink file")
    try:
        payload = path.read_bytes()
    except OSError as exc:
        raise ValidationError(f"{label} cannot be read: {path}") from exc
    if not payload:
        raise ValidationError(f"{label} is empty: {path}")
    return payload


def _json_bytes(payload: bytes, label: str) -> dict:
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=_no_duplicates)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise ValidationError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise ValidationError(f"{label} must contain one JSON object")
    return value


def _load_json(path: Path, label: str) -> tuple[dict, bytes]:
    payload = _regular_bytes(path, label)
    return _json_bytes(payload, label), payload


def _sha(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _file_identity(path: Path) -> dict:
    payload = _regular_bytes(path, path.name)
    return {"sha256": _sha(payload), "size": len(payload)}


def _positive_int(value: object, label: str) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value <= 0:
        raise ValidationError(f"{label} must be a positive integer")
    return value


def _stable_https(value: object, label: str) -> str:
    if not isinstance(value, str):
        raise ValidationError(f"{label} must be a string")
    try:
        parsed = urlsplit(value)
    except ValueError as exc:
        raise ValidationError(f"{label} is not a valid URL") from exc
    if not all(
        (
            parsed.scheme == "https",
            bool(parsed.hostname),
            parsed.username is None,
            parsed.password is None,
            parsed.query == "",
            parsed.fragment == "",
        )
    ):
        raise ValidationError(
            f"{label} must be stable public HTTPS without credentials, query or fragment"
        )
    return value


def validate_request_document(request: dict) -> dict:
    if request.get("$schema") != REQUEST_SCHEMA:
        raise ValidationError("signing request schema is invalid")
    if request.get("status") != "pending-public-assembly":
        raise ValidationError("signing request status is not pending-public-assembly")
    if request.get("source_repository") != REPOSITORY:
        raise ValidationError("signing request source repository is invalid")
    source_commit = request.get("source_commit")
    if not isinstance(source_commit, str) or HEX40.fullmatch(source_commit) is None:
        raise ValidationError("signing request source commit must be lowercase 40-hex")
    expected_tag = f"ordax-stable-v4-{source_commit}"
    if request.get("release_tag") != expected_tag:
        raise ValidationError("release tag is not bound to the exact source commit")

    operator = request.get("operator_artifacts")
    if not isinstance(operator, dict) or set(operator) != set(KIND_SPECS):
        raise ValidationError("operator artifact set must be exactly system/surface/local-ai")
    for kind, spec in KIND_SPECS.items():
        entry = operator.get(kind)
        if not isinstance(entry, dict):
            raise ValidationError(f"operator artifact entry is invalid: {kind}")
        _positive_int(entry.get("run_id"), f"{kind}.run_id")
        _positive_int(entry.get("artifact_id"), f"{kind}.artifact_id")
        if entry.get("workflow_path") != spec["workflow_path"]:
            raise ValidationError(f"operator workflow path is invalid: {kind}")
        expected_name = spec["artifact_prefix"] + source_commit
        if entry.get("artifact_name") != expected_name:
            raise ValidationError(f"operator artifact name is invalid: {kind}")

    urls = request.get("artifact_urls")
    expected_names = {name for name, _, _ in MANIFEST_ARTIFACTS}
    if not isinstance(urls, dict) or set(urls) != expected_names:
        raise ValidationError("artifact URL set is invalid")
    prefix = f"https://github.com/{REPOSITORY}/releases/download/{expected_tag}/"
    for name in sorted(expected_names):
        value = _stable_https(urls[name], f"artifact_urls.{name}")
        if value != prefix + name:
            raise ValidationError(f"artifact URL is outside the canonical release namespace: {name}")

    for field in UNSAFE_FIELDS:
        if request.get(field) is not False:
            raise ValidationError(f"signing request unexpectedly claims {field}")
    return request


def _tree_files(root: Path, label: str) -> list[Path]:
    try:
        root_meta = root.lstat()
    except OSError as exc:
        raise ValidationError(f"{label} directory is unavailable: {root}") from exc
    if stat.S_ISLNK(root_meta.st_mode) or not stat.S_ISDIR(root_meta.st_mode):
        raise ValidationError(f"{label} must be a real directory")
    files: list[Path] = []
    for path in root.rglob("*"):
        metadata = path.lstat()
        if stat.S_ISLNK(metadata.st_mode):
            raise ValidationError(f"{label} contains a symlink/reparse-like entry: {path}")
        if stat.S_ISREG(metadata.st_mode):
            files.append(path)
        elif not stat.S_ISDIR(metadata.st_mode):
            raise ValidationError(f"{label} contains an unsupported filesystem entry: {path}")
    return files


def _unique_named(files: list[Path], name: str, label: str) -> Path:
    matches = [path for path in files if path.name == name]
    if len(matches) != 1:
        raise ValidationError(f"{label} must contain exactly one {name}; found {len(matches)}")
    return matches[0]


def _validate_run_and_artifact_metadata(
    *, kind: str, request: dict, metadata_dir: Path
) -> dict:
    entry = request["operator_artifacts"][kind]
    run, run_payload = _load_json(metadata_dir / f"{kind}-run.json", f"{kind} run metadata")
    artifact, artifact_payload = _load_json(
        metadata_dir / f"{kind}-artifact.json", f"{kind} artifact metadata"
    )
    source_commit = request["source_commit"]
    expected_run = entry["run_id"]
    expected_artifact = entry["artifact_id"]

    if run.get("id") != expected_run:
        raise ValidationError(f"{kind} run metadata ID mismatch")
    if run.get("event") != "workflow_dispatch":
        raise ValidationError(f"{kind} run was not manually dispatched")
    if run.get("status") != "completed" or run.get("conclusion") != "success":
        raise ValidationError(f"{kind} run is not a completed success")
    if run.get("head_sha") != source_commit or run.get("head_branch") != "main":
        raise ValidationError(f"{kind} run is not bound to the requested main source commit")
    if run.get("path") != entry["workflow_path"]:
        raise ValidationError(f"{kind} run workflow path mismatch")

    if artifact.get("id") != expected_artifact:
        raise ValidationError(f"{kind} artifact metadata ID mismatch")
    if artifact.get("name") != entry["artifact_name"]:
        raise ValidationError(f"{kind} artifact metadata name mismatch")
    if artifact.get("expired") is not False:
        raise ValidationError(f"{kind} operator artifact is expired")
    workflow_run = artifact.get("workflow_run")
    if not isinstance(workflow_run, dict):
        raise ValidationError(f"{kind} artifact workflow binding is missing")
    if workflow_run.get("id") != expected_run:
        raise ValidationError(f"{kind} artifact belongs to another run")
    if workflow_run.get("head_sha") != source_commit or workflow_run.get("head_branch") != "main":
        raise ValidationError(f"{kind} artifact belongs to another source commit/branch")

    return {
        "run_metadata_sha256": _sha(run_payload),
        "artifact_metadata_sha256": _sha(artifact_payload),
        "artifact_zip_digest": artifact.get("digest"),
    }


def _validate_operator_artifact(*, kind: str, root: Path, request: dict) -> tuple[dict, dict]:
    spec = KIND_SPECS[kind]
    files = _tree_files(root, f"{kind} operator artifact")
    expected_names = set(spec["files"]) | {"operator-receipt.json"}
    names = [path.name for path in files]
    if len(names) != len(expected_names) or set(names) != expected_names:
        raise ValidationError(
            f"{kind} operator artifact file set is invalid: {sorted(names)}"
        )
    receipt_path = _unique_named(files, "operator-receipt.json", kind)
    receipt, receipt_payload = _load_json(receipt_path, f"{kind} operator receipt")
    if receipt.get("$schema") != RECEIPT_SCHEMA or receipt.get("kind") != kind:
        raise ValidationError(f"{kind} operator receipt identity is invalid")
    if receipt.get("source_commit") != request["source_commit"]:
        raise ValidationError(f"{kind} operator receipt source commit mismatch")
    for field in UNSAFE_FIELDS:
        if receipt.get(field) is not False:
            raise ValidationError(f"{kind} operator receipt unexpectedly claims {field}")

    receipt_files = receipt.get("files")
    if not isinstance(receipt_files, list):
        raise ValidationError(f"{kind} receipt files field is invalid")
    by_name = {}
    for item in receipt_files:
        if not isinstance(item, dict) or not isinstance(item.get("name"), str):
            raise ValidationError(f"{kind} receipt contains an invalid file entry")
        name = item["name"]
        if name in by_name:
            raise ValidationError(f"{kind} receipt contains duplicate file entry: {name}")
        by_name[name] = item
    if set(by_name) != set(spec["files"]):
        raise ValidationError(f"{kind} receipt file set is invalid")

    identities = {}
    paths = {}
    for name in spec["files"]:
        path = _unique_named(files, name, kind)
        identity = _file_identity(path)
        entry = by_name[name]
        if entry.get("sha256") != identity["sha256"] or entry.get("size") != identity["size"]:
            raise ValidationError(f"{kind} receipt does not match downloaded bytes: {name}")
        identities[name] = identity
        paths[name] = path

    return {
        "receipt_sha256": _sha(receipt_payload),
        "files": identities,
    }, paths


def _validate_source_lock(path: Path) -> tuple[dict, bytes]:
    lock, payload = _load_json(path, "local AI source lock")
    if lock.get("$schema") != SOURCE_LOCK_SCHEMA:
        raise ValidationError("local AI source lock schema is invalid")
    if not isinstance(lock.get("engine"), dict) or not isinstance(lock.get("model"), dict):
        raise ValidationError("local AI source lock identity is incomplete")
    return lock, payload


def _validate_trust(path: Path) -> tuple[dict, bytes]:
    trust, payload = _load_json(path, "canonical public trust")
    if trust.get("$schema") != TRUST_SCHEMA or trust.get("key_id") != TRUST_KEY_ID:
        raise ValidationError("canonical public trust identity is invalid")
    if not isinstance(trust.get("public_key_base64"), str) or not trust["public_key_base64"]:
        raise ValidationError("canonical public trust key is missing")
    return trust, payload


def _validate_manifest(
    *, manifest_path: Path, request: dict, identities: dict, source_lock: dict, source_lock_payload: bytes
) -> tuple[dict, bytes]:
    manifest, payload = _load_json(manifest_path, "release-manifest/4")
    source_commit = request["source_commit"]
    if manifest.get("$schema") != MANIFEST_SCHEMA:
        raise ValidationError("generated release manifest schema is invalid")
    expected_header = {
        "source_repository": REPOSITORY,
        "source_commit": source_commit,
        "release_id": source_commit,
        "created_from_ci_recipe": "release/portable-usb-v2-local-ai/1",
        "product_mode": "usb",
        "storage_profile": "portable-usb-v2",
        "runtime_format": "erofs",
    }
    for key, value in expected_header.items():
        if manifest.get(key) != value:
            raise ValidationError(f"generated release manifest field mismatch: {key}")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list) or len(artifacts) != len(MANIFEST_ARTIFACTS):
        raise ValidationError("generated release manifest artifact count is invalid")
    for index, (name, role, kind) in enumerate(MANIFEST_ARTIFACTS):
        entry = artifacts[index]
        identity = identities[kind][name]
        expected = {
            "name": name,
            "role": role,
            "url": request["artifact_urls"][name],
            "sha256": identity["sha256"],
            "size": identity["size"],
        }
        if not isinstance(entry, dict) or any(entry.get(k) != v for k, v in expected.items()):
            raise ValidationError(f"generated release manifest artifact mismatch: {name}")

    local_ai = manifest.get("local_ai")
    if not isinstance(local_ai, dict):
        raise ValidationError("generated release manifest local_ai binding is missing")
    expected_local_ai = {
        "contract": "ordax.local-ai/1",
        "source_lock_schema": SOURCE_LOCK_SCHEMA,
        "source_lock_sha256": _sha(source_lock_payload),
        "engine_id": source_lock["engine"].get("id"),
        "engine_repository": source_lock["engine"].get("repository"),
        "engine_source_commit": source_lock["engine"].get("commit"),
        "engine_license": source_lock["engine"].get("license"),
        "model_id": source_lock["model"].get("id"),
        "model_repository": source_lock["model"].get("repository"),
        "model_filename": source_lock["model"].get("filename"),
        "model_upstream_revision": source_lock["model"].get("upstream_revision"),
        "model_sha256": source_lock["model"].get("sha256"),
        "model_size": source_lock["model"].get("size_bytes"),
        "model_license": source_lock["model"].get("license"),
    }
    if any(local_ai.get(k) != v for k, v in expected_local_ai.items()):
        raise ValidationError("generated release manifest local_ai binding mismatch")
    return manifest, payload


def validate_all(
    *, request_path: Path, metadata_dir: Path, artifact_dirs: dict[str, Path], trust_path: Path,
    manifest_path: Path, output_path: Path
) -> dict:
    request, request_payload = _load_json(request_path, "canonical v4 signing request")
    validate_request_document(request)
    metadata = {}
    operator = {}
    identities = {}
    located = {}
    for kind in KIND_SPECS:
        metadata[kind] = _validate_run_and_artifact_metadata(
            kind=kind, request=request, metadata_dir=metadata_dir
        )
        operator[kind], located[kind] = _validate_operator_artifact(
            kind=kind, root=artifact_dirs[kind], request=request
        )
        identities[kind] = operator[kind]["files"]

    source_lock, source_lock_payload = _validate_source_lock(located["local-ai"]["source-lock.json"])
    _, trust_payload = _validate_trust(trust_path)
    _, manifest_payload = _validate_manifest(
        manifest_path=manifest_path,
        request=request,
        identities=identities,
        source_lock=source_lock,
        source_lock_payload=source_lock_payload,
    )

    result = {
        "$schema": RESULT_SCHEMA,
        "status": "validated-public-signing-request",
        "source_repository": REPOSITORY,
        "source_commit": request["source_commit"],
        "release_tag": request["release_tag"],
        "request_sha256": _sha(request_payload),
        "canonical_trust_sha256": _sha(trust_payload),
        "release_manifest_sha256": _sha(manifest_payload),
        "operator_artifacts": {},
        "private_key_included": False,
        "signing_performed": False,
        "publication_performed": False,
        "release_activated": False,
        "physical_target_selected": False,
        "physical_write_authorized": False,
        "physical_write_performed": False,
    }
    for kind in KIND_SPECS:
        req = request["operator_artifacts"][kind]
        result["operator_artifacts"][kind] = {
            "run_id": req["run_id"],
            "artifact_id": req["artifact_id"],
            "artifact_name": req["artifact_name"],
            **metadata[kind],
            **operator[kind],
        }

    encoded = (json.dumps(result, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if output_path.exists():
        raise ValidationError(f"refusing to overwrite validation receipt: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_bytes(encoded)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--request", type=Path, required=True)
    parser.add_argument("--request-only", action="store_true")
    parser.add_argument("--metadata-dir", type=Path)
    parser.add_argument("--system-dir", type=Path)
    parser.add_argument("--surface-dir", type=Path)
    parser.add_argument("--local-ai-dir", type=Path)
    parser.add_argument("--trust", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    try:
        request, _ = _load_json(args.request, "canonical v4 signing request")
        validate_request_document(request)
        if args.request_only:
            print(json.dumps({"status": "request-valid", "source_commit": request["source_commit"]}, sort_keys=True))
            return 0
        required = (args.metadata_dir, args.system_dir, args.surface_dir, args.local_ai_dir, args.trust, args.manifest, args.out)
        if any(value is None for value in required):
            raise ValidationError("full validation requires metadata/artifact/trust/manifest/output paths")
        result = validate_all(
            request_path=args.request,
            metadata_dir=args.metadata_dir,
            artifact_dirs={
                "system": args.system_dir,
                "surface": args.surface_dir,
                "local-ai": args.local_ai_dir,
            },
            trust_path=args.trust,
            manifest_path=args.manifest,
            output_path=args.out,
        )
    except ValidationError as exc:
        print(json.dumps({"$schema": RESULT_SCHEMA, "status": "blocked", "error": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
