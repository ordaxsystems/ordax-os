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


def verify_canonical_digest(proof: dict, digest_key: str, core: dict, label: str) -> str:
    claimed = require_digest(proof.get(digest_key), f"{label} digest")
    actual = canonical_sha256(core)
    if claimed != actual:
        raise DependencyEvidenceError(
            f"{label} digest does not bind its canonical proof content: claimed={claimed} actual={actual}"
        )
    return claimed


def require_nonnegative_int(value: object, label: str) -> int:
    if not isinstance(value, int) or isinstance(value, bool) or value < 0:
        raise DependencyEvidenceError(f"invalid {label}")
    return value


def verify_first_hit_proof(first: dict) -> str:
    counts = first.get("counts")
    if not isinstance(counts, dict):
        raise DependencyEvidenceError("first-hit counts are missing")
    dependencies = require_nonnegative_int(counts.get("dependencies_checked"), "first-hit dependencies_checked")
    stage_hits = require_nonnegative_int(counts.get("stage_hits"), "first-hit stage_hits")
    rootfs_hits = require_nonnegative_int(counts.get("rootfs_hits"), "first-hit rootfs_hits")
    if dependencies <= 0 or dependencies != stage_hits + rootfs_hits:
        raise DependencyEvidenceError("first-hit counts do not describe a complete direct dependency set")
    core = {
        "runtime_id": first.get("runtime_id"),
        "staging_manifest_sha256": first.get("staging_manifest_sha256"),
        "counts": counts,
    }
    return verify_canonical_digest(first, "validation_sha256", core, "first-hit validation")


def verify_loader_invariance_proof(invariance: dict) -> str:
    needed_targets = invariance.get("needed_targets")
    if not isinstance(needed_targets, dict) or not needed_targets:
        raise DependencyEvidenceError("loader-invariance needed_targets are missing")
    counts = invariance.get("counts")
    if not isinstance(counts, dict):
        raise DependencyEvidenceError("loader-invariance counts are missing")
    pair_count = require_nonnegative_int(
        counts.get("needed_identity_soname_pairs"), "loader-invariance needed_identity_soname_pairs"
    )
    require_nonnegative_int(counts.get("staged_elf_files"), "loader-invariance staged_elf_files")
    require_nonnegative_int(
        counts.get("reachable_candidate_pathnames"), "loader-invariance reachable_candidate_pathnames"
    )
    if pair_count <= 0 or pair_count != len(needed_targets):
        raise DependencyEvidenceError("loader-invariance pair count does not match needed_targets")
    core = {
        "runtime_id": invariance.get("runtime_id"),
        "staging_manifest_sha256": invariance.get("staging_manifest_sha256"),
        "needed_targets": needed_targets,
    }
    return verify_canonical_digest(invariance, "validation_sha256", core, "loader-invariance validation")


def verify_dependency_inventory_proof(dependency: dict) -> str:
    elf_files = dependency.get("elf_files")
    external_packages = dependency.get("external_packages")
    if not isinstance(elf_files, dict) or not elf_files:
        raise DependencyEvidenceError("dependency inventory ELF map is missing")
    if not isinstance(external_packages, dict) or not external_packages:
        raise DependencyEvidenceError("dependency inventory external package map is missing")
    counts = dependency.get("counts")
    if not isinstance(counts, dict):
        raise DependencyEvidenceError("dependency inventory counts are missing")
    expected_sonames: set[str] = set()
    for package, record in external_packages.items():
        if not isinstance(package, str) or not package or not isinstance(record, dict):
            raise DependencyEvidenceError("invalid external package inventory entry")
        sonames = record.get("sonames")
        if not isinstance(sonames, list) or any(not isinstance(item, str) or not item for item in sonames):
            raise DependencyEvidenceError(f"invalid external SONAME inventory for package: {package}")
        expected_sonames.update(sonames)
    expected_counts = {
        "elf_files": len(elf_files),
        "external_packages": len(external_packages),
        "external_sonames": len(expected_sonames),
    }
    if counts != expected_counts:
        raise DependencyEvidenceError(
            f"dependency inventory counts do not match canonical content: expected={expected_counts} actual={counts}"
        )
    core = {
        "runtime_id": dependency.get("runtime_id"),
        "staging_manifest_sha256": dependency.get("staging_manifest_sha256"),
        "elf_files": elf_files,
        "external_packages": external_packages,
    }
    return verify_canonical_digest(dependency, "inventory_sha256", core, "dependency inventory")


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

    first_digest = verify_first_hit_proof(first)
    invariance_digest = verify_loader_invariance_proof(invariance)
    inventory_sha256 = verify_dependency_inventory_proof(dependency)

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
        "first_hit_validation_sha256": first_digest,
        "loader_invariance_validation_sha256": invariance_digest,
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
