#!/usr/bin/env python3
"""Validate and promote recovered public Profile-content trust.

This tool accepts only the public handoff produced by the operator recovery
ceremony. It never accepts private key material, never enables Profile content
publication/install/activation, and never changes physical-media authorization.
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

TRUST_SCHEMA = "prototype-ordax.profile-content-trust/1"
EVIDENCE_SCHEMA = "prototype-ordax.profile-content-trust-ceremony-evidence/1"
MANIFEST_SCHEMA = "prototype-ordax.profile-content-manifest/1"
ENVELOPE_SCHEMA = "prototype-ordax.profile-content-envelope/1"
POLICY_SCHEMA = "prototype-ordax.profile-content-trust-policy/1"
PROVISIONING_SCHEMA = "prototype-ordax.profile-provisioning/1"
RESULT_SCHEMA = "prototype-ordax.profile-content-trust-public-promotion/1"

KEY_ID = "ordax-profile-content-v1"
PROOF_ID = "knowledge.trust-ceremony-proof"
PROOF_KIND = "knowledge-pack"
PROOF_VERSION = "0.0.0-trust-proof"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

PROMOTION_FILES = {
    "profile-content-ed25519.json",
    "ceremony-public-evidence.json",
    "profile-content-trust-proof-manifest.json",
    "profile-content-trust-proof-recovery-envelope.json",
    "content.pack",
}

TRUST_REPOSITORY_PATH = Path("system/trust/profile-content-ed25519.json")
EVIDENCE_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-ceremony.json")
PROOF_MANIFEST_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-proof-manifest.json")
RECOVERY_ENVELOPE_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-recovery-envelope.json")
PROOF_CONTENT_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-proof-content.pack")
POLICY_PATH = Path("docs/contracts/profile-content-trust-policy.json")
PROVISIONING_PATH = Path("docs/contracts/profile-provisioning.json")

TRUST_KEYS = {"$schema", "algorithm", "key_id", "public_key_base64"}
ENVELOPE_KEYS = {"$schema", "algorithm", "key_id", "signature_base64"}
EVIDENCE_KEYS = {
    "$schema",
    "status",
    "source_commit",
    "key_id",
    "public_trust_sha256",
    "proof_manifest_sha256",
    "proof_content_sha256",
    "recovery_envelope_sha256",
    "primary_public_derivation_match",
    "recovered_public_derivation_match",
    "recovered_private_path_distinct",
    "recovered_signing_proof",
    "offline_encrypted_backup_recovery_verified",
    "private_key_in_public_evidence",
    "ready_to_pin_public_anchor",
}


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


def _require_regular(path: Path, label: str, *, max_bytes: int = 2 * 1024 * 1024) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise PromotionError(f"{label} is missing: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise PromotionError(f"{label} must be a regular non-symlink file")
    if metadata.st_size <= 0 or metadata.st_size > max_bytes:
        raise PromotionError(f"{label} size is outside the allowed range")
    return path.read_bytes()


def _load_json_bytes(payload: bytes, label: str) -> dict[str, Any]:
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=_no_duplicates)
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
    _require_regular(absolute, "Profile content verifier", max_bytes=128 * 1024 * 1024)
    if os.name != "nt" and absolute.stat().st_mode & 0o111 == 0:
        raise PromotionError("Profile content verifier is not executable")
    return absolute


def _verify_public_proof(
    verifier: Path,
    manifest_path: Path,
    envelope_path: Path,
    trust_path: Path,
    content_path: Path,
) -> None:
    try:
        completed = subprocess.run(
            [
                str(verifier),
                "verify",
                "--manifest",
                str(manifest_path),
                "--envelope",
                str(envelope_path),
                "--trust",
                str(trust_path),
                "--content",
                str(content_path),
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise PromotionError(f"Profile content verifier could not run: {exc}") from exc
    if completed.returncode != 0:
        detail = (completed.stderr or completed.stdout).strip()
        raise PromotionError(
            "recovered Profile content signing proof did not verify"
            + (f": {detail}" if detail else "")
        )

    expected = {
        "PROFILE_CONTENT_VERIFY=PASS",
        f"PROFILE_CONTENT_ID={PROOF_ID}",
        f"PROFILE_CONTENT_KIND={PROOF_KIND}",
        f"PROFILE_CONTENT_VERSION={PROOF_VERSION}",
        "PROFILE_CONTENT_ACTIVATION_ALLOWED=NO",
    }
    output = set(completed.stdout.splitlines())
    missing = expected - output
    if missing:
        raise PromotionError(
            "Profile content verifier did not emit expected markers: "
            + ",".join(sorted(missing))
        )


def _validate_manifest(manifest: dict[str, Any], content_bytes: bytes, source_commit: str) -> None:
    expected_top = {
        "$schema",
        "id",
        "kind",
        "version",
        "publisher",
        "content_hash",
        "content_size",
        "content_format",
        "source",
        "requested_capabilities",
        "runtime_network_allowed",
        "mutable_host_access_allowed",
    }
    if set(manifest) != expected_top:
        raise PromotionError("Profile content proof manifest has unexpected fields")
    if (
        manifest.get("$schema") != MANIFEST_SCHEMA
        or manifest.get("id") != PROOF_ID
        or manifest.get("kind") != PROOF_KIND
        or manifest.get("version") != PROOF_VERSION
        or manifest.get("publisher") != "ordax"
        or manifest.get("content_format") != "ordax.profile-content-pack/1"
        or manifest.get("requested_capabilities") != []
        or manifest.get("runtime_network_allowed") is not False
        or manifest.get("mutable_host_access_allowed") is not False
    ):
        raise PromotionError("Profile content proof manifest identity/policy is invalid")
    if manifest.get("content_hash") != sha256_bytes(content_bytes):
        raise PromotionError("Profile content proof manifest hash does not bind content")
    if manifest.get("content_size") != len(content_bytes):
        raise PromotionError("Profile content proof manifest size does not bind content")
    source = manifest.get("source")
    if not isinstance(source, dict) or set(source) != {
        "uri",
        "revision",
        "license",
        "jurisdiction",
    }:
        raise PromotionError("Profile content proof source is invalid")
    if (
        source.get("uri") != "urn:ordax:profile-content:trust-ceremony-proof"
        or source.get("revision") != source_commit
        or source.get("license") != "internal-proof-only"
        or source.get("jurisdiction") is not None
    ):
        raise PromotionError("Profile content proof source binding is invalid")


def validate_public_bundle(
    *,
    trust_path: Path,
    evidence_path: Path,
    proof_manifest_path: Path,
    recovery_envelope_path: Path,
    content_path: Path,
    verifier: Path,
) -> dict[str, Any]:
    trust_bytes = _require_regular(trust_path, "Profile content public trust", max_bytes=16 * 1024)
    evidence_bytes = _require_regular(evidence_path, "Profile content ceremony evidence", max_bytes=64 * 1024)
    manifest_bytes = _require_regular(proof_manifest_path, "Profile content proof manifest", max_bytes=256 * 1024)
    envelope_bytes = _require_regular(recovery_envelope_path, "Profile content recovery envelope", max_bytes=64 * 1024)
    content_bytes = _require_regular(content_path, "Profile content ceremony proof payload", max_bytes=2 * 1024 * 1024)

    trust = _load_json_bytes(trust_bytes, "Profile content trust")
    evidence = _load_json_bytes(evidence_bytes, "Profile content ceremony evidence")
    manifest = _load_json_bytes(manifest_bytes, "Profile content proof manifest")
    envelope = _load_json_bytes(envelope_bytes, "Profile content recovery envelope")

    if set(trust) != TRUST_KEYS:
        raise PromotionError("Profile content trust has unexpected fields")
    if (
        trust.get("$schema") != TRUST_SCHEMA
        or trust.get("algorithm") != "ed25519"
        or trust.get("key_id") != KEY_ID
    ):
        raise PromotionError("Profile content trust identity is invalid")
    encoded = trust.get("public_key_base64")
    if not isinstance(encoded, str):
        raise PromotionError("Profile content public key is missing")
    try:
        public_key = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PromotionError("Profile content public key is not strict base64") from exc
    if len(public_key) != 32:
        raise PromotionError("Profile content trust must contain exactly 32 Ed25519 bytes")

    if set(evidence) != EVIDENCE_KEYS:
        raise PromotionError("Profile content ceremony evidence has unexpected fields")
    source_commit = evidence.get("source_commit")
    if (
        evidence.get("$schema") != EVIDENCE_SCHEMA
        or evidence.get("status") != "pass"
        or evidence.get("key_id") != KEY_ID
        or not isinstance(source_commit, str)
        or HEX40.fullmatch(source_commit) is None
    ):
        raise PromotionError("Profile content ceremony evidence identity is invalid")
    for field in (
        "public_trust_sha256",
        "proof_manifest_sha256",
        "proof_content_sha256",
        "recovery_envelope_sha256",
    ):
        value = evidence.get(field)
        if not isinstance(value, str) or HEX64.fullmatch(value) is None:
            raise PromotionError(f"Profile content ceremony evidence {field} is invalid")
    for field in (
        "primary_public_derivation_match",
        "recovered_public_derivation_match",
        "recovered_private_path_distinct",
        "recovered_signing_proof",
        "offline_encrypted_backup_recovery_verified",
        "ready_to_pin_public_anchor",
    ):
        if evidence.get(field) is not True:
            raise PromotionError(f"Profile content ceremony evidence does not prove {field}")
    if evidence.get("private_key_in_public_evidence") is not False:
        raise PromotionError("Profile content public evidence must exclude private key material")

    bindings = {
        "public_trust_sha256": sha256_bytes(trust_bytes),
        "proof_manifest_sha256": sha256_bytes(manifest_bytes),
        "proof_content_sha256": sha256_bytes(content_bytes),
        "recovery_envelope_sha256": sha256_bytes(envelope_bytes),
    }
    for field, expected in bindings.items():
        if evidence.get(field) != expected:
            raise PromotionError(f"Profile content ceremony {field} does not match public handoff")

    _validate_manifest(manifest, content_bytes, source_commit)

    if set(envelope) != ENVELOPE_KEYS:
        raise PromotionError("Profile content recovery envelope has unexpected fields")
    if (
        envelope.get("$schema") != ENVELOPE_SCHEMA
        or envelope.get("algorithm") != "ed25519"
        or envelope.get("key_id") != KEY_ID
    ):
        raise PromotionError("Profile content recovery envelope identity is invalid")
    try:
        signature = base64.b64decode(envelope.get("signature_base64", ""), validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PromotionError("Profile content recovery envelope signature is invalid base64") from exc
    if len(signature) != 64:
        raise PromotionError("Profile content recovery envelope signature length is invalid")

    _verify_public_proof(
        verifier,
        proof_manifest_path,
        recovery_envelope_path,
        trust_path,
        content_path,
    )

    return {
        "trust_bytes": trust_bytes,
        "evidence_bytes": evidence_bytes,
        "manifest_bytes": manifest_bytes,
        "envelope_bytes": envelope_bytes,
        "content_bytes": content_bytes,
        "source_commit": source_commit,
        "trust_sha256": bindings["public_trust_sha256"],
        "evidence_sha256": sha256_bytes(evidence_bytes),
        "proof_manifest_sha256": bindings["proof_manifest_sha256"],
        "proof_content_sha256": bindings["proof_content_sha256"],
        "recovery_envelope_sha256": bindings["recovery_envelope_sha256"],
    }


def _materialize_public_handoff_zip(handoff_zip: Path, output_dir: Path) -> Path:
    zip_bytes = _require_regular(handoff_zip, "Profile content public trust handoff ZIP", max_bytes=8 * 1024 * 1024)
    try:
        archive = zipfile.ZipFile(io.BytesIO(zip_bytes), "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise PromotionError("Profile content public trust handoff is not a valid ZIP") from exc
    with archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if len(infos) != len(PROMOTION_FILES) or len(set(names)) != len(names) or set(names) != PROMOTION_FILES:
            raise PromotionError("Profile content public trust handoff must contain exactly five public files")
        total = 0
        for info in infos:
            name = info.filename
            if info.is_dir() or "/" in name or "\\" in name or Path(name).name != name:
                raise PromotionError("Profile content public trust handoff contains an unsafe path")
            if info.flag_bits & 0x1:
                raise PromotionError("encrypted handoff entries are forbidden")
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise PromotionError("symlink handoff entries are forbidden")
            if re.search(r"(?i)(private|secret|seed)", name) or Path(name).suffix.lower() in {".pem", ".key", ".p12", ".pfx"}:
                raise PromotionError("secret-looking handoff entry is forbidden")
            if info.file_size <= 0 or info.file_size > 2 * 1024 * 1024:
                raise PromotionError(f"Profile content handoff entry size is invalid: {name}")
            total += info.file_size
            if total > 4 * 1024 * 1024:
                raise PromotionError("Profile content public trust handoff expands beyond limit")
            payload = archive.read(info)
            if len(payload) != info.file_size:
                raise PromotionError(f"Profile content handoff entry size changed: {name}")
            (output_dir / name).write_bytes(payload)
    return output_dir


def validate_public_promotion_directory(promotion_dir: Path, verifier: Path) -> dict[str, Any]:
    directory = _require_real_directory(promotion_dir, "Profile content public promotion directory")
    children = list(directory.iterdir())
    if {child.name for child in children} != PROMOTION_FILES or len(children) != len(PROMOTION_FILES):
        raise PromotionError("Profile content public promotion directory must contain exactly five public files")
    return validate_public_bundle(
        trust_path=directory / "profile-content-ed25519.json",
        evidence_path=directory / "ceremony-public-evidence.json",
        proof_manifest_path=directory / "profile-content-trust-proof-manifest.json",
        recovery_envelope_path=directory / "profile-content-trust-proof-recovery-envelope.json",
        content_path=directory / "content.pack",
        verifier=verifier,
    )


def _assert_pre_promotion_contracts(policy: dict[str, Any], provisioning: dict[str, Any]) -> None:
    if (
        policy.get("$schema") != POLICY_SCHEMA
        or policy.get("status") != "operator-ceremony-not-started"
        or policy.get("key_id") != KEY_ID
    ):
        raise PromotionError("Profile content trust policy is not in pre-promotion state")
    anchor = policy.get("public_anchor")
    if not isinstance(anchor, dict) or anchor.get("repository_path") != TRUST_REPOSITORY_PATH.as_posix():
        raise PromotionError("Profile content trust anchor path is invalid")
    if anchor.get("pinned") is not False or anchor.get("sha256") is not None:
        raise PromotionError("Profile content trust anchor is already pinned or inconsistent")
    if policy.get("current_gates") != {
        "canonical_profile_content_trust_anchor_pinned": False,
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
    }:
        raise PromotionError("Profile content trust gates are not fail-closed before promotion")
    promotion = policy.get("promotion")
    if not isinstance(promotion, dict) or any(
        promotion.get(field) is not False
        for field in (
            "pinning_enables_publication",
            "pinning_enables_installation",
            "pinning_enables_activation",
        )
    ):
        raise PromotionError("Profile content promotion semantics are unsafe")

    if provisioning.get("$schema") != PROVISIONING_SCHEMA:
        raise PromotionError("Profile provisioning contract schema is invalid")
    if provisioning.get("next_gates") != ["first-public-profile-proof"]:
        raise PromotionError("Profile provisioning gate drifted before trust promotion")
    mvp = provisioning.get("mvp")
    proof = provisioning.get("content_proof")
    if (
        not isinstance(mvp, dict)
        or mvp.get("public_profile_install_enabled") is not False
        or not isinstance(proof, dict)
        or proof.get("public_release_trust_pinned") is not False
        or proof.get("activation_allowed") is not False
    ):
        raise PromotionError("Profile provisioning is not fail-closed before trust promotion")


def prepare_repository_promotion(repo_root: Path, promotion_dir: Path, verifier: Path) -> dict[str, Any]:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)
    public = validate_public_promotion_directory(promotion_dir, verifier_path)

    policy = load_json(root / POLICY_PATH, "Profile content trust policy")
    provisioning = load_json(root / PROVISIONING_PATH, "Profile provisioning contract")
    _assert_pre_promotion_contracts(policy, provisioning)

    promoted_policy = copy.deepcopy(policy)
    promoted_policy["status"] = "canonical-public-trust-pinned"
    promoted_policy["public_anchor"].update(
        {
            "pinned": True,
            "sha256": public["trust_sha256"],
            "ceremony_evidence_repository_path": EVIDENCE_REPOSITORY_PATH.as_posix(),
            "ceremony_evidence_sha256": public["evidence_sha256"],
            "proof_manifest_repository_path": PROOF_MANIFEST_REPOSITORY_PATH.as_posix(),
            "proof_manifest_sha256": public["proof_manifest_sha256"],
            "proof_content_repository_path": PROOF_CONTENT_REPOSITORY_PATH.as_posix(),
            "proof_content_sha256": public["proof_content_sha256"],
            "recovery_envelope_repository_path": RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
            "recovery_envelope_sha256": public["recovery_envelope_sha256"],
            "source_commit": public["source_commit"],
        }
    )
    promoted_policy["current_gates"] = {
        "canonical_profile_content_trust_anchor_pinned": True,
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
    }

    promoted_provisioning = copy.deepcopy(provisioning)
    promoted_provisioning["content_proof"]["public_release_trust_pinned"] = True
    promoted_provisioning["content_proof"]["activation_allowed"] = False
    promoted_provisioning["mvp"]["public_profile_install_enabled"] = False
    promoted_provisioning["next_gates"] = ["first-public-profile-proof"]

    outputs = {
        TRUST_REPOSITORY_PATH.as_posix(): public["trust_bytes"],
        EVIDENCE_REPOSITORY_PATH.as_posix(): public["evidence_bytes"],
        PROOF_MANIFEST_REPOSITORY_PATH.as_posix(): public["manifest_bytes"],
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(): public["envelope_bytes"],
        PROOF_CONTENT_REPOSITORY_PATH.as_posix(): public["content_bytes"],
        POLICY_PATH.as_posix(): json_bytes(promoted_policy),
        PROVISIONING_PATH.as_posix(): json_bytes(promoted_provisioning),
    }
    return {
        "$schema": RESULT_SCHEMA,
        "status": "ready",
        "ready": True,
        "source_commit": public["source_commit"],
        "trust_sha256": public["trust_sha256"],
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
        "physical_write_allowed": False,
        "next_gate": "first-public-profile-proof",
        "outputs": outputs,
    }


def prepare_repository_promotion_zip(repo_root: Path, handoff_zip: Path, verifier: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="ordax-profile-content-trust-") as temporary:
        directory = Path(temporary)
        _materialize_public_handoff_zip(handoff_zip, directory)
        return prepare_repository_promotion(repo_root, directory, verifier)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
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
    if existing is not None and (stat.S_ISLNK(existing.st_mode) or not stat.S_ISREG(existing.st_mode)):
        raise PromotionError(f"refusing unsafe output path: {path}")
    temporary = path.with_name(f".{path.name}.tmp-{os.getpid()}")
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_CLOEXEC", 0) | getattr(os, "O_NOFOLLOW", 0)
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


def validate_promoted_repository(repo_root: Path, verifier: Path) -> dict[str, Any]:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)
    public = validate_public_bundle(
        trust_path=root / TRUST_REPOSITORY_PATH,
        evidence_path=root / EVIDENCE_REPOSITORY_PATH,
        proof_manifest_path=root / PROOF_MANIFEST_REPOSITORY_PATH,
        recovery_envelope_path=root / RECOVERY_ENVELOPE_REPOSITORY_PATH,
        content_path=root / PROOF_CONTENT_REPOSITORY_PATH,
        verifier=verifier_path,
    )
    policy = load_json(root / POLICY_PATH, "Profile content trust policy")
    provisioning = load_json(root / PROVISIONING_PATH, "Profile provisioning contract")
    if (
        policy.get("status") != "canonical-public-trust-pinned"
        or policy.get("public_anchor", {}).get("pinned") is not True
        or policy.get("public_anchor", {}).get("sha256") != public["trust_sha256"]
        or policy.get("current_gates") != {
            "canonical_profile_content_trust_anchor_pinned": True,
            "profile_content_publish_allowed": False,
            "profile_content_install_allowed": False,
            "profile_content_activation_allowed": False,
        }
    ):
        raise PromotionError("promoted Profile content trust policy is invalid")
    if (
        provisioning.get("content_proof", {}).get("public_release_trust_pinned") is not True
        or provisioning.get("content_proof", {}).get("activation_allowed") is not False
        or provisioning.get("mvp", {}).get("public_profile_install_enabled") is not False
        or provisioning.get("next_gates") != ["first-public-profile-proof"]
    ):
        raise PromotionError("promoted Profile provisioning contract enabled forbidden capability")
    return {
        "$schema": RESULT_SCHEMA,
        "status": "promoted",
        "ready": True,
        "source_commit": public["source_commit"],
        "trust_sha256": public["trust_sha256"],
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
        "physical_write_allowed": False,
        "next_gate": "first-public-profile-proof",
    }


def apply_repository_promotion(repo_root: Path, promotion_dir: Path, verifier: Path) -> dict[str, Any]:
    plan = prepare_repository_promotion(repo_root, promotion_dir, verifier)
    root = _require_real_directory(repo_root, "repository root")
    immutable_public = {
        TRUST_REPOSITORY_PATH.as_posix(),
        EVIDENCE_REPOSITORY_PATH.as_posix(),
        PROOF_MANIFEST_REPOSITORY_PATH.as_posix(),
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
        PROOF_CONTENT_REPOSITORY_PATH.as_posix(),
    }
    for relative, payload in plan["outputs"].items():
        destination = root / relative
        if destination.exists():
            existing = _require_regular(destination, f"existing {relative}", max_bytes=4 * 1024 * 1024)
            if relative in immutable_public and existing != payload:
                raise PromotionError(f"refusing to replace different canonical public material: {relative}")
        _atomic_write(destination, payload)
    return validate_promoted_repository(root, verifier)


def apply_repository_promotion_zip(repo_root: Path, handoff_zip: Path, verifier: Path) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="ordax-profile-content-trust-") as temporary:
        directory = Path(temporary)
        _materialize_public_handoff_zip(handoff_zip, directory)
        return apply_repository_promotion(repo_root, directory, verifier)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "apply"))
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--promotion-dir", type=Path)
    source.add_argument("--promotion-zip", type=Path)
    parser.add_argument("--verifier", type=Path, required=True, help="ordax-profile-content-channel executable")
    args = parser.parse_args()
    try:
        if args.promotion_zip is not None:
            if args.mode == "check":
                result = prepare_repository_promotion_zip(args.repo_root, args.promotion_zip, args.verifier)
                public_result = {key: value for key, value in result.items() if key != "outputs"}
            else:
                public_result = apply_repository_promotion_zip(args.repo_root, args.promotion_zip, args.verifier)
        elif args.mode == "check":
            result = prepare_repository_promotion(args.repo_root, args.promotion_dir, args.verifier)
            public_result = {key: value for key, value in result.items() if key != "outputs"}
        else:
            public_result = apply_repository_promotion(args.repo_root, args.promotion_dir, args.verifier)
        print(json.dumps(public_result, indent=2, sort_keys=True))
        return 0
    except (PromotionError, OSError) as exc:
        print(f"profile-content-trust-public-promotion: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
