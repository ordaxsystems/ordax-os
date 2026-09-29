#!/usr/bin/env python3
"""Prove first-pathname safety with explicit musl needed_by context.

The low-level first-hit guard remains authoritative for an ELF's own RUNPATH /
RPATH + system path. When that isolated search has no pathname, this proof may
use the loader-invariance evidence for the same ELF identity + SONAME, but only
after reopening every modeled needed_by pathname and proving all reachable hits
converge to the exact invariant target. It never skips an existing non-ELF,
wrong-identity object, cross-scope collision, or divergent target.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys

HERE = Path(__file__).resolve().parent
PROBE_PATH = HERE / "runtime_dependency_probe.py"
FIRST_PATH = HERE / "runtime_dependency_first_hit_guard.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-contextual-first-hit-proof/1"
INVARIANCE_SCHEMA = "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1"


class ContextualFirstHitError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ContextualFirstHitError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PROBE = load_module("ordax_runtime_dependency_probe_for_contextual_first_hit", PROBE_PATH)
FIRST = load_module("ordax_runtime_direct_first_hit_for_contextual_first_hit", FIRST_PATH)


def load_contract() -> dict:
    contract = PROBE.load_contract()
    inspection = contract.get("inspection", {})
    required = (
        "first_pathname_hit_validation_required",
        "musl_needed_by_chain_invariance_required",
        "loader_invariance_proof_required",
        "contextual_first_hit_requires_loader_invariance",
    )
    if any(inspection.get(key) is not True for key in required):
        raise ContextualFirstHitError("contextual first-hit contract requirements drifted")
    if inspection.get("ambient_ld_library_path_allowed") is not False:
        raise ContextualFirstHitError("contextual first-hit requires ambient LD_LIBRARY_PATH to remain forbidden")
    return contract


def pair_key(elf: dict, soname: str) -> str:
    return f"ELF{elf['class']}:machine={elf['machine']}:{elf['endianness']}:{soname}"


def _safe_relative(value: str, label: str) -> str:
    if not isinstance(value, str) or not value:
        raise ContextualFirstHitError(f"invalid {label}")
    pure = PurePosixPath(value)
    if pure.is_absolute() or ".." in pure.parts:
        raise ContextualFirstHitError(f"unsafe {label}: {value!r}")
    return pure.as_posix()


def validate_loader_invariance_proof(
    proof: dict, full_build_proof: dict, stage_manifest_sha256: str, contract: dict
) -> str:
    if proof.get("$schema") != INVARIANCE_SCHEMA:
        raise ContextualFirstHitError("unexpected loader-invariance proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id") or proof.get("runtime_id") != full_build_proof.get("runtime_id"):
        raise ContextualFirstHitError("loader-invariance runtime identity drifted")
    if proof.get("staging_manifest_sha256") != stage_manifest_sha256:
        raise ContextualFirstHitError("loader-invariance staging identity drifted")
    targets = proof.get("needed_targets")
    if not isinstance(targets, dict) or not targets:
        raise ContextualFirstHitError("loader-invariance target map is missing")
    core = {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "needed_targets": targets,
    }
    claimed = proof.get("validation_sha256")
    if not isinstance(claimed, str) or PROBE.canonical_sha256(core) != claimed:
        raise ContextualFirstHitError("loader-invariance digest does not bind canonical content")
    counts = proof.get("counts", {})
    if counts.get("needed_identity_soname_pairs") != len(targets):
        raise ContextualFirstHitError("loader-invariance pair count drifted")
    if not isinstance(counts.get("staged_elf_files"), int) or counts["staged_elf_files"] <= 0:
        raise ContextualFirstHitError("loader-invariance staged ELF count is invalid")
    gates = proof.get("gates", {})
    for gate in (
        "full_build_proof_verified",
        "staging_manifest_verified",
        "staged_needed_by_chain_invariance_verified",
        "staged_shortname_reuse_invariance_verified",
    ):
        if gates.get(gate) is not True:
            raise ContextualFirstHitError(f"loader-invariance prerequisite is not proven: {gate}")
    for gate in (
        "external_transitive_closure_verified",
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    ):
        if gates.get(gate) is not False:
            raise ContextualFirstHitError(f"loader-invariance proof crossed forbidden boundary: {gate}")
    return claimed


def invariant_record(proof: dict, elf: dict, consumer_relative: str, soname: str) -> tuple[str, dict]:
    key = pair_key(elf, soname)
    record = proof["needed_targets"].get(key)
    if not isinstance(record, dict):
        raise ContextualFirstHitError(f"loader-invariance proof lacks pair: {key}")
    if record.get("soname") != soname:
        raise ContextualFirstHitError(f"loader-invariance SONAME drifted for pair: {key}")
    expected_elf = {"class": elf["class"], "machine": elf["machine"], "endianness": elf["endianness"]}
    if record.get("elf") != expected_elf:
        raise ContextualFirstHitError(f"loader-invariance ELF identity drifted for pair: {key}")
    consumers = record.get("consumers")
    if not isinstance(consumers, list) or consumer_relative not in consumers:
        raise ContextualFirstHitError(f"consumer is not bound to loader-invariance pair: {consumer_relative}: {key}")
    target = record.get("target")
    if not isinstance(target, dict) or target.get("scope") not in {"stage-internal", "rootfs-external"}:
        raise ContextualFirstHitError(f"invalid loader-invariance target for pair: {key}")
    _safe_relative(target.get("canonical_path"), "loader-invariance canonical path")
    paths = target.get("candidate_paths")
    if not isinstance(paths, list) or not paths:
        raise ContextualFirstHitError(f"loader-invariance target has no candidate paths: {key}")
    for path in paths:
        _safe_relative(path, "loader-invariance candidate path")
    directories = record.get("directories_considered")
    if not isinstance(directories, list):
        raise ContextualFirstHitError(f"loader-invariance directories are missing: {key}")
    return key, record


def _matches_target(scope: str, canonical_path: str, record: dict) -> bool:
    target = record["target"]
    return scope == target["scope"] and canonical_path == target["canonical_path"]


def verify_contextual_target_bytes(stage: Path, rootfs: Path, elf: dict, soname: str, record: dict) -> int:
    """Reopen every modeled needed_by pathname and independently bind the invariant target."""
    expected = PROBE.elf_identity(elf)
    target = record["target"]
    hits = 0

    if record.get("bootstrap_preloaded") is True:
        try:
            bootstrap = PROBE.resolve_bootstrap_shortname(stage, soname, elf)
        except PROBE.RuntimeDependencyError as exc:
            raise ContextualFirstHitError(str(exc)) from exc
        if bootstrap is None or not _matches_target("stage-internal", bootstrap["canonical_path"], record):
            raise ContextualFirstHitError(f"bootstrap target diverged from loader invariance for {soname}")
        hits += 1

    for entry in record["directories_considered"]:
        if not isinstance(entry, dict):
            raise ContextualFirstHitError("invalid loader-invariance directory record")
        directory = entry.get("directory")
        if not isinstance(directory, str) or not directory.startswith("/"):
            raise ContextualFirstHitError(f"invalid loader-invariance directory: {directory!r}")
        relative_dir = _safe_relative(directory[1:], "loader-invariance directory")
        try:
            staged = FIRST.direct_loader_hit(stage, relative_dir, soname)
            external = FIRST.direct_loader_hit(rootfs, relative_dir, soname)
        except (FIRST.FirstHitGuardError, PROBE.RuntimeDependencyError, OSError) as exc:
            raise ContextualFirstHitError(f"invalid contextual pathname for {soname} in {directory}: {exc}") from exc
        if staged is not None and external is not None:
            raise ContextualFirstHitError(f"cross-scope contextual pathname collision for {soname} in {directory}")
        hit = staged if staged is not None else external
        if hit is None:
            continue
        hits += 1
        if hit["elf"] is None:
            raise ContextualFirstHitError(f"non-ELF contextual pathname hit for {soname}: /{hit['path']}")
        actual = PROBE.elf_identity(hit["elf"])
        if actual != expected:
            raise ContextualFirstHitError(
                f"incompatible contextual pathname for {soname}: expected={expected} actual={actual} path=/{hit['path']}"
            )
        scope = "stage-internal" if staged is not None else "rootfs-external"
        if not _matches_target(scope, hit["canonical_path"], record):
            raise ContextualFirstHitError(
                f"contextual pathname target diverges for {soname}: {scope}:/{hit['canonical_path']} "
                f"!= {target['scope']}:/{target['canonical_path']}"
            )
    if hits == 0:
        raise ContextualFirstHitError(f"loader-invariance pair has no reachable pathname bytes: {soname}")
    return hits


def verify(stage: Path, rootfs: Path, full_build_proof: dict, loader_invariance_proof: dict) -> dict:
    contract = load_contract()
    if full_build_proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise ContextualFirstHitError("unexpected full build proof schema")
    if full_build_proof.get("runtime_id") != contract.get("runtime_id"):
        raise ContextualFirstHitError("runtime identity drifted")
    gates = full_build_proof.get("gates", {})
    if gates.get("full_build_proof_passed") is not True or gates.get("staged_install_completed") is not True:
        raise ContextualFirstHitError("contextual first-hit requires a proven staged full build")
    forbidden = (
        "runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized",
        "execution_authorized", "windows_payload_executed", "wine_executed",
    )
    if any(gates.get(key) is not False for key in forbidden):
        raise ContextualFirstHitError("full build proof crossed a forbidden promotion/execution boundary")
    if not stage.is_dir() or not rootfs.is_dir():
        raise ContextualFirstHitError("staged tree or locked rootfs is missing")

    stage_manifest_sha256 = PROBE.verify_stage_binding(stage, full_build_proof)
    invariance_digest = validate_loader_invariance_proof(
        loader_invariance_proof, full_build_proof, stage_manifest_sha256, contract
    )

    dependencies = stage_hits = rootfs_hits = bootstrap_hits = 0
    local_hits = contextual_hits = contextual_pathnames_reopened = 0
    verified_pairs: set[str] = set()
    for path in sorted(stage.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        elf = PROBE.parse_elf_dynamic(path)
        if elf is None:
            continue
        relative = PROBE.safe_relative(stage, path)
        for soname in elf["dt_needed"]:
            dependencies += 1
            key, record = invariant_record(loader_invariance_proof, elf, relative, soname)
            if key not in verified_pairs:
                contextual_pathnames_reopened += verify_contextual_target_bytes(stage, rootfs, elf, soname, record)
                verified_pairs.add(key)
            try:
                bootstrap = PROBE.resolve_bootstrap_shortname(stage, soname, elf, contract)
            except PROBE.RuntimeDependencyError as exc:
                raise ContextualFirstHitError(str(exc)) from exc
            if bootstrap is not None:
                if not _matches_target("stage-internal", bootstrap["canonical_path"], record):
                    raise ContextualFirstHitError(f"bootstrap target diverged from invariant target for {soname}")
                stage_hits += 1
                bootstrap_hits += 1
                continue

            hit, _ = FIRST.resolve_first_pathname_hit(stage, rootfs, soname, elf, relative)
            if hit is not None:
                if not _matches_target(hit["scope"], hit["canonical_path"], record):
                    raise ContextualFirstHitError(f"local first pathname diverged from invariant target for {relative}: {soname}")
                local_hits += 1
                scope = hit["scope"]
            else:
                contextual_hits += 1
                scope = record["target"]["scope"]
            if scope == "stage-internal":
                stage_hits += 1
            else:
                rootfs_hits += 1

    if dependencies == 0:
        raise ContextualFirstHitError("staged Wine tree produced no direct ELF dependencies")
    if dependencies != stage_hits + rootfs_hits:
        raise ContextualFirstHitError("contextual first-hit did not classify every dependency edge")

    counts = {
        "dependencies_checked": dependencies,
        "stage_hits": stage_hits,
        "rootfs_hits": rootfs_hits,
        "bootstrap_shortname_hits": bootstrap_hits,
        "local_first_pathname_hits": local_hits,
        "needed_by_context_hits": contextual_hits,
        "invariant_pairs_reopened": len(verified_pairs),
        "contextual_pathnames_reopened": contextual_pathnames_reopened,
    }
    core = {
        "runtime_id": full_build_proof["runtime_id"],
        "staging_manifest_sha256": stage_manifest_sha256,
        "loader_invariance_validation_sha256": invariance_digest,
        "counts": counts,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "contextual-first-pathname-and-bootstrap-shortname-verified-not-runtime-promoted",
        **core,
        "validation_sha256": PROBE.canonical_sha256(core),
        "gates": {
            "full_build_proof_verified": True,
            "staging_manifest_verified": True,
            "loader_invariance_proof_verified": True,
            "first_pathname_hit_verified": True,
            "needed_by_context_first_hit_verified": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "verify"])
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--loader-invariance-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility contextual runtime dependency first-hit guard: PASS")
        return 0
    if not all((args.stage_dir, args.rootfs, args.full_build_proof, args.loader_invariance_proof, args.out)):
        raise ContextualFirstHitError(
            "verify requires --stage-dir, --rootfs, --full-build-proof, --loader-invariance-proof and --out"
        )
    try:
        full = json.loads(args.full_build_proof.read_text(encoding="utf-8"))
        invariance = json.loads(args.loader_invariance_proof.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContextualFirstHitError(f"cannot load contextual first-hit input: {exc}") from exc
    result = verify(args.stage_dir.resolve(), args.rootfs.resolve(), full, invariance)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility contextual runtime dependency first-hit validation: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ContextualFirstHitError, FIRST.FirstHitGuardError, PROBE.RuntimeDependencyError) as exc:
        print(f"windows-compat-runtime-contextual-first-hit: {exc}", file=sys.stderr)
        raise SystemExit(2)
