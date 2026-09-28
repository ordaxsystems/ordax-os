#!/usr/bin/env python3
"""Bind a verified public Stable v4 release proof to physical authorization.

This tool copies only the public canonical-v4-release-proof receipt into the
repository evidence area and updates the non-secret authorization contract
binding. It never authorizes a physical write, opens a device, invokes the
writer, or materializes a physical-media candidate.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
AUTH_PATH = Path("docs/contracts/physical-write-authorization.json")
TRUST_PATH = Path("bootstrap/trust/release-ed25519.json")
DESTINATION_PATH = Path("docs/evidence/canonical-v4-release-proof.json")
AUTH_SCHEMA = "prototype-ordax.physical-write-authorization/3"
PROOF_SCHEMA = "prototype-ordax.portable-v4-canonical-release-proof/1"
RESULT_SCHEMA = "prototype-ordax.canonical-v4-release-proof-binding/1"
PRE_PROOF_STATUS = "blocked-canonical-v4-release-proof-pending"
POST_PROOF_STATUS = "blocked-explicit-physical-authorization-pending"
HEX40 = re.compile(r"^[0-9a-f]{40}$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")
ARTIFACT_NAMES = {
    "system.erofs",
    "native-surface-runtime.erofs",
    "local-ai-runtime.erofs",
}


class BindingError(RuntimeError):
    pass


def _no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise BindingError(f"duplicate JSON key: {key}")
        result[key] = value
    return result


def _regular_bytes(path: Path, label: str) -> bytes:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise BindingError(f"{label} is unavailable: {path}") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise BindingError(f"{label} must be a regular non-symlink file")
    try:
        return path.read_bytes()
    except OSError as exc:
        raise BindingError(f"{label} cannot be read") from exc


def _json_object(payload: bytes, label: str) -> dict:
    try:
        value = json.loads(payload.decode("utf-8"), object_pairs_hook=_no_duplicates)
    except (UnicodeError, json.JSONDecodeError) as exc:
        raise BindingError(f"{label} is not valid UTF-8 JSON") from exc
    if not isinstance(value, dict):
        raise BindingError(f"{label} must contain one JSON object")
    return value


def _stable_https(value: object) -> bool:
    if not isinstance(value, str):
        return False
    try:
        parsed = urlsplit(value)
    except ValueError:
        return False
    return all(
        [
            parsed.scheme == "https",
            bool(parsed.hostname),
            parsed.username is None,
            parsed.password is None,
            parsed.query == "",
            parsed.fragment == "",
        ]
    )


def validate_proof(root: Path, proof_path: Path) -> tuple[dict, bytes, str]:
    payload = _regular_bytes(proof_path, "canonical v4 release proof")
    proof = _json_object(payload, "canonical v4 release proof")
    trust_payload = _regular_bytes(root / TRUST_PATH, "canonical release trust")
    trust_sha = hashlib.sha256(trust_payload).hexdigest()

    artifacts = proof.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != ARTIFACT_NAMES:
        raise BindingError("canonical v4 release proof artifact set is invalid")
    for name in sorted(ARTIFACT_NAMES):
        entry = artifacts.get(name)
        size = entry.get("size") if isinstance(entry, dict) else None
        sha = entry.get("sha256") if isinstance(entry, dict) else None
        if (
            not isinstance(entry, dict)
            or HEX64.fullmatch(str(sha or "")) is None
            or isinstance(size, bool)
            or not isinstance(size, int)
            or size <= 0
        ):
            raise BindingError(f"canonical v4 release proof artifact is invalid: {name}")

    required_sha = (
        "canonical_trust_sha256",
        "release_manifest_sha256",
        "release_envelope_sha256",
        "signed_handoff_receipt_sha256",
        "canonical_materialization_receipt_sha256",
    )
    if proof.get("schema") != PROOF_SCHEMA:
        raise BindingError("canonical v4 release proof schema is invalid")
    if HEX40.fullmatch(str(proof.get("source_commit") or "")) is None:
        raise BindingError("canonical v4 release proof source commit is invalid")
    if not _stable_https(proof.get("canonical_envelope_url")):
        raise BindingError("canonical v4 release proof URL is not stable public HTTPS")
    if any(HEX64.fullmatch(str(proof.get(name) or "")) is None for name in required_sha):
        raise BindingError("canonical v4 release proof digest is invalid")
    if proof.get("canonical_trust_sha256") != trust_sha:
        raise BindingError("canonical v4 release proof does not bind the pinned public trust")
    if proof.get("signed_handoff_verified") is not True:
        raise BindingError("canonical signed handoff was not verified")
    if proof.get("canonical_materialization_verified") is not True:
        raise BindingError("canonical materialization was not verified")
    for name in (
        "release_activated",
        "physical_target_selected",
        "physical_write_authorized",
        "physical_write_performed",
    ):
        if proof.get(name) is not False:
            raise BindingError(f"canonical v4 release proof unsafe flag is set: {name}")

    return proof, payload, hashlib.sha256(payload).hexdigest()


def _atomic_write(path: Path, payload: bytes) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=path.parent,
    )
    temporary = Path(temporary_name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(payload)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        try:
            temporary.unlink()
        except FileNotFoundError:
            pass


def _assert_existing_binding_is_idempotent(
    *,
    status: str,
    bindings: dict,
    release_binding: dict,
    proof: dict,
    proof_sha: str,
) -> None:
    existing_proof_sha = bindings.get("canonical_v4_release_proof_sha256")
    existing_source_commit = release_binding.get("source_commit")

    if status == PRE_PROOF_STATUS:
        # PRE_PROOF with a populated historical binding means those exact bytes were
        # deliberately superseded (for example after a physical proof exposed a
        # product-level defect). Rebinding the same proof, or merely repackaging a
        # proof for the same source commit, must not reopen owner authorization.
        if existing_proof_sha == proof_sha or existing_source_commit == proof.get("source_commit"):
            raise BindingError(
                "canonical v4 release proof was superseded by later source hardening; "
                "a replacement proof from a new source commit is required"
            )
        return

    if status != POST_PROOF_STATUS:
        return

    if existing_proof_sha != proof_sha:
        raise BindingError(
            "canonical v4 release proof is already bound to different bytes; "
            "reset to the pre-proof state before binding a replacement"
        )

    expected_release_binding = {
        "proof_path": DESTINATION_PATH.as_posix(),
        "proof_schema": PROOF_SCHEMA,
        "source_commit": proof["source_commit"],
        "canonical_envelope_url": proof["canonical_envelope_url"],
        "release_manifest_sha256": proof["release_manifest_sha256"],
        "release_envelope_sha256": proof["release_envelope_sha256"],
    }
    for key, expected in expected_release_binding.items():
        if release_binding.get(key) != expected:
            raise BindingError(
                "canonical v4 release proof binding is inconsistent with the existing release binding"
            )


def bind(repo_root: Path, proof_path: Path) -> dict:
    root = repo_root.resolve()
    proof, proof_payload, proof_sha = validate_proof(root, proof_path.resolve())

    auth_path = root / AUTH_PATH
    auth_payload = _regular_bytes(auth_path, "physical authorization contract")
    auth = _json_object(auth_payload, "physical authorization contract")
    if auth.get("$schema") != AUTH_SCHEMA:
        raise BindingError("physical authorization contract schema is incompatible")
    if auth.get("status") not in (PRE_PROOF_STATUS, POST_PROOF_STATUS):
        raise BindingError("physical authorization contract is not in a pre-consent state")
    if auth.get("physical_write_allowed") is not False:
        raise BindingError("physical write is unexpectedly enabled")
    if auth.get("explicit_owner_authorization") is not False:
        raise BindingError("explicit owner authorization is unexpectedly enabled")
    if auth.get("authorization_context_sha256") not in (None, ""):
        raise BindingError("authorization source context must be unset before consent")

    bindings = auth.get("bindings")
    if not isinstance(bindings, dict) or "canonical_v4_release_proof_sha256" not in bindings:
        raise BindingError("physical authorization proof binding is missing")
    trust_sha = hashlib.sha256(
        _regular_bytes(root / TRUST_PATH, "canonical release trust")
    ).hexdigest()
    if bindings.get("release_trust_sha256") != trust_sha:
        raise BindingError("physical authorization contract does not bind the pinned public trust")
    release_binding = auth.get("release_binding")
    if not isinstance(release_binding, dict):
        raise BindingError("physical authorization release binding is missing")
    requirements = auth.get("requirements")
    if (
        not isinstance(requirements, dict)
        or "canonical_v4_release_proof_bound" not in requirements
    ):
        raise BindingError("physical authorization proof-bound requirement is missing")
    if auth["status"] == PRE_PROOF_STATUS and requirements.get("canonical_v4_release_proof_bound") is not False:
        raise BindingError("pre-proof authorization state must not claim a current canonical v4 proof binding")
    if auth["status"] == POST_PROOF_STATUS and requirements.get("canonical_v4_release_proof_bound") is not True:
        raise BindingError("post-proof authorization state must retain the current canonical v4 proof binding")

    _assert_existing_binding_is_idempotent(
        status=auth["status"],
        bindings=bindings,
        release_binding=release_binding,
        proof=proof,
        proof_sha=proof_sha,
    )

    bindings["canonical_v4_release_proof_sha256"] = proof_sha
    release_binding.update(
        {
            "proof_path": DESTINATION_PATH.as_posix(),
            "proof_schema": PROOF_SCHEMA,
            "source_commit": proof["source_commit"],
            "canonical_envelope_url": proof["canonical_envelope_url"],
            "release_manifest_sha256": proof["release_manifest_sha256"],
            "release_envelope_sha256": proof["release_envelope_sha256"],
        }
    )
    requirements["canonical_v4_release_proof_bound"] = True
    auth["status"] = POST_PROOF_STATUS

    destination = root / DESTINATION_PATH
    _atomic_write(destination, proof_payload)

    encoded_auth = (json.dumps(auth, indent=2, ensure_ascii=False) + "\n").encode("utf-8")
    _atomic_write(auth_path, encoded_auth)

    return {
        "$schema": RESULT_SCHEMA,
        "status": "canonical-v4-release-proof-bound",
        "proof_bound": True,
        "next_step": "python tools/creator/authorize_physical_write.py check",
        "proof_path": DESTINATION_PATH.as_posix(),
        "proof_sha256": proof_sha,
        "source_commit": proof["source_commit"],
        "canonical_envelope_url": proof["canonical_envelope_url"],
        "release_manifest_sha256": proof["release_manifest_sha256"],
        "release_envelope_sha256": proof["release_envelope_sha256"],
        "physical_write_authorized": False,
        "physical_device_touched": False,
        "writer_invoked": False,
        "candidate_materialized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("proof", type=Path)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    args = parser.parse_args()
    try:
        result = bind(args.repo_root, args.proof)
    except BindingError as exc:
        print(json.dumps({"$schema": RESULT_SCHEMA, "status": "blocked", "error": str(exc)}, sort_keys=True))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
