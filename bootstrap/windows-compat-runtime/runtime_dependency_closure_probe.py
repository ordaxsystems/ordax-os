#!/usr/bin/env python3
"""Discover the transitive DT_NEEDED closure of staged Wine without execution.

This gate consumes the already-proven direct dependency inventory, then walks
ELF DT_NEEDED edges through staged and locked-rootfs DSOs using the locked Wine
bootstrap shortname state, source-proven dependency-attach Unixlib preloads and
modeled musl loader search semantics. It deliberately does not claim
dlopen/plugin coverage or runtime readiness.
"""

from __future__ import annotations

import argparse
from collections import deque
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-dependency-closure.json"
DIRECT_PROBE_PATH = HERE / "runtime_dependency_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-dependency-closure-proof/1"


class RuntimeDependencyClosureError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeDependencyClosureError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DIRECT = load_module("ordax_windows_compat_runtime_dependency_direct", DIRECT_PROBE_PATH)


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeDependencyClosureError(f"cannot load runtime dependency closure contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-closure/1":
        raise RuntimeDependencyClosureError("unexpected runtime dependency closure schema")
    if value.get("status") != "transitive-dt-needed-discovery-only-not-promotable":
        raise RuntimeDependencyClosureError("runtime dependency closure status drifted")
    inputs = value.get("input", {})
    if inputs.get("unixlib_preload_source_proof_schema") != DIRECT.PRELOAD_RUNTIME.PROOF_SCHEMA:
        raise RuntimeDependencyClosureError("runtime dependency closure preload source schema drifted")
    traversal = value.get("traversal", {})
    if traversal.get("loader") != "musl-needed-by-chain":
        raise RuntimeDependencyClosureError("runtime dependency closure loader model drifted")
    required_true = (
        "source_derived_dependency_attach_preloads_required",
        "inherit_needed_by_dynamic_paths",
        "system_path_after_dynamic_chain",
        "cycle_detection_required",
    )
    if any(traversal.get(key) is not True for key in required_true):
        raise RuntimeDependencyClosureError("runtime dependency closure traversal guarantees drifted")
    required_false = (
        "ambient_ld_library_path_allowed",
        "unresolved_dependency_allowed",
        "cross_scope_collision_allowed",
    )
    if any(traversal.get(key) is not False for key in required_false):
        raise RuntimeDependencyClosureError("runtime dependency closure fail-closed boundary drifted")
    max_depth = traversal.get("max_chain_depth")
    max_states = traversal.get("max_context_states")
    if not isinstance(max_depth, int) or max_depth < 1 or max_depth > 1024:
        raise RuntimeDependencyClosureError("invalid transitive closure depth bound")
    if not isinstance(max_states, int) or max_states < 1 or max_states > 1_000_000:
        raise RuntimeDependencyClosureError("invalid transitive closure state bound")
    classification = value.get("classification", {})
    if classification.get("runtime_dependency_inventory_complete_after_this_gate") is not False:
        raise RuntimeDependencyClosureError("DT_NEEDED closure may not claim complete runtime inventory")
    if classification.get("dynamic_dlopen_inventory") != "out-of-scope-for-this-gate":
        raise RuntimeDependencyClosureError("dynamic-load boundary drifted")
    promotion = value.get("promotion", {})
    if not promotion or any(item is not False for item in promotion.values()):
        raise RuntimeDependencyClosureError("closure contract claims promotion/execution authority")
    DIRECT.load_contract()
    return value


def direct_inventory_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "elf_files": proof.get("elf_files"),
        "external_packages": proof.get("external_packages"),
    }


