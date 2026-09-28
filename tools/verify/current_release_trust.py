#!/usr/bin/env python3
"""Validate the current canonical release-trust and physical-authorization state.

This verifier checks the repository as it exists now. It deliberately does not
replay the historical trust-bootstrap ceremony or mutate contracts backwards to
an earlier lifecycle state. Historical Stable/MVP proof remains evidence only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[2]


class ContractError(RuntimeError):
    pass


def _json(root: Path, relative: str) -> dict[str, Any]:
    path = root / relative
    if not path.is_file():
        raise ContractError(f"required contract/evidence is missing: {relative}")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ContractError(f"invalid JSON in {relative}: {error}") from error
    if not isinstance(value, dict):
        raise ContractError(f"expected JSON object in {relative}")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractError(message)


def validate(root: Path) -> dict[str, Any]:
    root = root.resolve()
    policy = _json(root, "docs/contracts/release-trust-policy.json")
    minimal = _json(root, "docs/contracts/minimal-bootstrap.json")
    authorization = _json(root, "docs/contracts/physical-write-authorization.json")

    _require(
        policy.get("$schema") == "prototype-ordax.release-trust-policy/1",
        "release trust policy schema is not canonical",
    )
    _require(
        policy.get("status") == "canonical-public-trust-pinned",
        "canonical public trust is not pinned",
    )
    gates = policy.get("gates") or {}
    _require(gates.get("public_anchor_pinned") is True, "public trust anchor gate is not pinned")
    _require(gates.get("minimal_bootstrap_resolved") is True, "minimal bootstrap trust gate is unresolved")

    public_anchor = policy.get("public_anchor") or {}
    trust_relative = public_anchor.get("repository_path")
    _require(isinstance(trust_relative, str) and trust_relative, "public trust path is missing")
    trust_path = root / trust_relative
    _require(trust_path.is_file(), f"canonical public trust is missing: {trust_relative}")
    trust_sha = _sha256(trust_path)
    _require(
        trust_sha == public_anchor.get("sha256"),
        "canonical public trust bytes do not match release trust policy",
    )

    _require(minimal.get("all_artifacts_resolved") is True, "minimal bootstrap artifacts are unresolved")
    _require(minimal.get("physical_write_allowed") is False, "minimal bootstrap must remain non-destructive")

    _require(
        authorization.get("$schema") == "prototype-ordax.physical-write-authorization/3",
        "physical authorization schema is not canonical",
    )
    _require(
        authorization.get("status") == "blocked-canonical-v4-release-proof-pending",
        "physical authorization is not at the replacement v4 proof gate",
    )
    _require(
        authorization.get("explicit_owner_authorization") is False,
        "owner authorization must remain false before replacement proof binding",
    )
    _require(
        authorization.get("physical_write_allowed") is False,
        "physical write must remain fail-closed",
    )
    _require(
        authorization.get("authorization_context_sha256") is None,
        "authorization context must be absent before fresh owner authorization",
    )

    requirements = authorization.get("requirements") or {}
    _require(
        requirements.get("canonical_v4_release_proof_bound") is False,
        "replacement canonical v4 proof must not be marked bound",
    )
    _require(
        requirements.get("canonical_public_trust_pinned") is True,
        "physical authorization contract lost the canonical trust prerequisite",
    )
    _require(
        requirements.get("minimal_bootstrap_all_artifacts_resolved") is True,
        "physical authorization contract lost the resolved-bootstrap prerequisite",
    )

    bindings = authorization.get("bindings") or {}
    _require(
        bindings.get("release_trust_sha256") == trust_sha,
        "physical authorization trust binding does not match canonical trust bytes",
    )

    # The pre-hardening proof is retained only to identify the superseded evidence
    # that must never reopen authorization for the current candidate.
    release_binding = authorization.get("release_binding") or {}
    proof_relative = release_binding.get("proof_path")
    _require(isinstance(proof_relative, str) and proof_relative, "historical v4 proof path is missing")
    proof_path = root / proof_relative
    _require(proof_path.is_file(), f"historical v4 proof evidence is missing: {proof_relative}")
    proof_sha = _sha256(proof_path)
    _require(
        proof_sha == bindings.get("canonical_v4_release_proof_sha256"),
        "historical v4 proof digest no longer matches its evidence binding",
    )

    proof = _json(root, proof_relative)
    _require(
        proof.get("schema") == release_binding.get("proof_schema"),
        "historical v4 proof schema does not match its binding",
    )
    _require(
        proof.get("source_commit") == release_binding.get("source_commit"),
        "historical v4 proof source commit does not match its binding",
    )
    _require(
        proof.get("canonical_envelope_url") == release_binding.get("canonical_envelope_url"),
        "historical v4 proof envelope URL does not match its binding",
    )
    _require(
        proof.get("release_manifest_sha256") == release_binding.get("release_manifest_sha256"),
        "historical v4 proof manifest digest does not match its binding",
    )
    _require(
        proof.get("release_envelope_sha256") == release_binding.get("release_envelope_sha256"),
        "historical v4 proof envelope digest does not match its binding",
    )
    _require(
        proof.get("canonical_trust_sha256") == trust_sha,
        "historical v4 proof was not verified by the current canonical trust anchor",
    )
    _require(proof.get("physical_write_authorized") is False, "historical proof must not encode write authorization")
    _require(proof.get("physical_write_performed") is False, "historical release proof must not encode a write result")

    return {
        "schema": "ordax.current-release-trust-verification/1",
        "status": "pass",
        "canonicalTrustSha256": trust_sha,
        "currentAuthorizationStatus": authorization["status"],
        "replacementV4ProofBound": False,
        "historicalV4ProofSha256": proof_sha,
        "historicalV4SourceCommit": proof["source_commit"],
        "explicitOwnerAuthorization": False,
        "physicalWriteAllowed": False,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    result = validate(args.repo_root)
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
