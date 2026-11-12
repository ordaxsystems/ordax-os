#!/usr/bin/env python3
"""Validate the current canonical release-trust and physical-authorization state.

This verifier checks the repository as it exists now. It deliberately does not
replay the historical trust-bootstrap ceremony or mutate contracts backwards to
an earlier lifecycle state. Historical Stable/MVP proof remains evidence only.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
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
    state = authorization.get("status")
    pre_proof = "blocked-canonical-v4-release-proof-pending"
    post_proof = "blocked-explicit-physical-authorization-pending"
    authorized = "authorized"
    _require(state in (pre_proof, post_proof, authorized),
             "physical authorization is outside the canonical lifecycle")
    current_bound = state in (post_proof, authorized)
    owner_authorized = state == authorized
    _require(
        authorization.get("explicit_owner_authorization") is owner_authorized,
        "explicit owner authorization does not match lifecycle stage",
    )
    _require(
        authorization.get("physical_write_allowed") is owner_authorized,
        "physical write permission does not match lifecycle stage",
    )
    if owner_authorized:
        context = authorization.get("authorization_context_sha256")
        _require(
            isinstance(context, str) and len(context) == 64
            and all(ch in "0123456789abcdef" for ch in context),
            "authorized context hash is missing or malformed",
        )
    else:
        _require(
            authorization.get("authorization_context_sha256") is None,
            "authorization context must be absent before explicit consent",
        )

    requirements = authorization.get("requirements") or {}
    _require(
        requirements.get("canonical_v4_release_proof_bound") is current_bound,
        "replacement canonical v4 proof binding state mismatch",
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

    # Verify exact bytes for either the superseded historical receipt or the
    # current bound post-hardening receipt. State changes do not imply consent.
    release_binding = authorization.get("release_binding") or {}
    proof_relative = release_binding.get("proof_path")
    _require(isinstance(proof_relative, str) and proof_relative, "canonical v4 proof path is missing")
    proof_path = root / proof_relative
    _require(proof_path.is_file(), f"canonical v4 proof evidence is missing: {proof_relative}")
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
    _require(proof.get("physical_write_authorized") is False, "v4 proof must not encode write authorization")
    _require(proof.get("physical_write_performed") is False, "v4 proof must not encode a write result")
    _require(proof.get("release_activated") is False, "v4 proof must not imply activation")
    _require(proof.get("physical_target_selected") is False, "v4 proof must not select a target")
    _require(proof.get("signed_handoff_verified") is True, "signed handoff proof is absent")
    _require(proof.get("canonical_materialization_verified") is True, "HTTPS materialization proof is absent")
    if current_bound:
        publication = _json(root, "docs/contracts/canonical-v4-publication-request.json")
        sha = publication.get("source_commit")
        tag = publication.get("release_tag")
        expected_url = (
            "https://github.com/ordaxsystems/ordax-os/releases/download/"
            + str(tag) + "/release-envelope.json"
        )
        _require(
            proof.get("source_commit") == sha
            and proof.get("canonical_envelope_url") == expected_url
            and proof.get("release_envelope_sha256") == publication.get("release_envelope_sha256"),
            "bound v4 proof is not the approved signed HTTPS candidate",
        )
        artifacts = proof.get("artifacts")
        _require(
            isinstance(artifacts, dict)
            and set(artifacts) == {
                "system.erofs", "native-surface-runtime.erofs", "local-ai-runtime.erofs"
            }
            and all(
                isinstance(value, dict)
                and isinstance(value.get("size"), int)
                and not isinstance(value.get("size"), bool)
                and value["size"] > 0
                and isinstance(value.get("sha256"), str)
                and len(value["sha256"]) == 64
                and all(ch in "0123456789abcdef" for ch in value["sha256"])
                for value in artifacts.values()
            ),
            "bound v4 artifact inventory is not exactly valid",
        )

    if owner_authorized:
        # Reuse the existing canonical owner instead of duplicating its
        # source-context hash algorithm or inferring consent from flags.
        promotion_path = root / "tools/creator/physical_promotion.py"
        _require(promotion_path.is_file(), "canonical physical promotion source is missing")
        spec = importlib.util.spec_from_file_location(
            "ordax_release_trust_physical_promotion", promotion_path
        )
        _require(spec is not None and spec.loader is not None,
                 "canonical physical promotion evaluator cannot be loaded")
        promotion = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(promotion)
        try:
            physical = promotion.evaluate(root)
        except (OSError, ValueError, RuntimeError) as error:
            raise ContractError(
                f"canonical physical promotion cannot validate authorization: {error}"
            ) from error
        _require(
            physical.get("ready") is True
            and physical.get("authorization_context_matches_current_source") is True
            and physical.get("authorization_blockers") == [],
            "authorized physical source context is not currently valid",
        )

    return {
        "schema": "ordax.current-release-trust-verification/1",
        "status": "pass",
        "canonicalTrustSha256": trust_sha,
        "currentAuthorizationStatus": authorization["status"],
        "replacementV4ProofBound": current_bound,
        "historicalV4ProofSha256": proof_sha if not current_bound else None,
        "historicalV4SourceCommit": proof["source_commit"] if not current_bound else None,
        "currentV4ProofSha256": proof_sha if current_bound else None,
        "currentV4SourceCommit": proof["source_commit"] if current_bound else None,
        "explicitOwnerAuthorization": owner_authorized,
        "physicalWriteAllowed": owner_authorized,
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