def verify_input_proofs(
    full_build_proof: dict,
    direct_proof: dict,
    preload_source_proof: dict,
    contract: dict,
) -> str:
    expected_full = contract["input"]["full_build_proof_schema"]
    expected_direct = contract["input"]["direct_dependency_proof_schema"]
    expected_preload = contract["input"]["unixlib_preload_source_proof_schema"]
    if full_build_proof.get("$schema") != expected_full:
        raise RuntimeDependencyClosureError("unexpected full build proof schema")
    if direct_proof.get("$schema") != expected_direct:
        raise RuntimeDependencyClosureError("unexpected direct dependency proof schema")
    if preload_source_proof.get("$schema") != expected_preload:
        raise RuntimeDependencyClosureError("unexpected unixlib preload source proof schema")
    if direct_proof.get("status") != "runtime-dependencies-discovered-not-content-pinned-not-executable":
        raise RuntimeDependencyClosureError("unexpected direct dependency proof status")
    runtime_id = contract.get("runtime_id")
    if full_build_proof.get("runtime_id") != runtime_id or direct_proof.get("runtime_id") != runtime_id:
        raise RuntimeDependencyClosureError("runtime identity drifted across dependency proofs")
    try:
        preload_evidence = DIRECT.PRELOAD_RUNTIME.validate_source_proof(preload_source_proof, runtime_id)
    except DIRECT.PRELOAD_RUNTIME.UnixlibPreloadRuntimeError as exc:
        raise RuntimeDependencyClosureError(str(exc)) from exc
    staging = full_build_proof.get("staging", {})
    stage_digest = staging.get("canonical_manifest_sha256")
    if direct_proof.get("staging_manifest_sha256") != stage_digest:
        raise RuntimeDependencyClosureError("direct dependency proof is not bound to full-build staging")

    full_gates = full_build_proof.get("gates", {})
    if full_gates.get("full_build_proof_passed") is not True or full_gates.get("staged_install_completed") is not True:
        raise RuntimeDependencyClosureError("transitive closure requires a proven staged full build")
    forbidden = (
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    )
    if any(full_gates.get(key) is not False for key in forbidden):
        raise RuntimeDependencyClosureError("full-build proof crossed a forbidden runtime boundary")

    direct_gates = direct_proof.get("gates", {})
    for key in ("full_build_proof_verified", "loader_resolution_verified", "staging_dependency_inventory_complete"):
        if direct_gates.get(key) is not True:
            raise RuntimeDependencyClosureError(f"direct dependency prerequisite is not proven: {key}")
    direct_forbidden = (
        "runtime_dependency_inventory_complete",
        "runtime_package_content_hashes_pinned",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    )
    if any(direct_gates.get(key) is not False for key in direct_forbidden):
        raise RuntimeDependencyClosureError("direct dependency proof crossed a forbidden runtime boundary")

    expected_inventory_digest = DIRECT.canonical_sha256(direct_inventory_core(direct_proof))
    if direct_proof.get("inventory_sha256") != expected_inventory_digest:
        raise RuntimeDependencyClosureError("direct dependency inventory digest does not verify")
    return preload_evidence


def node_key(node: dict) -> str:
    return f"{node['scope']}:{node['canonical_path']}"


def compact_identity(elf: dict) -> dict:
    return {
        "class": elf["class"],
        "machine": elf["machine"],
        "endianness": elf["endianness"],
    }


def node_from_candidate(candidate: dict, stage: Path, rootfs: Path, owners: dict, package_versions: dict) -> dict:
    scope = candidate["scope"]
    root = stage if scope == "stage-internal" else rootfs
    canonical = candidate["canonical_path"]
    elf = DIRECT.parse_elf_dynamic(root / canonical)
    if elf is None:
        raise RuntimeDependencyClosureError(f"resolved dependency is not ELF: {scope}:{canonical}")
    expected_identity = (candidate["class"], candidate["machine"], candidate["endianness"])
    if DIRECT.elf_identity(elf) != expected_identity:
        raise RuntimeDependencyClosureError(f"resolved dependency ELF identity drifted: {scope}:{canonical}")
    node = {
        "scope": scope,
        "path": candidate["path"],
        "canonical_path": canonical,
        "elf": elf,
    }
    if scope == "rootfs-external":
        try:
            package, version = DIRECT.require_single_apk_owner(candidate, owners)
        except DIRECT.RuntimeDependencyError as exc:
            raise RuntimeDependencyClosureError(str(exc)) from exc
        if package_versions.get(package) != version:
            raise RuntimeDependencyClosureError(f"Alpine package version drifted for owner: {package}")
        node["package"] = package
        node["version"] = version
    return node


