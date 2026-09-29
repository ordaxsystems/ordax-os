#!/usr/bin/env python3
"""Bind raw closure and loader-guard evidence into one DT_NEEDED proof."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-dependency-closure.json"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-closure-evidence-proof/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ClosureEvidenceError(RuntimeError):
    pass


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ClosureEvidenceError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ClosureEvidenceError(f"{label} must be an object")
    return value


def canonical_sha256(value: object) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def require_digest(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ClosureEvidenceError(f"invalid {label}")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "runtime dependency closure contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-closure/1":
        raise ClosureEvidenceError("unexpected runtime dependency closure schema")
    if contract.get("status") != "transitive-dt-needed-discovery-only-not-promotable":
        raise ClosureEvidenceError("runtime dependency closure status drifted")
    verification = contract.get("verification", {})
    if verification.get("closure_guard_proof_required") is not True:
        raise ClosureEvidenceError("closure contract does not require loader guard proof")
    if verification.get("closure_evidence_finalizer_required") is not True:
        raise ClosureEvidenceError("closure contract does not require evidence finalizer")
    if contract.get("classification", {}).get("runtime_dependency_inventory_complete_after_this_gate") is not False:
        raise ClosureEvidenceError("DT_NEEDED closure may not claim complete runtime inventory")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise ClosureEvidenceError("closure contract claims promotion/execution authority")
    return contract


def direct_evidence_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "first_hit_validation_sha256": proof.get("first_hit_validation_sha256"),
        "loader_invariance_validation_sha256": proof.get("loader_invariance_validation_sha256"),
        "dependency_inventory_sha256": proof.get("dependency_inventory_sha256"),
        "dependency_counts": proof.get("dependency_counts"),
        "first_hit_counts": proof.get("first_hit_counts"),
        "loader_invariance_counts": proof.get("loader_invariance_counts"),
    }


def closure_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "direct_inventory_sha256": proof.get("direct_inventory_sha256"),
        "roots": proof.get("roots"),
        "nodes": proof.get("nodes"),
        "contexts": proof.get("contexts"),
        "external_packages": proof.get("external_packages"),
    }


def guard_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "direct_inventory_sha256": proof.get("direct_inventory_sha256"),
        "direct_evidence_sha256": proof.get("direct_evidence_sha256"),
        "closure_sha256": proof.get("closure_sha256"),
        "shortname_targets": proof.get("shortname_targets"),
        "counts": proof.get("counts"),
    }


def finalize(direct_evidence: dict, closure: dict, guard: dict) -> dict:
    contract = load_contract()
    schemas = contract.get("input", {})
    if direct_evidence.get("$schema") != schemas.get("direct_dependency_evidence_proof_schema"):
        raise ClosureEvidenceError("unexpected direct dependency evidence schema")
    if closure.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-closure-proof/1":
        raise ClosureEvidenceError("unexpected raw closure proof schema")
    if guard.get("$schema") != schemas.get("closure_loader_guard_proof_schema"):
        raise ClosureEvidenceError("unexpected closure loader guard proof schema")
    runtime_id = contract.get("runtime_id")
    if any(item.get("runtime_id") != runtime_id for item in (direct_evidence, closure, guard)):
        raise ClosureEvidenceError("runtime identity drifted across closure evidence")
    stage_digest = require_digest(direct_evidence.get("staging_manifest_sha256"), "staging manifest digest")
    if closure.get("staging_manifest_sha256") != stage_digest or guard.get("staging_manifest_sha256") != stage_digest:
        raise ClosureEvidenceError("staging manifest drifted across closure evidence")

    direct_evidence_digest = require_digest(direct_evidence.get("evidence_sha256"), "direct evidence digest")
    if canonical_sha256(direct_evidence_core(direct_evidence)) != direct_evidence_digest:
        raise ClosureEvidenceError("direct dependency evidence digest does not verify")
    direct_inventory_digest = require_digest(direct_evidence.get("dependency_inventory_sha256"), "direct inventory digest")
    if closure.get("direct_inventory_sha256") != direct_inventory_digest:
        raise ClosureEvidenceError("raw closure is not bound to direct dependency inventory")
    if guard.get("direct_inventory_sha256") != direct_inventory_digest:
        raise ClosureEvidenceError("closure guard is not bound to direct dependency inventory")
    if guard.get("direct_evidence_sha256") != direct_evidence_digest:
        raise ClosureEvidenceError("closure guard is not bound to authoritative direct evidence")

    closure_digest = require_digest(closure.get("closure_sha256"), "raw closure digest")
    if canonical_sha256(closure_core(closure)) != closure_digest:
        raise ClosureEvidenceError("raw closure digest does not verify")
    roots = closure.get("roots")
    nodes = closure.get("nodes")
    contexts = closure.get("contexts")
    external_packages = closure.get("external_packages")
    if not isinstance(roots, list) or not isinstance(nodes, dict) or not isinstance(contexts, dict) or not isinstance(external_packages, dict):
        raise ClosureEvidenceError("raw closure canonical collections are invalid")
    edge_count = cycle_edges = 0
    for context in contexts.values():
        if not isinstance(context, dict) or not isinstance(context.get("edges"), list):
            raise ClosureEvidenceError("raw closure context edges are invalid")
        edge_count += len(context["edges"])
        cycle_edges += sum(1 for edge in context["edges"] if isinstance(edge, dict) and edge.get("cycle") is True)
    sonames: set[str] = set()
    for package, record in external_packages.items():
        if not isinstance(package, str) or not package or not isinstance(record, dict):
            raise ClosureEvidenceError("raw closure external package entry is invalid")
        values = record.get("sonames")
        if not isinstance(values, list) or any(not isinstance(item, str) or not item for item in values):
            raise ClosureEvidenceError(f"raw closure external SONAME set is invalid: {package}")
        sonames.update(values)
    expected_closure_counts = {
        "root_elf_files": len(roots),
        "nodes": len(nodes),
        "context_states": len(contexts),
        "edges": edge_count,
        "cycle_edges": cycle_edges,
        "external_packages": len(external_packages),
        "external_sonames": len(sonames),
    }
    if closure.get("counts") != expected_closure_counts:
        raise ClosureEvidenceError(
            f"raw closure counts do not match canonical content: expected={expected_closure_counts} actual={closure.get('counts')}"
        )
    if guard.get("closure_sha256") != closure_digest:
        raise ClosureEvidenceError("closure guard is not bound to raw closure")
    guard_digest = require_digest(guard.get("validation_sha256"), "closure guard digest")
    if canonical_sha256(guard_core(guard)) != guard_digest:
        raise ClosureEvidenceError("closure loader guard digest does not verify")
    guard_counts = guard.get("counts")
    shortname_targets = guard.get("shortname_targets")
    if not isinstance(guard_counts, dict) or not isinstance(shortname_targets, dict) or not shortname_targets:
        raise ClosureEvidenceError("closure loader guard canonical counts/targets are invalid")
    expected_guard_relations = (
        guard_counts.get("contexts_checked") == len(contexts),
        guard_counts.get("edges_checked") == edge_count,
        guard_counts.get("edges_checked") == guard_counts.get("stage_hits", -1) + guard_counts.get("rootfs_hits", -1),
        guard_counts.get("identity_soname_pairs") == len(shortname_targets),
    )
    if not all(expected_guard_relations):
        raise ClosureEvidenceError("closure loader guard counts do not match closure/target content")

    direct_gates = direct_evidence.get("gates", {})
    for key in (
        "full_build_proof_verified",
        "first_pathname_hit_verified",
        "staged_needed_by_chain_invariance_verified",
        "staged_shortname_reuse_invariance_verified",
        "loader_resolution_verified",
        "staging_dependency_inventory_complete",
    ):
        if direct_gates.get(key) is not True:
            raise ClosureEvidenceError(f"direct evidence prerequisite is not proven: {key}")
    closure_gates = closure.get("gates", {})
    if closure_gates.get("transitive_dt_needed_closure_complete") is not True:
        raise ClosureEvidenceError("raw transitive DT_NEEDED closure is not complete")
    if closure_gates.get("dynamic_load_inventory_complete") is not False:
        raise ClosureEvidenceError("raw closure overclaims dynamic-load inventory")
    guard_gates = guard.get("gates", {})
    for key in (
        "direct_authoritative_evidence_verified",
        "closure_first_pathname_hit_verified",
        "closure_shortname_reuse_invariance_verified",
        "closure_origin_alias_context_verified",
        "transitive_dt_needed_loader_semantics_verified",
    ):
        if guard_gates.get(key) is not True:
            raise ClosureEvidenceError(f"closure guard prerequisite is not proven: {key}")

    forbidden = (
        "runtime_dependency_inventory_complete",
        "runtime_package_content_hashes_pinned",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    )
    for label, proof in (
        ("direct evidence", direct_evidence),
        ("raw closure", closure),
        ("closure guard", guard),
    ):
        gates = proof.get("gates", {})
        if any(gates.get(key) is not False for key in forbidden):
            raise ClosureEvidenceError(f"{label} crossed a forbidden promotion/execution boundary")

    core = {
        "runtime_id": runtime_id,
        "staging_manifest_sha256": stage_digest,
        "direct_inventory_sha256": direct_inventory_digest,
        "direct_evidence_sha256": direct_evidence_digest,
        "closure_sha256": closure_digest,
        "closure_loader_guard_sha256": guard_digest,
        "closure_counts": closure.get("counts"),
        "loader_guard_counts": guard.get("counts"),
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "transitive-dt-needed-evidence-verified-dynamic-loads-not-inventoried-not-executable",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "direct_dependency_evidence_verified": True,
            "transitive_dt_needed_closure_verified": True,
            "closure_first_pathname_hit_verified": True,
            "closure_shortname_reuse_invariance_verified": True,
            "closure_origin_alias_context_verified": True,
            "external_transitive_dt_needed_closure_verified": True,
            "dynamic_load_inventory_complete": False,
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
    parser.add_argument("--direct-evidence-proof", type=Path)
    parser.add_argument("--closure-proof", type=Path)
    parser.add_argument("--closure-loader-guard-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility transitive closure evidence contract: PASS")
        return 0
    if not all((args.direct_evidence_proof, args.closure_proof, args.closure_loader_guard_proof, args.out)):
        raise ClosureEvidenceError(
            "finalize requires --direct-evidence-proof, --closure-proof, --closure-loader-guard-proof and --out"
        )
    result = finalize(
        load_json(args.direct_evidence_proof, "direct dependency evidence proof"),
        load_json(args.closure_proof, "raw closure proof"),
        load_json(args.closure_loader_guard_proof, "closure loader guard proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility transitive closure evidence: PASS")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ClosureEvidenceError as exc:
        print(f"windows-compat-runtime-closure-evidence: {exc}", file=sys.stderr)
        raise SystemExit(2)
