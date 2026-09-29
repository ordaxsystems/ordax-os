#!/usr/bin/env python3
"""Discover staged Wine DT_NEEDED dependencies with proven needed_by context.

This probe preserves strict local RUNPATH/RPATH first-hit resolution whenever a
consumer has one. If the isolated consumer search has no pathname, it may use
only the exact target already proven invariant for the same ELF identity +
SONAME across all modeled musl needed_by paths. The inventory is therefore
bound to the loader-invariance digest instead of inventing a parent/root ELF.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PROBE_PATH = HERE / "runtime_dependency_probe.py"
CONTEXT_PATH = HERE / "runtime_dependency_contextual_first_hit_guard.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-contextual-dependency-proof/1"
CONTEXT_SOURCE = "musl-needed-by-loader-invariance"


class ContextualDependencyError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ContextualDependencyError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PROBE = load_module("ordax_runtime_dependency_probe_for_contextual_inventory", PROBE_PATH)
CONTEXT = load_module("ordax_contextual_first_hit_for_contextual_inventory", CONTEXT_PATH)


def load_contract() -> dict:
    contract = PROBE.load_contract()
    inspection = contract.get("inspection", {})
    if inspection.get("contextual_dependency_inventory_requires_loader_invariance") is not True:
        raise ContextualDependencyError("runtime dependency contract does not require contextual invariant inventory")
    if inspection.get("unresolved_dependency_allowed") is not False:
        raise ContextualDependencyError("contextual dependency inventory must remain fail-closed")
    return contract


def _target_candidate(record: dict) -> dict:
    target = record["target"]
    paths = target["candidate_paths"]
    return {
        "path": paths[0],
        "candidate_paths": paths,
        "canonical_path": target["canonical_path"],
        "scope": target["scope"],
        "resolution_kind": "loader-invariant-needed-by-context",
        "search_directory": None,
        "search_source": CONTEXT_SOURCE,
        "search_position": None,
    }


def _same_target(candidate: dict, record: dict) -> bool:
    target = record["target"]
    return candidate["scope"] == target["scope"] and candidate["canonical_path"] == target["canonical_path"]


def discover(stage: Path, rootfs: Path, full_build_proof: dict, loader_invariance_proof: dict) -> dict:
    contract = load_contract()
    if full_build_proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise ContextualDependencyError("unexpected full build proof schema")
    if full_build_proof.get("runtime_id") != contract.get("runtime_id"):
        raise ContextualDependencyError("runtime identity drifted")
    gates = full_build_proof.get("gates", {})
    if gates.get("full_build_proof_passed") is not True or gates.get("staged_install_completed") is not True:
        raise ContextualDependencyError("contextual dependency discovery requires a proven staged full build")
    forbidden = (
        "runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized",
        "execution_authorized", "windows_payload_executed", "wine_executed",
    )
    if any(gates.get(key) is not False for key in forbidden):
        raise ContextualDependencyError("full build proof crossed a forbidden promotion/execution boundary")
    if not stage.is_dir() or not rootfs.is_dir():
        raise ContextualDependencyError("staged tree or locked rootfs is missing")

    stage_manifest_sha256 = PROBE.verify_stage_binding(stage, full_build_proof)
    invariance_digest = CONTEXT.validate_loader_invariance_proof(
        loader_invariance_proof, full_build_proof, stage_manifest_sha256, contract
    )
    stage_index = PROBE.build_soname_index(stage)
    rootfs_index = PROBE.build_soname_index(rootfs)
    package_versions, owners = PROBE.parse_apk_installed(rootfs)
    elf_files: dict[str, dict] = {}
    external: dict[str, dict] = {}
    contextual_edges = local_edges = bootstrap_edges = 0

    for path in sorted(stage.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        elf = PROBE.parse_elf_dynamic(path)
        if elf is None:
            continue
        needed = elf["dt_needed"]
        relative = PROBE.safe_relative(stage, path)
        resolutions = []
        local_search = PROBE.loader_search_directories(relative, elf, rootfs) if needed else []
        for soname in needed:
            key, record = CONTEXT.invariant_record(loader_invariance_proof, elf, relative, soname)
            candidate, search = PROBE.resolve_loader_dependency(
                stage_index,
                rootfs_index,
                soname,
                elf,
                relative,
                rootfs,
                stage=stage,
                contract=contract,
            )
            if candidate is None:
                candidate = _target_candidate(record)
                contextual_edges += 1
            else:
                if not _same_target(candidate, record):
                    raise ContextualDependencyError(
                        f"local dependency target diverges from loader invariance: {relative}: {soname}"
                    )
                if candidate["resolution_kind"] == "bootstrap-shortname-reuse":
                    bootstrap_edges += 1
                else:
                    local_edges += 1

            resolution = {
                "soname": soname,
                "scope": candidate["scope"],
                "path": candidate["path"],
                "candidate_paths": list(candidate.get("candidate_paths", [candidate["path"]])),
                "canonical_path": candidate["canonical_path"],
                "resolution_kind": candidate["resolution_kind"],
                "search_directory": candidate["search_directory"],
                "search_source": candidate["search_source"],
                "search_position": candidate["search_position"],
                "loader_invariance_pair": key,
                "directories_considered": record["directories_considered"],
            }
            if candidate["scope"] == "rootfs-external":
                try:
                    package, version = PROBE.require_single_apk_owner(candidate, owners)
                except PROBE.RuntimeDependencyError as exc:
                    raise ContextualDependencyError(str(exc)) from exc
                if package_versions.get(package) != version:
                    raise ContextualDependencyError(f"Alpine package version drifted for owner: {package}")
                resolution["package"] = package
                resolution["version"] = version
                package_record = external.setdefault(package, {"version": version, "files": {}, "sonames": set()})
                if package_record["version"] != version:
                    raise ContextualDependencyError(f"external runtime package version conflict: {package}")
                for candidate_path in candidate.get("candidate_paths", [candidate["path"]]):
                    package_record["files"][candidate_path] = soname
                package_record["sonames"].add(soname)
            resolutions.append(resolution)
        elf_files[relative] = {
            "elf": {"class": elf["class"], "machine": elf["machine"], "endianness": elf["endianness"]},
            "rpath": elf["rpath"],
            "runpath": elf["runpath"],
            "local_loader_search": local_search,
            "dt_needed": needed,
            "resolutions": resolutions,
        }

    if not elf_files:
        raise ContextualDependencyError("staged Wine tree contained no ELF files")
    if not external:
        raise ContextualDependencyError("staged Wine tree produced no external runtime dependencies")

    external_json = {
        name: {
            "version": value["version"],
            "files": dict(sorted(value["files"].items())),
            "sonames": sorted(value["sonames"]),
        }
        for name, value in sorted(external.items())
    }
    inventory_core = {
        "runtime_id": full_build_proof["runtime_id"],
        "staging_manifest_sha256": stage_manifest_sha256,
        "loader_invariance_validation_sha256": invariance_digest,
        "elf_files": elf_files,
        "external_packages": external_json,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "contextual-runtime-dependencies-discovered-not-content-pinned-not-executable",
        **inventory_core,
        "inventory_sha256": PROBE.canonical_sha256(inventory_core),
        "counts": {
            "elf_files": len(elf_files),
            "external_packages": len(external_json),
            "external_sonames": len({soname for item in external_json.values() for soname in item["sonames"]}),
            "local_loader_edges": local_edges,
            "bootstrap_shortname_edges": bootstrap_edges,
            "needed_by_context_edges": contextual_edges,
        },
        "gates": {
            "full_build_proof_verified": True,
            "loader_invariance_proof_verified": True,
            "loader_resolution_verified": True,
            "needed_by_context_resolution_verified": True,
            "staging_dependency_inventory_complete": True,
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
    parser.add_argument("command", choices=["check", "discover"])
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--loader-invariance-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility contextual runtime dependency discovery contract: PASS")
        return 0
    if not all((args.stage_dir, args.rootfs, args.full_build_proof, args.loader_invariance_proof, args.out)):
        raise ContextualDependencyError(
            "discover requires --stage-dir, --rootfs, --full-build-proof, --loader-invariance-proof and --out"
        )
    try:
        full = json.loads(args.full_build_proof.read_text(encoding="utf-8"))
        invariance = json.loads(args.loader_invariance_proof.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContextualDependencyError(f"cannot load contextual dependency input: {exc}") from exc
    result = discover(args.stage_dir.resolve(), args.rootfs.resolve(), full, invariance)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility contextual runtime dependency discovery: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ContextualDependencyError, CONTEXT.ContextualFirstHitError, PROBE.RuntimeDependencyError) as exc:
        print(f"windows-compat-runtime-contextual-dependency: {exc}", file=sys.stderr)
        raise SystemExit(2)