def dynamic_chain_search_directories(chain: list[dict], rootfs: Path) -> list[dict]:
    """Model musl's needed_by RPATH/RUNPATH chain, then its system path."""
    if not chain:
        raise RuntimeDependencyClosureError("loader chain is empty")
    result: list[dict] = []
    for depth, node in enumerate(chain):
        elf = node["elf"]
        dynamic_value = elf.get("runpath") if elf.get("runpath") is not None else elf.get("rpath")
        tag = "DT_RUNPATH" if elf.get("runpath") is not None else "DT_RPATH"
        if dynamic_value is None:
            continue
        source = tag if depth == 0 else f"{tag}@/{node['path']}"
        try:
            parts = DIRECT.split_path_list(dynamic_value, source)
            for item in parts:
                result.append({
                    "directory": DIRECT.expand_loader_directory(item, node["path"], source),
                    "source": source,
                    "needed_by_depth": depth,
                })
        except DIRECT.RuntimeDependencyError as exc:
            raise RuntimeDependencyClosureError(str(exc)) from exc
    try:
        system = DIRECT.musl_system_search_directories(rootfs, chain[0]["elf"])
    except DIRECT.RuntimeDependencyError as exc:
        raise RuntimeDependencyClosureError(str(exc)) from exc
    for item in system:
        result.append({**item, "needed_by_depth": None})

    deduped: list[dict] = []
    seen: set[str] = set()
    for item in result:
        directory = item["directory"]
        if directory in seen:
            continue
        seen.add(directory)
        deduped.append(item)
    return deduped


def resolve_with_chain(
    stage: Path,
    stage_index: dict,
    rootfs_index: dict,
    soname: str,
    chain: list[dict],
    rootfs: Path,
    preload_source_proof: dict,
) -> tuple[dict | None, list[dict]]:
    current = chain[0]
    search = dynamic_chain_search_directories(chain, rootfs)
    try:
        bootstrap = DIRECT.resolve_bootstrap_shortname(stage, soname, current["elf"])
    except DIRECT.RuntimeDependencyError as exc:
        raise RuntimeDependencyClosureError(str(exc)) from exc
    if bootstrap is not None:
        return {**bootstrap, "needed_by_depth": None}, search
    if current["scope"] == "stage-internal":
        try:
            preload = DIRECT.resolve_dependency_attach_preload(
                stage,
                current["path"],
                soname,
                current["elf"],
                preload_source_proof,
            )
        except DIRECT.RuntimeDependencyError as exc:
            raise RuntimeDependencyClosureError(str(exc)) from exc
        if preload is not None:
            return {**preload, "needed_by_depth": None}, search
    for position, item in enumerate(search):
        directory = item["directory"]
        try:
            staged = DIRECT.candidates_in_directory(stage_index, soname, current["elf"], directory, "stage")
            external = DIRECT.candidates_in_directory(rootfs_index, soname, current["elf"], directory, "rootfs")
        except DIRECT.RuntimeDependencyError as exc:
            raise RuntimeDependencyClosureError(str(exc)) from exc
        if staged is not None and external is not None:
            raise RuntimeDependencyClosureError(
                f"cross-scope loader collision for {soname} at /{directory}: "
                f"stage={staged['candidate_paths']} rootfs={external['candidate_paths']}"
            )
        selected = staged if staged is not None else external
        if selected is not None:
            return {
                **selected,
                "scope": "stage-internal" if staged is not None else "rootfs-external",
                "resolution_kind": "loader-pathname",
                "search_directory": "/" + directory,
                "search_source": item["source"],
                "search_position": position,
                "needed_by_depth": item["needed_by_depth"],
            }, search
    return None, search


