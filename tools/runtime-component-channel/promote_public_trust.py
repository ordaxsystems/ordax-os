#!/usr/bin/env python3
"""Validate and promote recovered public runtime-component trust.

The promoter accepts only the public handoff produced after the operator
recovery ceremony. It never accepts a private key, never enables component
publication, never enables component-slot activation and never affects physical
USB authorization.
"""

from __future__ import annotations

import argparse
import base64
import binascii
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
from typing import Any
import zipfile

TRUST_SCHEMA = "prototype-ordax.runtime-component-trust/1"
EVIDENCE_SCHEMA = "prototype-ordax.runtime-component-trust-ceremony-evidence/1"
RELEASE_SCHEMA = "prototype-ordax.runtime-component-release/1"
ENVELOPE_SCHEMA = "prototype-ordax.runtime-component-envelope/1"
POLICY_SCHEMA = "prototype-ordax.runtime-component-trust-policy/1"
PACKAGE_POLICY_SCHEMA = "prototype-ordax.runtime-component-package-policy/1"
RESULT_SCHEMA = "prototype-ordax.runtime-component-trust-public-promotion/1"

KEY_ID = "ordax-runtime-components-v1"
SOURCE_REPOSITORY = "ordaxsystems/ordax-os"
PROOF_COMPONENT_ID = "internet"
PROOF_COMPONENT_VERSION = "0.0.0-trust-proof"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

PROMOTION_FILES = {
    "runtime-components-ed25519.json",
    "ceremony-public-evidence.json",
    "component-trust-proof-release.json",
    "component-trust-proof-recovery-envelope.json",
}

TRUST_REPOSITORY_PATH = Path("system/trust/runtime-components-ed25519.json")
EVIDENCE_REPOSITORY_PATH = Path("docs/evidence/runtime-component-trust-ceremony.json")
PROOF_RELEASE_REPOSITORY_PATH = Path("docs/evidence/runtime-component-trust-proof-release.json")
RECOVERY_ENVELOPE_REPOSITORY_PATH = Path("docs/evidence/runtime-component-trust-recovery-envelope.json")
POLICY_PATH = Path("docs/contracts/runtime-component-trust-policy.json")
PACKAGE_POLICY_PATH = Path("docs/contracts/runtime-component-package.json")

TRUST_KEYS = {"$schema", "key_id", "public_key_base64"}
EVIDENCE_KEYS = {
    "$schema",
    "status",
    "source_commit",
    "key_id",
    "public_trust_sha256",
    "proof_release_sha256",
    "recovery_envelope_sha256",
    "primary_public_derivation_match",
    "recovered_public_derivation_match",
    "recovered_private_path_distinct",
    "recovered_signing_proof",
    "offline_encrypted_backup_recovery_verified",
    "private_key_in_public_evidence",
    "ready_to_pin_public_anchor",
}
ENVELOPE_KEYS = {"$schema", "payload", "signature", "key_id"}


