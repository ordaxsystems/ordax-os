#!/usr/bin/env python3
"""Bind contextual first-hit, loader invariance, and dependency inventory evidence."""

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
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-contextual-dependency-evidence-proof/1"
FIRST_SCHEMA = "prototype-ordax.windows-compat-runtime-contextual-first-hit-proof/1"
INVARIANCE_SCHEMA = "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1"
DEPENDENCY_SCHEMA = "prototype-ordax.windows-compat-runtime-contextual-dependency-proof/1"


class ContextualDependencyEvidenceError(RuntimeError):
    pass


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContextualDependencyEvidenceError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ContextualDependencyEvidenceError(f"{label} must be an object")
    return value


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def require_digest(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ContextualDependencyEvidenceError(f"invalid {label}")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "runtime dependency contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-discovery/1":
        raise ContextualDependencyEvidenceError("unexpected runtime dependency contract schema")
    if contract.get("status") != "discovery-only-not-promotable":
        raise ContextualDependencyEvidenceError("runtime dependency contract status drifted")
    inspection = contract.get("inspection", {})
    if inspection.get("authoritative_evidence_proof_required") is not True:
        raise ContextualDependencyEvidenceError("runtime dependency contract does not require authoritative evidence")
    if inspection.get("contextual_first_hit_requires_loader_invariance") is not True:
        raise ContextualDependencyEvidenceError("runtime dependency contract lacks contextual first-hit binding")
    if inspection.get("contextual_dependency_inventory_requires_loader_invariance") is not True:
        raise ContextualDependencyEvidenceError("runtime dependency contract lacks contextual inventory binding")
    if any(value is not False for value in contract.get("promotion", {}).values()):
        raise ContextualDependencyEvidenceError("runtime dependency contract overclaims promotion")
    return contract


def verify_invariance(proof: dict) -> str:
    targets = proof.get("needed_targets")
    if not isinstance(targets, dict) or not targets:
        raise ContextualDependencyEvidenceError("loader-invariance target map is missing")
    core = {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "needed_targets": targets,
    }
    claimed = require_digest(proof.get("validation_sha256"), "loader-invariance digest")
    if canonical_sha256(core) != claimed:
        raise ContextualDependencyEvidenceError("loader-invariance canonical digest mismatch")
    if proof.get("counts", {}).get("needed_identity_soname_pairs") != len(targets):
        raise ContextualDependencyEvidenceError("loader-invariance pair count drifted")
    return claimed


def verify_first(first: dict, invariance_digest: str) -> str:
    counts = first.get("counts")
    if not isinstance(counts, dict):
        raise ContextualDependencyEvidenceError("contextual first-hit counts are missing")
    dependencies = counts.get("dependencies_checked")
    stage_hits = counts.get("stage_hits")
    rootfs_hits = counts.get("rootfs_hits")
    contextual = counts.get("needed_by_context_hits")
    if any(not isinstance(value, int) or isinstance(value, bool) or value < 0 for value in (dependencies, stage_hits, rootfs_hits, contextual)):
        raise ContextualDependencyEvidenceError("invalid contextual first-hit counts")
    if dependencies <= 0 or dependencies != stage_hits + rootfs_hits:
        raise ContextualDependencyEvidenceError("contextual first-hit does not cover every dependency edge")
    if first.get("loader_invariance_validation_sha256") != invariance_digest:
        raise ContextualDependencyEvidenceError("contextual first-hit is not bound to loader invariance")
    core = {
        "runtime_id": first.get("runtime_id"),
        "staging_manifest_sha256": first.get("staging_manifest_sha256"),
        "loader_invariance_validation_sha256": invariance_digest,
        "counts": counts,
    }
    claimed = require_digest(first.get("validation_sha256"), "contextual first-hit digest")
    if canonical_sha256(core) != claimed:
        raise ContextualDependencyEvidenceError("contextual first-hit canonical digest mismatch")
    return claimed


def verify_dependency(dependency: dict, invariance_digest: str) -> str:
    elf_files = dependency.get("elf_files")
    external_packages = dependency.get("external_packages")
    if not isinstance(elf_files, dict) or not elf_files:
        raise ContextualDependencyEvidenceError("contextual dependency ELF map is missing")
    if not isinstance(external_packages, dict) or not external_packages:
        raise ContextualDependencyEvidenceError("contextual dependency external package map is missing")
    if dependency.get("loader_invariance_validation_sha256") != invariance_digest:
        raise ContextualDependencyEvidenceError("contextual dependency inventory is not bound to loader invariance")
    expected_sonames: set[str] = set()
    for package, record in external_packages.items():
        if not isinstance(package, str) or not package or not isinstance(record, dict):
            raise ContextualDependencyEvidenceError("invalid contextual external package record")
        sonames = record.get("sonames")
        if not isinstance(sonames, list) or any(not isinstance(item, str) or not item for item in sonames):
            raise ContextualDependencyEvidenceError(f"invalid external SONAME inventory: {package}")
        expected_sonames.update(sonames)
    counts = dependency.get("counts", {})
    if counts.get("elf_files") != len(elf_files):
        raise ContextualDependencyEvidenceError("contextual dependency ELF count drifted")
    if counts.get("external_packages") != len(external_packages):
        raise ContextualDependencyEvidenceError("contextual dependency package count drifted")
    if counts.get("external_sonames") != len(expected_sonames):
        raise ContextualDependencyEvidenceError("contextual dependency SONAME count drifted")
    for key in ("local_loader_edges", "bootstrap_shortname_edges", "needed_by_context_edges"):
        value = counts.get(key)
        if not isinstance(value, int) or isinstance(value, bool) or value < 0:
            raise ContextualDependencyEvidenceError(f"invalid contextual dependency count: {key}")
    core = {
        "runtime_id": dependency.get("runtime_id"),
        "staging_manifest_sha256": dependency.get("staging_manifest_sha256"),
        "loader_invariance_validation_sha256": invariance_digest,
        "elf_files": elf_files,
        "external_packages": external_packages,
    }
    claimed = require_digest(dependency.get("inventory_sha256"), "contextual dependency inventory digest")
    if canonical_sha256(core) != claimed:
        raise ContextualDependencyEvidenceError("contextual dependency inventory canonical digest mismatch")
    return claimed


def finalize(full: dict, first: dict, invariance: dict, dependency: dict) -> dict:
    contract = load_contract()
    if full.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise ContextualDependencyEvidenceError("unexpected full-build proof schema")
    if first.get("$schema") != FIRST_SCHEMA:
        raise ContextualDependencyEvidenceError("unexpected contextual first-hit proof schema")
    if invariance.get("$schema") != INVARIANCE_SCHEMA:
        raise ContextualDependencyEvidenceError("unexpected loader-invariance proof schema")
    if dependency.get("$schema") != DEPENDENCY_SCHEMA:
        raise ContextualDependencyEvidenceError("unexpected contextual dependency proof schema")

    runtime_id = contract["runtime_id"]
    if any(item.get("runtime_id") != runtime_id for item in (full, first, invariance, dependency)):
        raise ContextualDependencyEvidenceError("runtime identity diverged across contextual dependency evidence")
    stage_digest = require_digest(full.get("staging", {}).get("canonical_manifest_sha256"), "full-build staging digest")
    if any(item.get("staging_manifest_sha256") != stage_digest for item in (first, invariance, dependency)):
        raise ContextualDependencyEvidenceError("staging manifest diverged across contextual dependency evidence")

    if full.get("gates", {}).get("full_build_proof_passed") is not True or full.get("gates", {}).get("staged_install_completed") is not True:
        raise ContextualDependencyEvidenceError("full-build evidence is not proven")
    invariance_gates = invariance.get("gates", {})
    if invariance_gates.get("staged_needed_by_chain_invariance_verified") is not True or invariance_gates.get("staged_shortname_reuse_invariance_verified") is not True:
        raise ContextualDependencyEvidenceError("loader invariance prerequisite is incomplete")
    first_gates = first.get("gates", {})
    if first_gates.get("first_pathname_hit_verified") is not True or first_gates.get("needed_by_context_first_hit_verified") is not True:
        raise ContextualDependencyEvidenceError("contextual first-hit evidence is incomplete")
    dependency_gates = dependency.get("gates", {})
    if dependency_gates.get("loader_resolution_verified") is not True or dependency_gates.get("needed_by_context_resolution_verified") is not True or dependency_gates.get("staging_dependency_inventory_complete") is not True:
        raise ContextualDependencyEvidenceError("contextual dependency inventory is incomplete")

    invariance_digest = verify_invariance(invariance)
    first_digest = verify_first(first, invariance_digest)
    inventory_digest = verify_dependency(dependency, invariance_digest)

    forbidden = (
        "runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized",
        "execution_authorized", "wine_executed", "windows_payload_executed",
    )
    for label, proof in (("full", full), ("first", first), ("invariance", invariance), ("dependency", dependency)):
        gates = proof.get("gates", {})
        if any(gates.get(key) is not False for key in forbidden):
            raise ContextualDependencyEvidenceError(f"{label} evidence crossed a forbidden promotion/execution boundary")

    core = {
        "runtime_id": runtime_id,
        "staging_manifest_sha256": stage_digest,
        "loader_invariance_validation_sha256": invariance_digest,
        "contextual_first_hit_validation_sha256": first_digest,
        "dependency_inventory_sha256": inventory_digest,
        "dependency_counts": dependency["counts"],
        "first_hit_counts": first["counts"],
        "loader_invariance_counts": invariance["counts"],
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "contextual-staged-runtime-dependency-evidence-verified-not-runtime-promoted",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "full_build_proof_verified": True,
            "loader_invariance_proof_verified": True,
            "first_pathname_hit_verified": True,
            "needed_by_context_first_hit_verified": True,
            "staged_needed_by_chain_invariance_verified": True,
            "staged_shortname_reuse_invariance_verified": True,
            "loader_resolution_verified": True,
            "needed_by_context_resolution_verified": True,
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
        print("windows compatibility contextual runtime dependency evidence contract: PASS")
        return 0
    if not all((args.full_build_proof, args.first_hit_proof, args.loader_invariance_proof, args.dependency_proof, args.out)):
        raise ContextualDependencyEvidenceError(
            "finalize requires --full-build-proof, --first-hit-proof, --loader-invariance-proof, --dependency-proof and --out"
        )
    result = finalize(
        load_json(args.full_build_proof, "full-build proof"),
        load_json(args.first_hit_proof, "contextual first-hit proof"),
        load_json(args.loader_invariance_proof, "loader-invariance proof"),
        load_json(args.dependency_proof, "contextual dependency proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility contextual runtime dependency evidence: PASS")
    print(json.dumps(result["gates"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ContextualDependencyEvidenceError as exc:
        print(f"windows-compat-runtime-contextual-dependency-evidence: {exc}", file=sys.stderr)
        raise SystemExit(2)