def direct_resolution_map(direct_proof: dict, consumer: str) -> tuple[dict, dict]:
    record = direct_proof.get("elf_files", {}).get(consumer)
    if not isinstance(record, dict):
        raise RuntimeDependencyClosureError(f"direct dependency proof is missing staged ELF root: {consumer}")
    resolutions = record.get("resolutions")
    if not isinstance(resolutions, list):
        raise RuntimeDependencyClosureError(f"direct dependency proof has invalid resolutions: {consumer}")
    mapped: dict[str, dict] = {}
    for item in resolutions:
        soname = item.get("soname")
        if not isinstance(soname, str) or soname in mapped:
            raise RuntimeDependencyClosureError(f"direct dependency proof has duplicate/invalid SONAME: {consumer}")
        mapped[soname] = item
    return record, mapped


def compare_direct_root_edge(consumer: str, soname: str, candidate: dict, direct_record: dict, direct_map: dict) -> None:
    expected = direct_map.get(soname)
    if expected is None:
        raise RuntimeDependencyClosureError(f"direct dependency proof omitted root edge: {consumer} -> {soname}")
    fields = (
        "scope",
        "path",
        "canonical_path",
        "resolution_kind",
        "search_directory",
        "search_source",
        "search_position",
    )
    for field in fields:
        if candidate.get(field) != expected.get(field):
            raise RuntimeDependencyClosureError(
                f"direct dependency root edge disagrees on {field}: {consumer} -> {soname}"
            )
    if candidate.get("resolution_kind") == "source-proven-dependency-attach-preload":
        for field in ("unixlib_preload_source_evidence_sha256", "preload_relation"):
            if candidate.get(field) != expected.get(field):
                raise RuntimeDependencyClosureError(
                    f"direct dependency preload root edge disagrees on {field}: {consumer} -> {soname}"
                )
    if candidate["scope"] == "rootfs-external":
        for field in ("package", "version"):
            if candidate.get(field) != expected.get(field):
                raise RuntimeDependencyClosureError(
                    f"direct dependency root edge disagrees on {field}: {consumer} -> {soname}"
                )
    expected_search = direct_record.get("loader_search")
    if not isinstance(expected_search, list):
        raise RuntimeDependencyClosureError(f"direct dependency proof has no loader search trace: {consumer}")


def serialize_node(node: dict, paths: set[str]) -> dict:
    value = {
        "scope": node["scope"],
        "canonical_path": node["canonical_path"],
        "paths": sorted(paths),
        "elf": compact_identity(node["elf"]),
        "rpath": node["elf"].get("rpath"),
        "runpath": node["elf"].get("runpath"),
        "dt_needed": node["elf"].get("dt_needed", []),
    }
    if node["scope"] == "rootfs-external":
        value["package"] = node["package"]
        value["version"] = node["version"]
    return value


