#!/usr/bin/env python3
"""Validate and promote recovered public Profile Content trust.

The promoter accepts only a public handoff produced after the operator recovery
ceremony. It never accepts a private key and never enables Profile publication,
installation, activation, Stable mutation, or physical media writes.
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
import zipfile

TRUST_SCHEMA = "prototype-ordax.profile-content-trust/1"
EVIDENCE_SCHEMA = "prototype-ordax.profile-content-trust-ceremony-evidence/1"
MANIFEST_SCHEMA = "prototype-ordax.profile-content-manifest/1"
ENVELOPE_SCHEMA = "prototype-ordax.profile-content-envelope/1"
POLICY_SCHEMA = "prototype-ordax.profile-content-trust-policy/1"
PROVISIONING_SCHEMA = "prototype-ordax.profile-provisioning/1"
RESULT_SCHEMA = "prototype-ordax.profile-content-trust-public-promotion/1"

KEY_ID = "ordax-profile-content-v1"
PROOF_ID = "knowledge.developer-trust-proof"
PROOF_KIND = "knowledge-pack"
PROOF_VERSION = "0.0.0-trust-proof"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

PROMOTION_FILES = {
    "profile-content-ed25519.json",
    "ceremony-public-evidence.json",
    "profile-content-trust-proof-manifest.json",
    "profile-content-trust-proof-recovery-envelope.json",
}

TRUST_REPOSITORY_PATH = Path("system/trust/profile-content-ed25519.json")
EVIDENCE_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-ceremony.json")
PROOF_MANIFEST_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-proof-manifest.json")
RECOVERY_ENVELOPE_REPOSITORY_PATH = Path("docs/evidence/profile-content-trust-recovery-envelope.json")
POLICY_PATH = Path("docs/contracts/profile-content-trust-policy.json")
PROVISIONING_PATH = Path("docs/contracts/profile-provisioning.json")

TRUST_KEYS = {"$schema", "algorithm", "key_id", "public_key_base64"}
EVIDENCE_KEYS = {
    "$schema",
    "status",
    "source_commit",
    "key_id",
    "public_trust_sha256",
    "proof_manifest_sha256",
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


def _no_duplicates(pairs):
    result = {}
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
    try:
        return path.read_bytes()
    except OSError as exc:
        raise PromotionError(f"cannot read {label}: {path}") from exc


def _load_json_bytes(payload: bytes, label: str) -> dict:
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=_no_duplicates)
    except (UnicodeError, json.JSONDecodeError, PromotionError) as exc:
        raise PromotionError(f"invalid {label} JSON: {exc}") from exc
    if not isinstance(value, dict):
        raise PromotionError(f"{label} must contain one JSON object")
    return value


def load_json(path: Path, label: str) -> dict:
    return _load_json_bytes(_require_regular(path, label), label)


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def json_bytes(value: dict) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def _validate_verifier(verifier: Path) -> Path:
    absolute = verifier.expanduser().absolute()
    _require_regular(absolute, "Profile content verifier", max_bytes=128 * 1024 * 1024)
    if os.name != "nt" and absolute.stat().st_mode & 0o111 == 0:
        raise PromotionError("Profile content verifier is not executable")
    return absolute


def _validate_trust(trust_bytes: bytes) -> dict:
    trust = _load_json_bytes(trust_bytes, "Profile content trust")
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
        raise PromotionError("Profile content trust public key is missing")
    try:
        public = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise PromotionError("Profile content trust public key is not strict base64") from exc
    if len(public) != 32:
        raise PromotionError("Profile content trust must contain exactly 32 Ed25519 bytes")
    return trust


def _validate_manifest(manifest_bytes: bytes, source_commit: str) -> dict:
    manifest = _load_json_bytes(manifest_bytes, "Profile content proof manifest")
    expected = {
        "$schema", "id", "kind", "version", "publisher", "content_hash",
        "content_size", "content_format", "source", "requested_capabilities",
        "runtime_network_allowed", "mutable_host_access_allowed",
    }
    if set(manifest) != expected:
        raise PromotionError("Profile content proof manifest has unexpected fields")
    if (
        manifest.get("$schema") != MANIFEST_SCHEMA
        or manifest.get("id") != PROOF_ID
        or manifest.get("kind") != PROOF_KIND
        or manifest.get("version") != PROOF_VERSION
        or manifest.get("publisher") != "ordax"
        or manifest.get("content_format") != "ordax.profile-content-pack/1"
        or not isinstance(manifest.get("content_hash"), str)
        or HEX64.fullmatch(manifest["content_hash"]) is None
        or isinstance(manifest.get("content_size"), bool)
        or not isinstance(manifest.get("content_size"), int)
        or manifest["content_size"] <= 0
        or manifest.get("requested_capabilities") != []
        or manifest.get("runtime_network_allowed") is not False
        or manifest.get("mutable_host_access_allowed") is not False
    ):
        raise PromotionError("Profile content proof manifest identity or authority is invalid")
    source = manifest.get("source")
    if (
        not isinstance(source, dict)
        or set(source) != {"uri", "revision", "license", "jurisdiction"}
        or source.get("revision") != source_commit
        or source.get("license") != "ceremony-proof-only"
        or source.get("jurisdiction") is not None
    ):
        raise PromotionError("Profile content proof manifest provenance is invalid")
    return manifest


def _verify_envelope(verifier: Path, manifest_path: Path, envelope_path: Path, trust_path: Path) -> None:
    try:
        completed = subprocess.run(
            [
                str(verifier),
                "verify-envelope",
                "--manifest", str(manifest_path),
                "--envelope", str(envelope_path),
                "--trust", str(trust_path),
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
        "PROFILE_CONTENT_ENVELOPE_VERIFIED=YES",
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


def validate_public_bundle(
    *,
    trust_path: Path,
    evidence_path: Path,
    manifest_path: Path,
    recovery_envelope_path: Path,
    verifier: Path,
) -> dict:
    trust_bytes = _require_regular(trust_path, "Profile content public trust", max_bytes=16 * 1024)
    evidence_bytes = _require_regular(evidence_path, "Profile content ceremony evidence", max_bytes=64 * 1024)
    manifest_bytes = _require_regular(manifest_path, "Profile content proof manifest", max_bytes=256 * 1024)
    envelope_bytes = _require_regular(recovery_envelope_path, "Profile content recovery envelope", max_bytes=256 * 1024)

    _validate_trust(trust_bytes)
    evidence = _load_json_bytes(evidence_bytes, "Profile content ceremony evidence")
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
    for field in ("public_trust_sha256", "proof_manifest_sha256", "recovery_envelope_sha256"):
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
            raise PromotionError(f"Profile content ceremony evidence {field} must be true")
    if evidence.get("private_key_in_public_evidence") is not False:
        raise PromotionError("Profile content ceremony evidence claims private-key exposure")

    if evidence["public_trust_sha256"] != sha256_bytes(trust_bytes):
        raise PromotionError("Profile content public trust hash does not match evidence")
    if evidence["proof_manifest_sha256"] != sha256_bytes(manifest_bytes):
        raise PromotionError("Profile content proof manifest hash does not match evidence")
    if evidence["recovery_envelope_sha256"] != sha256_bytes(envelope_bytes):
        raise PromotionError("Profile content recovery envelope hash does not match evidence")

    _validate_manifest(manifest_bytes, source_commit)
    _verify_envelope(verifier, manifest_path, recovery_envelope_path, trust_path)

    return {
        "source_commit": source_commit,
        "trust_bytes": trust_bytes,
        "evidence_bytes": evidence_bytes,
        "manifest_bytes": manifest_bytes,
        "envelope_bytes": envelope_bytes,
        "trust_sha256": sha256_bytes(trust_bytes),
        "evidence_sha256": sha256_bytes(evidence_bytes),
        "manifest_sha256": sha256_bytes(manifest_bytes),
        "envelope_sha256": sha256_bytes(envelope_bytes),
    }


def _materialize_handoff_zip(handoff_zip: Path, output_dir: Path) -> None:
    payload = _require_regular(handoff_zip, "Profile content public trust handoff", max_bytes=8 * 1024 * 1024)
    try:
        archive = zipfile.ZipFile(io.BytesIO(payload), "r")
    except (OSError, zipfile.BadZipFile) as exc:
        raise PromotionError("Profile content public trust handoff is not a valid ZIP") from exc
    with archive:
        infos = archive.infolist()
        names = [item.filename for item in infos]
        if len(infos) != 4 or len(set(names)) != 4 or set(names) != PROMOTION_FILES:
            raise PromotionError("Profile content handoff must contain exactly four public files")
        total = 0
        for info in infos:
            name = info.filename
            if info.is_dir() or "/" in name or "\\" in name or Path(name).name != name:
                raise PromotionError("Profile content handoff contains an unsafe path")
            if info.flag_bits & 0x1:
                raise PromotionError("encrypted public handoff entries are forbidden")
            unix_mode = (info.external_attr >> 16) & 0xFFFF
            if unix_mode and stat.S_ISLNK(unix_mode):
                raise PromotionError("symlink handoff entries are forbidden")
            if re.search(r"(?i)(private|secret|seed)", name) or Path(name).suffix.lower() in {".pem", ".key", ".p12", ".pfx"}:
                raise PromotionError("secret-looking Profile content handoff entry is forbidden")
            if info.file_size <= 0 or info.file_size > 2 * 1024 * 1024:
                raise PromotionError(f"Profile content handoff entry size is invalid: {name}")
            total += info.file_size
            if total > 4 * 1024 * 1024:
                raise PromotionError("Profile content handoff expands beyond limit")
            data = archive.read(info)
            if len(data) != info.file_size:
                raise PromotionError(f"Profile content handoff entry size changed: {name}")
            (output_dir / name).write_bytes(data)


def validate_public_promotion_directory(promotion_dir: Path, verifier: Path) -> dict:
    directory = _require_real_directory(promotion_dir, "Profile content public promotion directory")
    children = list(directory.iterdir())
    if {child.name for child in children} != PROMOTION_FILES or len(children) != 4:
        raise PromotionError("Profile content public promotion directory must contain exactly four files")
    return validate_public_bundle(
        trust_path=directory / "profile-content-ed25519.json",
        evidence_path=directory / "ceremony-public-evidence.json",
        manifest_path=directory / "profile-content-trust-proof-manifest.json",
        recovery_envelope_path=directory / "profile-content-trust-proof-recovery-envelope.json",
        verifier=verifier,
    )


def _assert_pre_promotion_contracts(policy: dict, provisioning: dict) -> None:
    if (
        policy.get("$schema") != POLICY_SCHEMA
        or policy.get("status") != "operator-ceremony-pending"
        or policy.get("key_id") != KEY_ID
    ):
        raise PromotionError("Profile content trust policy is not in pre-promotion state")
    anchor = policy.get("public_anchor")
    if (
        not isinstance(anchor, dict)
        or anchor.get("repository_path") != TRUST_REPOSITORY_PATH.as_posix()
        or anchor.get("pinned") is not False
        or anchor.get("sha256") is not None
    ):
        raise PromotionError("Profile content public anchor is already pinned or inconsistent")
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
        raise PromotionError("Profile content trust promotion semantics are unsafe")
    if provisioning.get("$schema") != PROVISIONING_SCHEMA:
        raise PromotionError("Profile provisioning contract is incompatible")
    content_proof = provisioning.get("content_proof")
    if (
        not isinstance(content_proof, dict)
        or content_proof.get("public_release_trust_pinned") is not False
        or content_proof.get("activation_allowed") is not False
    ):
        raise PromotionError("Profile provisioning trust state is not fail-closed")


def prepare_repository_promotion(repo_root: Path, promotion_dir: Path, verifier: Path) -> dict:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)
    public = validate_public_promotion_directory(promotion_dir, verifier_path)
    policy = load_json(root / POLICY_PATH, "Profile content trust policy")
    provisioning = load_json(root / PROVISIONING_PATH, "Profile provisioning contract")
    _assert_pre_promotion_contracts(policy, provisioning)

    promoted_policy = copy.deepcopy(policy)
    promoted_policy["status"] = "canonical-public-trust-pinned"
    promoted_policy["public_anchor"].update({
        "pinned": True,
        "sha256": public["trust_sha256"],
        "ceremony_evidence_repository_path": EVIDENCE_REPOSITORY_PATH.as_posix(),
        "ceremony_evidence_sha256": public["evidence_sha256"],
        "proof_manifest_repository_path": PROOF_MANIFEST_REPOSITORY_PATH.as_posix(),
        "proof_manifest_sha256": public["manifest_sha256"],
        "recovery_envelope_repository_path": RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
        "recovery_envelope_sha256": public["envelope_sha256"],
        "source_commit": public["source_commit"],
    })
    promoted_policy["current_gates"] = {
        "canonical_profile_content_trust_anchor_pinned": True,
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
    }

    promoted_provisioning = copy.deepcopy(provisioning)
    promoted_provisioning["content_proof"]["public_release_trust_pinned"] = True
    promoted_provisioning["content_proof"]["activation_allowed"] = False

    outputs = {
        TRUST_REPOSITORY_PATH.as_posix(): public["trust_bytes"],
        EVIDENCE_REPOSITORY_PATH.as_posix(): public["evidence_bytes"],
        PROOF_MANIFEST_REPOSITORY_PATH.as_posix(): public["manifest_bytes"],
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(): public["envelope_bytes"],
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
        "stable_profile_mutation_allowed": False,
        "physical_write_allowed": False,
        "outputs": outputs,
    }


def prepare_repository_promotion_zip(repo_root: Path, handoff_zip: Path, verifier: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="ordax-profile-content-trust-") as temporary:
        directory = Path(temporary)
        _materialize_handoff_zip(handoff_zip, directory)
        return prepare_repository_promotion(repo_root, directory, verifier)


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    parent_meta = path.parent.lstat()
    if stat.S_ISLNK(parent_meta.st_mode) or not stat.S_ISDIR(parent_meta.st_mode):
        raise PromotionError(f"output parent must be a real directory: {path.parent}")
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
        _fsync_directory(path.parent)
    except Exception:
        try:
            temporary.unlink()
        except OSError:
            pass
        raise


def apply_repository_promotion(repo_root: Path, promotion_dir: Path, verifier: Path) -> dict:
    plan = prepare_repository_promotion(repo_root, promotion_dir, verifier)
    root = _require_real_directory(repo_root, "repository root")
    immutable = {
        TRUST_REPOSITORY_PATH.as_posix(),
        EVIDENCE_REPOSITORY_PATH.as_posix(),
        PROOF_MANIFEST_REPOSITORY_PATH.as_posix(),
        RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
    }
    for relative, payload in plan["outputs"].items():
        destination = root / relative
        if destination.exists():
            existing = _require_regular(destination, f"existing {relative}", max_bytes=4 * 1024 * 1024)
            if relative in immutable and existing != payload:
                raise PromotionError(f"refusing to replace different canonical public material: {relative}")
        _atomic_write(destination, payload)
    return validate_promoted_repository(root, verifier)


def apply_repository_promotion_zip(repo_root: Path, handoff_zip: Path, verifier: Path) -> dict:
    with tempfile.TemporaryDirectory(prefix="ordax-profile-content-trust-") as temporary:
        directory = Path(temporary)
        _materialize_handoff_zip(handoff_zip, directory)
        return apply_repository_promotion(repo_root, directory, verifier)


def validate_promoted_repository(repo_root: Path, verifier: Path) -> dict:
    root = _require_real_directory(repo_root, "repository root")
    verifier_path = _validate_verifier(verifier)
    public = validate_public_bundle(
        trust_path=root / TRUST_REPOSITORY_PATH,
        evidence_path=root / EVIDENCE_REPOSITORY_PATH,
        manifest_path=root / PROOF_MANIFEST_REPOSITORY_PATH,
        recovery_envelope_path=root / RECOVERY_ENVELOPE_REPOSITORY_PATH,
        verifier=verifier_path,
    )
    policy = load_json(root / POLICY_PATH, "Profile content trust policy")
    provisioning = load_json(root / PROVISIONING_PATH, "Profile provisioning contract")
    if (
        policy.get("$schema") != POLICY_SCHEMA
        or policy.get("status") != "canonical-public-trust-pinned"
        or policy.get("key_id") != KEY_ID
    ):
        raise PromotionError("promoted Profile content trust policy is invalid")
    anchor = policy.get("public_anchor")
    expected = {
        "pinned": True,
        "sha256": public["trust_sha256"],
        "ceremony_evidence_repository_path": EVIDENCE_REPOSITORY_PATH.as_posix(),
        "ceremony_evidence_sha256": public["evidence_sha256"],
        "proof_manifest_repository_path": PROOF_MANIFEST_REPOSITORY_PATH.as_posix(),
        "proof_manifest_sha256": public["manifest_sha256"],
        "recovery_envelope_repository_path": RECOVERY_ENVELOPE_REPOSITORY_PATH.as_posix(),
        "recovery_envelope_sha256": public["envelope_sha256"],
        "source_commit": public["source_commit"],
    }
    if not isinstance(anchor, dict):
        raise PromotionError("promoted Profile content public anchor is invalid")
    for key, value in expected.items():
        if anchor.get(key) != value:
            raise PromotionError(f"promoted Profile content trust binding is invalid: {key}")
    if policy.get("current_gates") != {
        "canonical_profile_content_trust_anchor_pinned": True,
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
    }:
        raise PromotionError("promoted Profile content trust gates are unsafe")
    content_proof = provisioning.get("content_proof")
    if (
        provisioning.get("$schema") != PROVISIONING_SCHEMA
        or not isinstance(content_proof, dict)
        or content_proof.get("public_release_trust_pinned") is not True
        or content_proof.get("activation_allowed") is not False
    ):
        raise PromotionError("promoted Profile provisioning trust state is unsafe")
    return {
        "$schema": RESULT_SCHEMA,
        "status": "promoted",
        "ready": True,
        "source_commit": public["source_commit"],
        "trust_sha256": public["trust_sha256"],
        "profile_content_publish_allowed": False,
        "profile_content_install_allowed": False,
        "profile_content_activation_allowed": False,
        "stable_profile_mutation_allowed": False,
        "physical_write_allowed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("check", "apply"))
    parser.add_argument("--repo-root", type=Path, default=Path(__file__).resolve().parents[2])
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--promotion-dir", type=Path)
    source.add_argument("--promotion-zip", type=Path)
    parser.add_argument("--verifier", type=Path, required=True)
    args = parser.parse_args()
    try:
        if args.promotion_zip is not None:
            result = (
                prepare_repository_promotion_zip(args.repo_root, args.promotion_zip, args.verifier)
                if args.mode == "check"
                else apply_repository_promotion_zip(args.repo_root, args.promotion_zip, args.verifier)
            )
        else:
            result = (
                prepare_repository_promotion(args.repo_root, args.promotion_dir, args.verifier)
                if args.mode == "check"
                else apply_repository_promotion(args.repo_root, args.promotion_dir, args.verifier)
            )
        public = {key: value for key, value in result.items() if key != "outputs"}
        print(json.dumps(public, indent=2, sort_keys=True))
        return 0
    except (PromotionError, OSError) as exc:
        print(f"profile-content-trust-public-promotion: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