class PromotionError(RuntimeError):
    pass


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise PromotionError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _require_real_directory(path: Path, label: str) -> Path:
    absolute = path.expanduser().absolute()
    try:
        metadata = absolute.lstat()
    except OSError as exc:
        raise PromotionError(f"{label} is missing: {absolute}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise PromotionError(f"{label} must be a real non-symlink directory")
    return absolute


def _require_regular(
    path: Path,
    label: str,
    *,
    max_bytes: int = 2 * 1024 * 1024,
) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise PromotionError(f"{label} is missing: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise PromotionError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise PromotionError(f"{label} size is outside the allowed range")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise PromotionError(f"cannot read {label}: {path}") from exc


def _load_json_bytes(payload: bytes, label: str) -> dict[str, Any]:
    try:
        text = payload.decode("utf-8")
        value = json.loads(text, object_pairs_hook=_no_duplicates)
    except (UnicodeError, json.JSONDecodeError, PromotionError) as exc:
        raise PromotionError(f"invalid {label} JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise PromotionError(f"{label} must contain one JSON object")
    return value


def load_json(path: Path, label: str) -> dict[str, Any]:
    return _load_json_bytes(_require_regular(path, label), label)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def json_bytes(value: dict[str, Any]) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _validate_verifier(verifier: Path) -> Path:
    absolute = verifier.expanduser().absolute()
    _require_regular(
        absolute,
        "runtime component verifier",
        max_bytes=128 * 1024 * 1024,
    )
    if os.name != "nt" and absolute.stat().st_mode & 0o111 == 0:
        raise PromotionError("runtime component verifier is not executable")
    return absolute


def _verify_envelope(
    verifier: Path,
    envelope_path: Path,
    trust_path: Path,
    source_commit: str,
) -> None:
    try:
        completed = subprocess.run(
            [
                str(verifier),
                "verify-envelope",
                "--envelope",
                str(envelope_path),
                "--trust",
                str(trust_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PromotionError(f"runtime component verifier could not run: {exc}") from exc

    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise PromotionError(
            "recovered component signing proof did not verify"
            + (f": {detail}" if detail else "")
        )

    expected = {
        "RUNTIME_COMPONENT_ENVELOPE_VERIFIED=YES",
        f"COMPONENT_ID={PROOF_COMPONENT_ID}",
        f"COMPONENT_VERSION={PROOF_COMPONENT_VERSION}",
        f"SOURCE_COMMIT={source_commit}",
        "PENDING_HEALTH_REQUIRED=YES",
    }
    output = set(completed.stdout.splitlines())
    missing = expected - output
    if missing:
        raise PromotionError(
            "runtime component verifier did not emit expected markers: "
            + ",".join(sorted(missing))
        )


def _validate_release(
    release: dict[str, Any],
    source_commit: str,
) -> None:
    expected_top = {
        "$schema",
        "source_repository",
        "source_commit",
        "created_from_ci_recipe",
        "component",
        "package",
        "activation",
    }
    if set(release) != expected_top:
        raise PromotionError("component proof release has unexpected fields")
    if (
        release.get("$schema") != RELEASE_SCHEMA
        or release.get("source_repository") != SOURCE_REPOSITORY
        or release.get("source_commit") != source_commit
        or release.get("created_from_ci_recipe") != "runtime-component/package/1"
    ):
        raise PromotionError("component proof release identity is invalid")

    component = release.get("component")
    if not isinstance(component, dict) or set(component) != {
        "id",
        "version",
        "release_mode",
        "package_schema",
    }:
        raise PromotionError("component proof release component is invalid")
    if component != {
        "id": PROOF_COMPONENT_ID,
        "version": PROOF_COMPONENT_VERSION,
        "release_mode": "component-slot",
        "package_schema": "prototype-ordax.runtime-component-package/1",
    }:
        raise PromotionError("component proof release component identity is invalid")

    package = release.get("package")
    if not isinstance(package, dict) or set(package) != {
        "name",
        "sha256",
        "size",
        "manifest_sha256",
    }:
        raise PromotionError("component proof release package binding is invalid")
    if (
        package.get("name") != "internet.zip"
        or package.get("sha256") != "0" * 64
        or package.get("size") != 1
        or package.get("manifest_sha256") != "1" * 64
    ):
        raise PromotionError("component proof release package binding is not canonical")

    activation = release.get("activation")
    if activation != {
        "direct_activation_allowed": False,
        "pending_health_required": True,
    }:
        raise PromotionError("component proof release activation policy is invalid")


def validate_public_bundle(
    *,
    trust_path: Path,
    evidence_path: Path,
    proof_release_path: Path,
    recovery_envelope_path: Path,
    verifier: Path,
) -> dict[str, Any]:
    trust_bytes = _require_regular(
        trust_path,
        "runtime component public trust",
        max_bytes=16 * 1024,
    )
    evidence_bytes = _require_regular(
        evidence_path,
        "runtime component ceremony evidence",
        max_bytes=64 * 1024,
    )
    release_bytes = _require_regular(
        proof_release_path,
        "runtime component proof release",
        max_bytes=256 * 1024,
    )
    envelope_bytes = _require_regular(
        recovery_envelope_path,
        "runtime component recovery envelope",
        max_bytes=2 * 1024 * 1024,
    )

    trust = _load_json_bytes(trust_bytes, "runtime component trust")
    evidence = _load_json_bytes(evidence_bytes, "runtime component ceremony evidence")
    release = _load_json_bytes(release_bytes, "runtime component proof release")
    envelope = _load_json_bytes(envelope_bytes, "runtime component recovery envelope")

    if set(trust) != TRUST_KEYS:
        raise PromotionError("runtime component trust has unexpected fields")
    if trust.get("$schema") != TRUST_SCHEMA or trust.get("key_id") != KEY_ID:
        raise PromotionError("runtime component trust schema or key_id is invalid")
    encoded = trust.get("public_key_base64")
    if not isinstance(encoded, str):
        raise PromotionError("runtime component trust public key is missing")
    try:
        public_key = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PromotionError("runtime component trust public key is not strict base64") from exc
    if len(public_key) != 32:
        raise PromotionError("runtime component trust must contain exactly 32 Ed25519 bytes")

    if set(evidence) != EVIDENCE_KEYS:
        raise PromotionError("runtime component ceremony evidence has unexpected fields")
    source_commit = evidence.get("source_commit")
    if (
        evidence.get("$schema") != EVIDENCE_SCHEMA
        or evidence.get("status") != "pass"
        or evidence.get("key_id") != KEY_ID
        or not isinstance(source_commit, str)
        or HEX40.fullmatch(source_commit) is None
    ):
        raise PromotionError("runtime component ceremony evidence identity is invalid")

    for field in (
        "public_trust_sha256",
        "proof_release_sha256",
        "recovery_envelope_sha256",
    ):
        value = evidence.get(field)
        if not isinstance(value, str) or HEX64.fullmatch(value) is None:
            raise PromotionError(f"runtime component ceremony evidence {field} is invalid")

    for field in (
        "primary_public_derivation_match",
        "recovered_public_derivation_match",
        "recovered_private_path_distinct",
        "recovered_signing_proof",
        "offline_encrypted_backup_recovery_verified",
        "ready_to_pin_public_anchor",
    ):
        if evidence.get(field) is not True:
            raise PromotionError(f"runtime component ceremony evidence does not prove {field}")
    if evidence.get("private_key_in_public_evidence") is not False:
        raise PromotionError("runtime component public evidence must exclude private key material")

    trust_sha = sha256_bytes(trust_bytes)
    release_sha = sha256_bytes(release_bytes)
    envelope_sha = sha256_bytes(envelope_bytes)
    if evidence.get("public_trust_sha256") != trust_sha:
        raise PromotionError("runtime component public trust hash does not match evidence")
    if evidence.get("proof_release_sha256") != release_sha:
        raise PromotionError("runtime component proof release hash does not match evidence")
    if evidence.get("recovery_envelope_sha256") != envelope_sha:
        raise PromotionError("runtime component recovery envelope hash does not match evidence")

    _validate_release(release, source_commit)

    if set(envelope) != ENVELOPE_KEYS:
        raise PromotionError("runtime component recovery envelope has unexpected fields")
    if envelope.get("$schema") != ENVELOPE_SCHEMA or envelope.get("key_id") != KEY_ID:
        raise PromotionError("runtime component recovery envelope identity is invalid")
    try:
        embedded_release = base64.b64decode(envelope.get("payload", ""), validate=True)
        signature = base64.b64decode(envelope.get("signature", ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PromotionError("runtime component recovery envelope contains invalid base64") from exc
    if embedded_release != release_bytes:
        raise PromotionError("runtime component recovery envelope payload differs from proof release")
    if len(signature) != 64:
        raise PromotionError("runtime component recovery envelope signature length is invalid")

    _verify_envelope(verifier, recovery_envelope_path, trust_path, source_commit)

    return {
        "trust_bytes": trust_bytes,
        "evidence_bytes": evidence_bytes,
        "release_bytes": release_bytes,
        "envelope_bytes": envelope_bytes,
        "source_commit": source_commit,
        "trust_sha256": trust_sha,
        "evidence_sha256": sha256_bytes(evidence_bytes),
        "proof_release_sha256": release_sha,
        "recovery_envelope_sha256": envelope_sha,
    }


def _materialize_public_handoff_zip(
    handoff_zip: Path,
    output_dir: Path,
) -> Path:
    zip_bytes = _require_regular(
        handoff_zip,
        "runtime component public trust handoff zip",
        max_bytes=8 * 1024 * 1024,
    )
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise PromotionError("runtime component public trust handoff is not a valid ZIP") from exc

    with archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if (
            len(infos) != len(PROMOTION_FILES)
            or len(set(names)) != len(names)
            or set(names) != PROMOTION_FILES
        ):
            raise PromotionError("runtime component public trust handoff must contain exactly four public files")

        total = 0
        for info in infos:
            name = info.filename
            if (
                info.is_dir()
                or "/" in name
                or "\\" in name
                or Path(name).name != name
            ):
                raise PromotionError("runtime component public trust handoff contains an unsafe path")
            if info.flag_bits & 0x1:
                raise PromotionError("encrypted handoff entries are forbidden")
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise PromotionError("symlink handoff entries are forbidden")
            if re.search(r"(?i)(private|secret|seed)", name) or Path(name).suffix.lower() in {
                ".pem",
                ".key",
                ".p12",
                ".pfx",
            }:
                raise PromotionError("secret-looking handoff entry is forbidden")
            if info.file_size <= 0 or info.file_size > 2 * 1024 * 1024:
                raise PromotionError(f"runtime component handoff entry size is invalid: {name}")
            total += info.file_size
            if total > 4 * 1024 * 1024:
                raise PromotionError("runtime component public trust handoff expands beyond limit")
            payload = archive.read(info)
            if len(payload) != info.file_size:
                raise PromotionError(f"runtime component handoff entry size changed: {name}")
            (output_dir / name).write_bytes(payload)

    return output_dir


def validate_public_promotion_directory(
    promotion_dir: Path,
    verifier: Path,
) -> dict[str, Any]:
    directory = _require_real_directory(promotion_dir, "runtime component public promotion directory")
    children = list(directory.iterdir())
    if {child.name for child in children} != PROMOTION_FILES or len(children) != len(PROMOTION_FILES):
        raise PromotionError("runtime component public promotion directory must contain exactly four public files")

    return validate_public_bundle(
        trust_path=directory / "runtime-components-ed25519.json",
        evidence_path=directory / "ceremony-public-evidence.json",
        proof_release_path=directory / "component-trust-proof-release.json",
        recovery_envelope_path=directory / "component-trust-proof-recovery-envelope.json",
        verifier=verifier,
    )


def _assert_pre_promotion_contracts(
    policy: dict[str, Any],
    package_policy: dict[str, Any],
) -> None:
    if (
        policy.get("$schema") != POLICY_SCHEMA
        or policy.get("status") != "operator-ceremony-pending"
        or policy.get("key_id") != KEY_ID
    ):
        raise PromotionError("runtime component trust policy is not in pre-promotion state")
    anchor = policy.get("public_anchor")
    if not isinstance(anchor, dict) or anchor.get("repository_path") != TRUST_REPOSITORY_PATH.as_posix():
        raise PromotionError("runtime component trust policy anchor path is invalid")
    if anchor.get("pinned") is not False or anchor.get("sha256") is not None:
        raise PromotionError("runtime component trust anchor is already pinned or inconsistent")

    gates = policy.get("current_gates")
    if gates != {
        "canonical_component_trust_anchor_pinned": False,
        "component_publish_allowed": False,
        "production_component_slot_activation_allowed": False,
    }:
        raise PromotionError("runtime component trust gates are not fail-closed before promotion")

    promotion = policy.get("promotion")
    if not isinstance(promotion, dict) or any(
        promotion.get(field) is not False
        for field in (
            "pinning_enables_publication",
            "pinning_enables_activation",
            "pinning_authorizes_physical_write",
        )
    ):
        raise PromotionError("runtime component trust promotion semantics are unsafe")

    if (
        package_policy.get("$schema") != PACKAGE_POLICY_SCHEMA
        or package_policy.get("canonical_component_trust_anchor_pinned") is not False
        or package_policy.get("publish_allowed") is not False
        or package_policy.get("slot_activation_available") is not False
        or package_policy.get("pending_health_promotion_available") is not False
        or package_policy.get("rollback_slot_activation_available") is not False
        or package_policy.get("native_loopback_verified_read_broker_implemented") is not True
        or package_policy.get("native_loopback_broker_read_only") is not True
        or package_policy.get("internet_release_mode") != "git-app"
    ):
        raise PromotionError("runtime component package policy is not in safe pre-promotion state")


def prepare_repository_promotion(
    repo_root: Path,
    promotion_dir: Path,
    verifier: Path,
) -> dict[str, Any]:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)
    public = validate_public_promotion_directory(promotion_dir, verifier_path)

    policy = load_json(root / POLICY_PATH, "runtime component trust policy")
    package_policy = load_json(root / PACKAGE_POLICY_PATH, "runtime component package policy")
    _assert_pre_promotion_contracts(policy, package_policy)

    promoted_policy = copy.deepcopy(policy)
    promoted_policy["status"] = "canonical-public-trust-pinned"
    anchor = promoted_policy["public_anchor"]
    anchor.update(
        {
            "pinned": True,
            "sha256": public["trust_sha256"],
            "ceremony_evidence_repository_path": EVIDENCE_REPOSITORY_PATH.as_posix(),
            "ceremony_evidence_sha256": public["evidence_sha256"],
            "proof_release_repository_path": PROOF_RELEASE_REPOSITORY_PATH.as_posix(),
            "proof_release_sha256": public["proof_release_sha256"],
            "recovery_envelope_repository_path": RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
            "recovery_envelope_sha256": public["recovery_envelope_sha256"],
            "source_commit": public["source_commit"],
        }
    )
    promoted_policy["current_gates"] = {
        "canonical_component_trust_anchor_pinned": True,
        "component_publish_allowed": False,
        "production_component_slot_activation_allowed": False,
    }

    promoted_package = copy.deepcopy(package_policy)
    promoted_package["canonical_component_trust_anchor_pinned"] = True
    promoted_package["publish_allowed"] = False
    promoted_package["slot_activation_available"] = False
    promoted_package["pending_health_promotion_available"] = False
    promoted_package["rollback_slot_activation_available"] = False
    promoted_package["native_slot_serving_available"] = False
    promoted_package["internet_release_mode"] = "git-app"
    promoted_package["next_gate"] = (
        "Run pending probation through the Native verified read broker, bind real "
        "runtime health to promote/reject, and prove rollback before enabling "
        "production component-slot activation"
    )

    outputs = {
        TRUST_REPOSITORY_PATH.as_posix(): public["trust_bytes"],
        EVIDENCE_REPOSITORY_PATH.as_posix(): public["evidence_bytes"],
        PROOF_RELEASE_REPOSITORY_PATH.as_posix(): public["release_bytes"],
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(): public["envelope_bytes"],
        POLICY_PATH.as_posix(): json_bytes(promoted_policy),
        PACKAGE_POLICY_PATH.as_posix(): json_bytes(promoted_package),
    }

    return {
        "$schema": RESULT_SCHEMA,
        "status": "ready",
        "ready": True,
        "source_commit": public["source_commit"],
        "trust_sha256": public["trust_sha256"],
        "ceremony_evidence_sha256": public["evidence_sha256"],
        "proof_release_sha256": public["proof_release_sha256"],
        "recovery_envelope_sha256": public["recovery_envelope_sha256"],
        "component_publish_allowed": False,
        "production_component_slot_activation_allowed": False,
        "physical_write_allowed": False,
        "outputs": outputs,
    }


def prepare_repository_promotion_zip(
    repo_root: Path,
    handoff_zip: Path,
    verifier: Path,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="ordax-component-trust-") as temporary:
        directory = Path(temporary)
        _materialize_public_handoff_zip(handoff_zip, directory)
        return prepare_repository_promotion(repo_root, directory, verifier)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(
        path,
        os.O_RDONLY
        | getattr(os, "O_DIRECTORY", 0)
        | getattr(os, "O_CLOEXEC", 0),
    )
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(path: Path, payload: bytes) -> None:
    parent = path.parent
    metadata = parent.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise PromotionError(f"output parent must be a real directory: {parent}")

    try:
        existing = path.lstat()
    except FileNotFoundError:
        existing = None
    if existing is not None and (
        stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode)
    ):
        raise PromotionError(f"refusing unsafe output path: {path}")

    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    flags = (
        os.O_WRONLY
        | os.O_CREAT
        | os.O_EXCL
        | getattr(os, "O_CLOEXEC", 0)
        | getattr(os, "O_NOFOLLOW", 0)
    )
    try:
        descriptor = os.open(temporary, flags, 0o644)
        try:
            offset = 0
            while offset < len(payload):
                written = os.write(descriptor, payload[offset:])
                if written <= 0:
                    raise PromotionError(f"short write while creating {path}")
                offset += written
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
        os.replace(temporary, path)
        _fsync_directory(parent)
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def validate_promoted_repository(
    repo_root: Path,
    verifier: Path,
) -> dict[str, Any]:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)

    public = validate_public_bundle(
        trust_path=root / TRUST_REPOSITORY_PATH,
        evidence_path=root / EVIDENCE_REPOSITORY_PATH,
        proof_release_path=root / PROOF_RELEASE_REPOSITORY_PATH,
        recovery_envelope_path=root / RECOVERY_ENVELOPE_REPOSITORY_PATH,
        verifier=verifier_path,
    )

    policy = load_json(root / POLICY_PATH, "runtime component trust policy")
    package_policy = load_json(root / PACKAGE_POLICY_PATH, "runtime component package policy")

    if (
        policy.get("$schema") != POLICY_SCHEMA
        or policy.get("status") != "canonical-public-trust-pinned"
        or policy.get("key_id") != KEY_ID
    ):
        raise PromotionError("promoted runtime component trust policy is invalid")

    anchor = policy.get("public_anchor")
    expected_bindings = {
        "pinned": True,
        "sha256": public["trust_sha256"],
        "ceremony_evidence_repository_path": EVIDENCE_REPOSITORY_PATH.as_posix(),
        "ceremony_evidence_sha256": public["evidence_sha256"],
        "proof_release_repository_path": PROOF_RELEASE_REPOSITORY_PATH.as_posix(),
        "proof_release_sha256": public["proof_release_sha256"],
        "recovery_envelope_repository_path": RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
        "recovery_envelope_sha256": public["recovery_envelope_sha256"],
        "source_commit": public["source_commit"],
    }
    if not isinstance(anchor, dict):
        raise PromotionError("promoted runtime component trust anchor is invalid")
    for key, value in expected_bindings.items():
        if anchor.get(key) != value:
            raise PromotionError(f"promoted runtime component trust binding is invalid: {key}")

    if policy.get("current_gates") != {
        "canonical_component_trust_anchor_pinned": True,
        "component_publish_allowed": False,
        "production_component_slot_activation_allowed": False,
    }:
        raise PromotionError("promoted runtime component trust gates are unsafe")

    if (
        package_policy.get("canonical_component_trust_anchor_pinned") is not True
        or package_policy.get("publish_allowed") is not False
        or package_policy.get("slot_activation_available") is not False
        or package_policy.get("pending_health_promotion_available") is not False
        or package_policy.get("rollback_slot_activation_available") is not False
        or package_policy.get("native_slot_serving_available") is not False
        or package_policy.get("internet_release_mode") != "git-app"
    ):
        raise PromotionError("promoted runtime component package policy enabled forbidden capability")

    return {
        "$schema": RESULT_SCHEMA,
        "status": "promoted",
        "ready": True,
        "source_commit": public["source_commit"],
        "trust_sha256": public["trust_sha256"],
        "ceremony_evidence_sha256": public["evidence_sha256"],
        "proof_release_sha256": public["proof_release_sha256"],
        "recovery_envelope_sha256": public["recovery_envelope_sha256"],
        "component_publish_allowed": False,
        "production_component_slot_activation_allowed": False,
        "physical_write_allowed": False,
    }


def apply_repository_promotion(
    repo_root: Path,
    promotion_dir: Path,
    verifier: Path,
) -> dict[str, Any]:
    plan = prepare_repository_promotion(repo_root, promotion_dir, verifier)
    root = _require_real_directory(repo_root, "repository root")

    immutable_public_paths = {
        TRUST_REPOSITORY_PATH.as_posix(),
        EVIDENCE_REPOSITORY_PATH.as_posix(),
        PROOF_RELEASE_REPOSITORY_PATH.as_posix(),
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
    }
    for relative, payload in plan["outputs"].items():
        destination = root / relative
        if destination.exists():
            existing = _require_regular(
                destination,
                f"existing {relative}",
                max_bytes=4 * 1024 * 1024,
            )
            if relative in immutable_public_paths and existing != payload:
                raise PromotionError(
                    f"refusing to replace different canonical public material: {relative}"
                )
        _atomic_write(destination, payload)

    return validate_promoted_repository(root, verifier)


def apply_repository_promotion_zip(
    repo_root: Path,
    handoff_zip: Path,
    verifier: Path,
) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="ordax-component-trust-") as temporary:
        directory = Path(temporary)
        _materialize_public_handoff_zip(handoff_zip, directory)
        return apply_repository_promotion(repo_root, directory, verifier)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "apply"))
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[2],
    )
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--promotion-dir", type=Path)
    source.add_argument("--promotion-zip", type=Path)
    parser.add_argument(
        "--verifier",
        type=Path,
        required=True,
        help="ordax-runtime-component-channel executable",
    )
    args = parser.parse_args()

    try:
        if args.promotion_zip is not None:
            if args.mode == "check":
                result = prepare_repository_promotion_zip(
                    args.repo_root,
                    args.promotion_zip,
                    args.verifier,
                )
                public_result = {key: value for key, value in result.items() if key != "outputs"}
            else:
                public_result = apply_repository_promotion_zip(
                    args.repo_root,
                    args.promotion_zip,
                    args.verifier,
                )
        elif args.mode == "check":
            result = prepare_repository_promotion(
                args.repo_root,
                args.promotion_dir,
                args.verifier,
            )
            public_result = {key: value for key, value in result.items() if key != "outputs"}
        else:
            public_result = apply_repository_promotion(
                args.repo_root,
                args.promotion_dir,
                args.verifier,
            )
        print(json.dumps(public_result, indent=2, sort_keys=True))
        return 0
    except (PromotionError, OSError) as exc:
        print(f"runtime-component-trust-public-promotion: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