def discover(
    stage: Path,
    rootfs: Path,
    full_build_proof: dict,
    direct_proof: dict,
    preload_source_proof: dict,
) -> dict:
    contract = load_contract()
    preload_evidence = verify_input_proofs(full_build_proof, direct_proof, preload_source_proof, contract)
    if not stage.is_dir() or not rootfs.is_dir():
        raise RuntimeDependencyClosureError("staged tree or locked rootfs is missing")
    try:
        stage_digest = DIRECT.verify_stage_binding(stage, full_build_proof)
        stage_index = DIRECT.build_soname_index(stage)
        rootfs_index = DIRECT.build_soname_index(rootfs)
        package_versions, owners = DIRECT.parse_apk_installed(rootfs)
    except DIRECT.RuntimeDependencyError as exc:
        raise RuntimeDependencyClosureError(str(exc)) from exc
    if stage_digest != direct_proof.get("staging_manifest_sha256"):
        raise RuntimeDependencyClosureError("staging changed after direct dependency proof")

    max_depth = contract["traversal"]["max_chain_depth"]
    max_states = contract["traversal"]["max_context_states"]
    roots: list[dict] = []
    for path in sorted(stage.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        try:
            elf = DIRECT.parse_elf_dynamic(path)
        except DIRECT.RuntimeDependencyError as exc:
            raise RuntimeDependencyClosureError(str(exc)) from exc
        if elf is None:
            continue
        relative = DIRECT.safe_relative(stage, path)
        canonical = DIRECT.resolve_rooted_path(stage, path)
        roots.append({
            "scope": "stage-internal",
            "path": relative,
            "canonical_path": canonical,
            "elf": elf,
        })
    if not roots:
        raise RuntimeDependencyClosureError("staged Wine tree contained no ELF roots")

    queue: deque[list[dict]] = deque([[root] for root in roots])
    seen_contexts: set[tuple[str, ...]] = set()
    contexts: dict[str, dict] = {}
    node_records: dict[str, tuple[dict, set[str]]] = {}
    external: dict[str, dict] = {}
    cycle_edges = 0
    unresolved: list[dict] = []

    while queue:
        chain = queue.popleft()
        if len(chain) > max_depth:
            raise RuntimeDependencyClosureError(f"dependency chain exceeded max depth {max_depth}")
        signature = tuple(node_key(item) for item in chain)
        if signature in seen_contexts:
            continue
        seen_contexts.add(signature)
        if len(seen_contexts) > max_states:
            raise RuntimeDependencyClosureError(f"dependency traversal exceeded max states {max_states}")
        context_id = DIRECT.canonical_sha256(signature)
        current = chain[0]
        current_key = node_key(current)
        existing = node_records.get(current_key)
        if existing is None:
            node_records[current_key] = (current, {current["path"]})
        else:
            previous, paths = existing
            if compact_identity(previous["elf"]) != compact_identity(current["elf"]):
                raise RuntimeDependencyClosureError(f"node identity conflict: {current_key}")
            if previous.get("package") != current.get("package") or previous.get("version") != current.get("version"):
                raise RuntimeDependencyClosureError(f"node package identity conflict: {current_key}")
            paths.add(current["path"])

        root_context = len(chain) == 1 and current["scope"] == "stage-internal"
        direct_record = direct_map = None
        if root_context:
            direct_record, direct_map = direct_resolution_map(direct_proof, current["path"])
            if direct_record.get("dt_needed") != current["elf"].get("dt_needed"):
                raise RuntimeDependencyClosureError(f"direct dependency DT_NEEDED drifted: {current['path']}")
            if direct_record.get("elf") != compact_identity(current["elf"]):
                raise RuntimeDependencyClosureError(f"direct dependency ELF identity drifted: {current['path']}")

        search_trace = dynamic_chain_search_directories(chain, rootfs) if current["elf"]["dt_needed"] else []
        edges: list[dict] = []
        for soname in current["elf"]["dt_needed"]:
            candidate, search = resolve_with_chain(
                stage,
                stage_index,
                rootfs_index,
                soname,
                chain,
                rootfs,
                preload_source_proof,
            )
            if candidate is None:
                unresolved.append({
                    "context": context_id,
                    "consumer": current_key,
                    "soname": soname,
                    "loader_search": search,
                })
                continue
            child = node_from_candidate(candidate, stage, rootfs, owners, package_versions)
            edge = {
                "soname": soname,
                "to": node_key(child),
                "scope": candidate["scope"],
                "path": candidate["path"],
                "canonical_path": candidate["canonical_path"],
                "resolution_kind": candidate["resolution_kind"],
                "search_directory": candidate["search_directory"],
                "search_source": candidate["search_source"],
                "search_position": candidate["search_position"],
                "needed_by_depth": candidate["needed_by_depth"],
            }
            if candidate["resolution_kind"] == "source-proven-dependency-attach-preload":
                if candidate.get("unixlib_preload_source_evidence_sha256") != preload_evidence:
                    raise RuntimeDependencyClosureError("resolved preload edge is not bound to supplied source evidence")
                edge["unixlib_preload_source_evidence_sha256"] = candidate[
                    "unixlib_preload_source_evidence_sha256"
                ]
                edge["preload_relation"] = candidate["preload_relation"]
            if child["scope"] == "rootfs-external":
                edge["package"] = child["package"]
                edge["version"] = child["version"]
                record = external.setdefault(
                    child["package"], {"version": child["version"], "files": {}, "sonames": set()}
                )
                if record["version"] != child["version"]:
                    raise RuntimeDependencyClosureError(
                        f"external runtime package version conflict: {child['package']}"
                    )
                record["files"][child["path"]] = soname
                record["sonames"].add(soname)
            if root_context:
                compare_direct_root_edge(current["path"], soname, edge, direct_record, direct_map)
            child_key = node_key(child)
            chain_keys = {node_key(item) for item in chain}
            if child_key in chain_keys:
                edge["cycle"] = True
                cycle_edges += 1
            else:
                edge["cycle"] = False
                queue.append([child, *chain])
            edges.append(edge)

        if root_context:
            expected_search = direct_record.get("loader_search")
            normalized = [
                {"directory": item["directory"], "source": item["source"]}
                for item in search_trace
            ]
            if normalized != expected_search:
                raise RuntimeDependencyClosureError(
                    f"direct dependency loader search trace drifted: {current['path']}"
                )
            if set(direct_map) != set(current["elf"]["dt_needed"]):
                raise RuntimeDependencyClosureError(
                    f"direct dependency root resolution set drifted: {current['path']}"
                )

        contexts[context_id] = {
            "consumer": current_key,
            "chain": [node_key(item) for item in chain],
            "loader_search": search_trace,
            "edges": edges,
        }

    if unresolved:
        raise RuntimeDependencyClosureError(f"unresolved transitive ELF dependencies: {unresolved[:20]}")
    if not external:
        raise RuntimeDependencyClosureError("transitive closure produced no external runtime packages")

    nodes_json = {
        key: serialize_node(node, paths)
        for key, (node, paths) in sorted(node_records.items())
    }
    external_json = {
        package: {
            "version": value["version"],
            "files": dict(sorted(value["files"].items())),
            "sonames": sorted(value["sonames"]),
        }
        for package, value in sorted(external.items())
    }
    core = {
        "runtime_id": full_build_proof["runtime_id"],
        "staging_manifest_sha256": stage_digest,
        "direct_inventory_sha256": direct_proof["inventory_sha256"],
        "roots": [node_key(item) for item in roots],
        "nodes": nodes_json,
        "contexts": dict(sorted(contexts.items())),
        "external_packages": external_json,
    }
    edge_count = sum(len(value["edges"]) for value in contexts.values())
    return {
        "$schema": PROOF_SCHEMA,
        "status": "transitive-dt-needed-closure-discovered-not-runtime-complete-not-executable",
        **core,
        "closure_sha256": DIRECT.canonical_sha256(core),
        "counts": {
            "root_elf_files": len(roots),
            "nodes": len(nodes_json),
            "context_states": len(contexts),
            "edges": edge_count,
            "cycle_edges": cycle_edges,
            "external_packages": len(external_json),
            "external_sonames": len({s for value in external_json.values() for s in value["sonames"]}),
        },
        "gates": {
            "full_build_proof_verified": True,
            "direct_dependency_proof_verified": True,
            "direct_loader_resolution_verified": True,
            "transitive_dt_needed_closure_complete": True,
            "dynamic_load_inventory_complete": False,
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
    parser.add_argument("--direct-dependency-proof", type=Path)
    parser.add_argument("--unixlib-preload-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility runtime dependency transitive closure contract: PASS")
        return 0
    required = (
        args.stage_dir,
        args.rootfs,
        args.full_build_proof,
        args.direct_dependency_proof,
        args.unixlib_preload_source_proof,
        args.out,
    )
    if not all(required):
        raise RuntimeDependencyClosureError(
            "discover requires --stage-dir, --rootfs, --full-build-proof, --direct-dependency-proof, "
            "--unixlib-preload-source-proof and --out"
        )
    try:
        full = json.loads(args.full_build_proof.read_text(encoding="utf-8"))
        direct = json.loads(args.direct_dependency_proof.read_text(encoding="utf-8"))
        preload = json.loads(args.unixlib_preload_source_proof.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeDependencyClosureError(f"cannot load dependency proof input: {exc}") from exc
    result = discover(args.stage_dir.resolve(), args.rootfs.resolve(), full, direct, preload)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeDependencyClosureError as exc:
        print(f"windows-compat-runtime-dependency-closure: {exc}", file=sys.stderr)
        raise SystemExit(2)
