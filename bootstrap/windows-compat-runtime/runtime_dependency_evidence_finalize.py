#!/usr/bin/env python3
"""Bind all staged runtime dependency evidence into one authoritative proof."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-dependency-discovery.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-dependency-evidence-proof/1"


class DependencyEvidenceError(RuntimeError):
    pass


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DependencyEvidenceError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise DependencyEvidenceError(f"{label} must be an object")
    return value


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_contract() -> dict:
    contract = load_json(CONTRACT, "runtime dependency contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-discovery/1":
        raise DependencyEvidenceError("unexpected runtime dependency contract schema")
    if contract.get("status") != "discovery-only-not-promotable":
        raise DependencyEvidenceError("runtime dependency contract status drifted")
    inspection = contract.get("inspection", {})
    if inspection.get("authoritative_evidence_proof_required") is not True:
        raise DependencyEvidenceError("runtime dependency contract does not require authoritative evidence")
    promotion = contract.get("promotion", {})
    if any(value is not False for value in promotion.values()):
        raise DependencyEvidenceError("runtime dependency contract overclaims promotion")
    return contract


def require_digest(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise DependencyEvidenceError(f"invalid {label}")
    return value


def finalize(full: dict, first: dict, invariance: dict, dependency: dict) -> dict:
    contract = load_contract()
    schemas = contract["input"]
    if full.get("$schema") != schemas["full_build_proof_schema"]:
        raise DependencyEvidenceError("unexpected full build proof schema")
    if first.get("$schema") != schemas["first_hit_proof_schema"]:
        raise DependencyEvidenceError("unexpected first-hit proof schema")
    if invariance.get("$schema") != schemas["loader_invariance_proof_schema"]:
        raise DependencyEvidenceError("unexpected loader invariance proof schema")
    if dependency.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-proof/1":
        raise DependencyEvidenceError("unexpected direct dependency proof schema")

    runtime_id = contract["runtime_id"]
    if any(item.get("runtime_id") != runtime_id for item in (full, first, invariance, dependency)):
        raise DependencyEvidenceError("runtime identity diverged across dependency evidence")
    staging = full.get("staging", {})
    stage_digest = require_digest(staging.get("canonical_manifest_sha256"), "full-build staging digest")
    if any(item.get("staging_manifest_sha256") != stage_digest for item in (first, invariance, dependency)):
        raise DependencyEvidenceError("staging manifest diverged across dependency evidence")

    full_gates = full.get("gates", {})
    if full_gates.get("full_build_proof_passed") is not True or full_gates.get("staged_install_completed") is not True:
        raise DependencyEvidenceError("full-build evidence is not proven")
    first_gates = first.get("gates", {})
    if first_gates.get("first_pathname_hit_verified") is not True:
        raise DependencyEvidenceError("first pathname hit evidence is not verified")
    invariance_gates = invariance.get("gates", {})
    if invariance_gates.get("staged_needed_by_chain_invariance_verified") is not True:
        raise DependencyEvidenceError("needed_by chain invariance is not verified")
    if invariance_gates.get("staged_shortname_reuse_invariance_verified") is not True:
        raise DependencyEvidenceError("shortname reuse invariance is not verified")
    if invariance_gates.get("external_transitive_closure_verified") is not False:
        raise DependencyEvidenceError("loader invariance proof overclaims external transitive closure")
    dependency_gates = dependency.get("gates", {})
    if dependency_gates.get("loader_resolution_verified") is not True:
        raise DependencyEvidenceError("direct dependency loader resolution is not verified")
    if dependency_gates.get("staging_dependency_inventory_complete") is not True:
        raise DependencyEvidenceError("staging dependency inventory is not complete")

    for proof, label in (
        (first, "first-hit"),
        (invariance, "loader-invariance"),
    ):
        require_digest(proof.get("validation_sha256"), f"{label} validation digest")
    inventory_sha256 = require_digest(dependency.get("inventory_sha256"), "dependency inventory digest")

    forbidden_gates = (
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    )
    for label, proof in (
        ("full-build", full),
        ("first-hit", first),
        ("loader-invariance", invariance),
        ("direct-dependency", dependency),
    ):
        gates = proof.get("gates", {})
        if any(gates.get(key) is not False for key in forbidden_gates):
            raise DependencyEvidenceError(f"{label} evidence crossed a forbidden promotion/execution boundary")

    core = {
        "runtime_id": runtime_id,
        "staging_manifest_sha256": stage_digest,
        "first_hit_validation_sha256": first["validation_sha256"],
        "loader_invariance_validation_sha256": invariance["validation_sha256"],
        "dependency_inventory_sha256": inventory_sha256,
        "dependency_counts": dependency.get("counts"),
        "first_hit_counts": first.get("counts"),
        "loader_invariance_counts": invariance.get("counts"),
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "staged-runtime-dependency-evidence-verified-not-runtime-promoted",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "full_build_proof_verified": True,
            "first_pathname_hit_verified": True,
            "staged_needed_by_chain_invariance_verified": True,
            "staged_shortname_reuse_invariance_verified": True,
            "loader_resolution_verified": True,
            "staging_dependency_inventory_complete": True,
            "external_transitive_closure_verified": False,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "finalize"])
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--first-hit-proof", type=Path)
    parser.add_argument("--loader-invariance-proof", type=Path)
    parser.add_argument("--dependency-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility runtime dependency evidence contract: PASS")
        return 0
    if not all((args.full_build_proof, args.first_hit_proof, args.loader_invariance_proof, args.dependency_proof, args.out)):
        raise DependencyEvidenceError(
            "finalize requires --full-build-proof, --first-hit-proof, --loader-invariance-proof, --dependency-proof and --out"
        )
    result = finalize(
        load_json(args.full_build_proof, "full-build proof"),
        load_json(args.first_hit_proof, "first-hit proof"),
        load_json(args.loader_invariance_proof, "loader-invariance proof"),
        load_json(args.dependency_proof, "dependency proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility runtime dependency evidence: PASS")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DependencyEvidenceError as exc:
        print(f"windows-compat-runtime-dependency-evidence: {exc}", file=sys.stderr)
        raise SystemExit(2)
