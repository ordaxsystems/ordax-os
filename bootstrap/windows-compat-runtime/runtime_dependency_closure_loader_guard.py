#!/usr/bin/env python3
"""Validate raw transitive DT_NEEDED closure against actual loader state.

The raw closure probe is intentionally candidate-producing. This guard makes it
authoritative for DT_NEEDED traversal only by independently checking every
context against staged/rootfs bytes. It models the locked Wine bootstrap
shortname state, source-proven dependency-attach Unixlib preloads and strict
musl first-pathname semantics, then proves that a SONAME + ELF identity has one
logical target across all reachable contexts. Dynamic dlopen/plugin discovery
remains out of scope.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-dependency-closure.json"
DIRECT_PATH = HERE / "runtime_dependency_probe.py"
FIRST_PATH = HERE / "runtime_dependency_first_hit_guard.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-closure-loader-guard-proof/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ClosureLoaderGuardError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ClosureLoaderGuardError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DIRECT = load_module("ordax_windows_compat_runtime_dependency_direct_for_closure_guard", DIRECT_PATH)
FIRST = load_module("ordax_windows_compat_runtime_first_hit_for_closure_guard", FIRST_PATH)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ClosureLoaderGuardError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ClosureLoaderGuardError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "runtime dependency closure contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-closure/1":
        raise ClosureLoaderGuardError("unexpected runtime dependency closure schema")
    if contract.get("status") != "transitive-dt-needed-discovery-only-not-promotable":
        raise ClosureLoaderGuardError("runtime dependency closure status drifted")
    if contract.get("input", {}).get("unixlib_preload_source_proof_schema") != DIRECT.PRELOAD_RUNTIME.PROOF_SCHEMA:
        raise ClosureLoaderGuardError("closure preload source schema drifted")
    verification = contract.get("verification", {})
    required_true = (
        "first_existing_pathname_must_be_loadable",
        "preload_source_evidence_binding_required",
        "global_shortname_target_invariance_required",
        "origin_alias_context_must_be_unambiguous",
        "closure_guard_proof_required",
        "closure_evidence_finalizer_required",
    )
    if any(verification.get(key) is not True for key in required_true):
        raise ClosureLoaderGuardError("closure verification guarantees drifted")
    if verification.get("raw_closure_is_authoritative") is not False:
        raise ClosureLoaderGuardError("raw closure may not be authoritative")
    if verification.get("incompatible_first_pathname_may_be_skipped") is not False:
        raise ClosureLoaderGuardError("closure may not skip incompatible first pathnames")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise ClosureLoaderGuardError("closure contract claims promotion/execution authority")
    DIRECT.load_contract()
    return contract


def require_digest(value: object, label: str) -> str:
    if not isinstance(value, str) or not SHA256_RE.fullmatch(value):
        raise ClosureLoaderGuardError(f"invalid {label}")
    return value


def direct_inventory_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "staging_manifest_sha256": proof.get("staging_manifest_sha256"),
        "elf_files": proof.get("elf_files"),
        "external_packages": proof.get("external_packages"),
    }


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


def verify_inputs(full: dict, direct: dict, evidence: dict, closure: dict, contract: dict) -> tuple[str, str, str]:
    schemas = contract.get("input", {})
    expected = (
        (full, schemas.get("full_build_proof_schema"), "full build"),
        (direct, schemas.get("direct_dependency_proof_schema"), "direct dependency"),
        (evidence, schemas.get("direct_dependency_evidence_proof_schema"), "direct dependency evidence"),
    )
    for proof, schema, label in expected:
        if proof.get("$schema") != schema:
            raise ClosureLoaderGuardError(f"unexpected {label} proof schema")
    if closure.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-closure-proof/1":
        raise ClosureLoaderGuardError("unexpected raw closure proof schema")
    runtime_id = contract.get("runtime_id")
    if any(item.get("runtime_id") != runtime_id for item in (full, direct, evidence, closure)):
        raise ClosureLoaderGuardError("runtime identity drifted across closure evidence")
    stage_digest = require_digest(full.get("staging", {}).get("canonical_manifest_sha256"), "staging manifest digest")
    if any(item.get("staging_manifest_sha256") != stage_digest for item in (direct, evidence, closure)):
        raise ClosureLoaderGuardError("staging manifest drifted across closure evidence")

    direct_digest = require_digest(direct.get("inventory_sha256"), "direct inventory digest")
    if DIRECT.canonical_sha256(direct_inventory_core(direct)) != direct_digest:
        raise ClosureLoaderGuardError("direct dependency inventory digest does not verify")
    if evidence.get("dependency_inventory_sha256") != direct_digest:
        raise ClosureLoaderGuardError("direct authoritative evidence is not bound to dependency inventory")
    evidence_digest = require_digest(evidence.get("evidence_sha256"), "direct evidence digest")
    if DIRECT.canonical_sha256(direct_evidence_core(evidence)) != evidence_digest:
        raise ClosureLoaderGuardError("direct dependency evidence digest does not verify")
    evidence_gates = evidence.get("gates", {})
    for key in (
        "full_build_proof_verified",
        "first_pathname_hit_verified",
        "staged_needed_by_chain_invariance_verified",
        "staged_shortname_reuse_invariance_verified",
        "loader_resolution_verified",
        "staging_dependency_inventory_complete",
    ):
        if evidence_gates.get(key) is not True:
            raise ClosureLoaderGuardError(f"direct authoritative evidence prerequisite is not proven: {key}")
    if evidence_gates.get("runtime_dependency_inventory_complete") is not False:
        raise ClosureLoaderGuardError("direct evidence overclaims runtime dependency completeness")

    closure_digest = require_digest(closure.get("closure_sha256"), "raw closure digest")
    if DIRECT.canonical_sha256(closure_core(closure)) != closure_digest:
        raise ClosureLoaderGuardError("raw closure digest does not verify")
    if closure.get("direct_inventory_sha256") != direct_digest:
        raise ClosureLoaderGuardError("raw closure is not bound to direct dependency inventory")
    closure_gates = closure.get("gates", {})
    if closure_gates.get("transitive_dt_needed_closure_complete") is not True:
        raise ClosureLoaderGuardError("raw transitive closure did not complete")
    if closure_gates.get("dynamic_load_inventory_complete") is not False:
        raise ClosureLoaderGuardError("raw closure overclaims dynamic-load inventory")
    if closure_gates.get("runtime_dependency_inventory_complete") is not False:
        raise ClosureLoaderGuardError("raw closure overclaims runtime dependency completeness")
    return stage_digest, direct_digest, closure_digest


def _parse_node_key(key: str) -> tuple[str, str]:
    if key.startswith("stage-internal:"):
        return "stage-internal", key.removeprefix("stage-internal:")
    if key.startswith("rootfs-external:"):
        return "rootfs-external", key.removeprefix("rootfs-external:")
    raise ClosureLoaderGuardError(f"invalid closure node key: {key}")


def _has_origin_path(elf: dict) -> bool:
    value = elf.get("runpath") if elf.get("runpath") is not None else elf.get("rpath")
    return isinstance(value, str) and ("$ORIGIN" in value or "${ORIGIN}" in value)


def _origin_search_signature(elf: dict, alias: str) -> tuple[str, ...]:
    value = elf.get("runpath") if elf.get("runpath") is not None else elf.get("rpath")
    if value is None:
        return ()
    label = "DT_RUNPATH" if elf.get("runpath") is not None else "DT_RPATH"
    try:
        return tuple(
            DIRECT.expand_loader_directory(item, alias, label)
            for item in DIRECT.split_path_list(value, label)
        )
    except DIRECT.RuntimeDependencyError as exc:
        raise ClosureLoaderGuardError(str(exc)) from exc


def materialize_node(key: str, record: dict, stage: Path, rootfs: Path, owners: dict, versions: dict) -> dict:
    scope, canonical_from_key = _parse_node_key(key)
    if not isinstance(record, dict) or record.get("scope") != scope:
        raise ClosureLoaderGuardError(f"closure node scope mismatch: {key}")
    canonical = record.get("canonical_path")
    if canonical != canonical_from_key or not isinstance(canonical, str) or not canonical:
        raise ClosureLoaderGuardError(f"closure node canonical path mismatch: {key}")
    paths = record.get("paths")
    if not isinstance(paths, list) or not paths or any(not isinstance(item, str) or not item for item in paths):
        raise ClosureLoaderGuardError(f"closure node paths are invalid: {key}")
    if len(paths) != len(set(paths)):
        raise ClosureLoaderGuardError(f"closure node paths contain duplicates: {key}")
    root = stage if scope == "stage-internal" else rootfs
    try:
        elf = DIRECT.parse_elf_dynamic(root / canonical)
    except (DIRECT.RuntimeDependencyError, OSError) as exc:
        raise ClosureLoaderGuardError(f"cannot parse closure node {key}: {exc}") from exc
    if elf is None:
        raise ClosureLoaderGuardError(f"closure node is not ELF: {key}")
    expected_identity = record.get("elf")
    actual_identity = {"class": elf["class"], "machine": elf["machine"], "endianness": elf["endianness"]}
    if expected_identity != actual_identity:
        raise ClosureLoaderGuardError(f"closure node ELF identity drifted: {key}")
    for field in ("rpath", "runpath", "dt_needed"):
        if record.get(field) != elf.get(field):
            raise ClosureLoaderGuardError(f"closure node {field} drifted: {key}")
    for alias in paths:
        candidate = root / alias
        try:
            resolved = DIRECT.resolve_rooted_path(root, candidate)
        except (DIRECT.RuntimeDependencyError, OSError) as exc:
            raise ClosureLoaderGuardError(f"closure node alias is invalid {key}:{alias}: {exc}") from exc
        if resolved != canonical:
            raise ClosureLoaderGuardError(f"closure node alias does not resolve to canonical target: {key}:{alias}")
    if _has_origin_path(elf):
        origin_signatures = {_origin_search_signature(elf, alias) for alias in paths}
        if len(origin_signatures) != 1:
            raise ClosureLoaderGuardError(f"ambiguous $ORIGIN alias context for closure node: {key}")
    node = {"scope": scope, "canonical_path": canonical, "path": paths[0], "elf": elf}
    if scope == "rootfs-external":
        package = record.get("package")
        version = record.get("version")
        if not isinstance(package, str) or not package or not isinstance(version, str) or not version:
            raise ClosureLoaderGuardError(f"external closure node lacks package identity: {key}")
        identities = {owners.get(alias) for alias in [*paths, canonical]}
        if None in identities or identities != {(package, version)}:
            raise ClosureLoaderGuardError(f"external closure node Alpine ownership drifted: {key}")
        if versions.get(package) != version:
            raise ClosureLoaderGuardError(f"external closure node package version drifted: {key}")
        node["package"] = package
        node["version"] = version
    return node


def recompute_search(chain: list[dict], rootfs: Path) -> list[dict]:
    result: list[dict] = []
    for depth, node in enumerate(chain):
        elf = node["elf"]
        value = elf.get("runpath") if elf.get("runpath") is not None else elf.get("rpath")
        tag = "DT_RUNPATH" if elf.get("runpath") is not None else "DT_RPATH"
        if value is None:
            continue
        source = tag if depth == 0 else f"{tag}@/{node['path']}"
        try:
            for item in DIRECT.split_path_list(value, source):
                result.append({
                    "directory": DIRECT.expand_loader_directory(item, node["path"], source),
                    "source": source,
                    "needed_by_depth": depth,
                })
        except DIRECT.RuntimeDependencyError as exc:
            raise ClosureLoaderGuardError(str(exc)) from exc
    try:
        system = DIRECT.musl_system_search_directories(rootfs, chain[0]["elf"])
    except DIRECT.RuntimeDependencyError as exc:
        raise ClosureLoaderGuardError(str(exc)) from exc
    for item in system:
        result.append({**item, "needed_by_depth": None})
    deduped: list[dict] = []
    seen: set[str] = set()
    for item in result:
        if item["directory"] in seen:
            continue
        seen.add(item["directory"])
        deduped.append(item)
    return deduped


def first_pathname_if_any(stage: Path, rootfs: Path, soname: str, consumer: dict, search: list[dict]) -> dict | None:
    expected_identity = DIRECT.elf_identity(consumer["elf"])
    for position, item in enumerate(search):
        directory = item["directory"]
        try:
            staged = FIRST.direct_loader_hit(stage, directory, soname)
            external = FIRST.direct_loader_hit(rootfs, directory, soname)
        except (FIRST.FirstHitGuardError, DIRECT.RuntimeDependencyError, OSError) as exc:
            raise ClosureLoaderGuardError(f"invalid first pathname for {soname}: {exc}") from exc
        if staged is not None and external is not None:
            raise ClosureLoaderGuardError(f"cross-scope first pathname collision for {soname} at /{directory}")
        hit = staged if staged is not None else external
        if hit is None:
            continue
        if hit["elf"] is None:
            raise ClosureLoaderGuardError(f"non-ELF first pathname hit for {soname} at /{hit['path']}")
        actual_identity = DIRECT.elf_identity(hit["elf"])
        if actual_identity != expected_identity:
            raise ClosureLoaderGuardError(
                f"incompatible first pathname hit for {soname}: expected={expected_identity} actual={actual_identity} path=/{hit['path']}"
            )
        return {
            **hit,
            "scope": "stage-internal" if staged is not None else "rootfs-external",
            "resolution_kind": "loader-pathname",
            "search_directory": "/" + directory,
            "search_source": item["source"],
            "search_position": position,
            "needed_by_depth": item.get("needed_by_depth"),
        }
    return None


def first_hit(
    stage: Path,
    rootfs: Path,
    soname: str,
    consumer: dict,
    search: list[dict],
    preload_source_proof: dict,
) -> dict:
    try:
        bootstrap = DIRECT.resolve_bootstrap_shortname(stage, soname, consumer["elf"])
    except DIRECT.RuntimeDependencyError as exc:
        raise ClosureLoaderGuardError(str(exc)) from exc
    if bootstrap is not None:
        pathname = first_pathname_if_any(stage, rootfs, soname, consumer, search)
        target = ("stage-internal", bootstrap["canonical_path"])
        if pathname is not None and (pathname["scope"], pathname["canonical_path"]) != target:
            raise ClosureLoaderGuardError(
                f"bootstrap shortname target conflicts with reachable pathname for {soname}: "
                f"bootstrap=stage-internal:/{bootstrap['canonical_path']} "
                f"pathname={pathname['scope']}:/{pathname['canonical_path']}"
            )
        return {**bootstrap, "needed_by_depth": None}
    if consumer["scope"] == "stage-internal":
        try:
            preload = DIRECT.resolve_dependency_attach_preload(
                stage,
                consumer["path"],
                soname,
                consumer["elf"],
                preload_source_proof,
            )
        except DIRECT.RuntimeDependencyError as exc:
            raise ClosureLoaderGuardError(str(exc)) from exc
        if preload is not None:
            return {**preload, "needed_by_depth": None}
    pathname = first_pathname_if_any(stage, rootfs, soname, consumer, search)
    if pathname is None:
        raise ClosureLoaderGuardError(f"no first pathname hit for {soname}")
    return pathname


def verify(
    stage: Path,
    rootfs: Path,
    full: dict,
    direct: dict,
    evidence: dict,
    closure: dict,
    preload_source_proof: dict,
) -> dict:
    contract = load_contract()
    stage_digest, direct_digest, closure_digest = verify_inputs(full, direct, evidence, closure, contract)
    try:
        preload_evidence = DIRECT.PRELOAD_RUNTIME.validate_source_proof(
            preload_source_proof,
            contract["runtime_id"],
        )
    except DIRECT.PRELOAD_RUNTIME.UnixlibPreloadRuntimeError as exc:
        raise ClosureLoaderGuardError(str(exc)) from exc
    if not stage.is_dir() or not rootfs.is_dir():
        raise ClosureLoaderGuardError("staged tree or locked rootfs is missing")
    try:
        actual_stage = DIRECT.verify_stage_binding(stage, full)
        versions, owners = DIRECT.parse_apk_installed(rootfs)
    except DIRECT.RuntimeDependencyError as exc:
        raise ClosureLoaderGuardError(str(exc)) from exc
    if actual_stage != stage_digest:
        raise ClosureLoaderGuardError("staging changed after closure proof")

    nodes_raw = closure.get("nodes")
    contexts = closure.get("contexts")
    roots = closure.get("roots")
    if not isinstance(nodes_raw, dict) or not nodes_raw:
        raise ClosureLoaderGuardError("raw closure node map is missing")
    if not isinstance(contexts, dict) or not contexts:
        raise ClosureLoaderGuardError("raw closure context map is missing")
    if not isinstance(roots, list) or not roots:
        raise ClosureLoaderGuardError("raw closure root list is missing")
    nodes = {key: materialize_node(key, value, stage, rootfs, owners, versions) for key, value in nodes_raw.items()}
    if any(root not in nodes or not root.startswith("stage-internal:") for root in roots):
        raise ClosureLoaderGuardError("raw closure roots are invalid")

    target_sets: dict[str, set[tuple[str, str]]] = {}
    edges_checked = 0
    external_hits = 0
    stage_hits = 0
    dependency_attach_preload_hits = 0
    for context_id, context in contexts.items():
        if not isinstance(context_id, str) or not SHA256_RE.fullmatch(context_id) or not isinstance(context, dict):
            raise ClosureLoaderGuardError("invalid raw closure context entry")
        chain_keys = context.get("chain")
        consumer_key = context.get("consumer")
        edges = context.get("edges")
        if not isinstance(chain_keys, list) or not chain_keys or consumer_key != chain_keys[0]:
            raise ClosureLoaderGuardError(f"invalid closure chain: {context_id}")
        if any(key not in nodes for key in chain_keys):
            raise ClosureLoaderGuardError(f"closure chain references unknown node: {context_id}")
        if len(chain_keys) != len(set(chain_keys)):
            raise ClosureLoaderGuardError(f"closure chain contains a cycle instead of a bounded cycle edge: {context_id}")
        chain = [nodes[key] for key in chain_keys]
        expected_context_id = DIRECT.canonical_sha256(tuple(chain_keys))
        if context_id != expected_context_id:
            raise ClosureLoaderGuardError(f"closure context id does not bind its chain: {context_id}")
        search = recompute_search(chain, rootfs) if chain[0]["elf"].get("dt_needed") else []
        if context.get("loader_search") != search:
            raise ClosureLoaderGuardError(f"closure loader search trace drifted: {context_id}")
        if not isinstance(edges, list):
            raise ClosureLoaderGuardError(f"closure context edges are invalid: {context_id}")
        edge_map: dict[str, dict] = {}
        for edge in edges:
            if not isinstance(edge, dict) or not isinstance(edge.get("soname"), str) or edge["soname"] in edge_map:
                raise ClosureLoaderGuardError(f"closure context has duplicate/invalid edge: {context_id}")
            edge_map[edge["soname"]] = edge
        needed = chain[0]["elf"].get("dt_needed", [])
        if set(edge_map) != set(needed) or len(edge_map) != len(needed):
            raise ClosureLoaderGuardError(f"closure edge set does not match DT_NEEDED: {context_id}")
        for soname in needed:
            edge = edge_map[soname]
            hit = first_hit(stage, rootfs, soname, chain[0], search, preload_source_proof)
            expected_fields = {
                "scope": hit["scope"],
                "path": hit["path"],
                "canonical_path": hit["canonical_path"],
                "resolution_kind": hit["resolution_kind"],
                "search_directory": hit["search_directory"],
                "search_source": hit["search_source"],
                "search_position": hit["search_position"],
                "needed_by_depth": hit["needed_by_depth"],
            }
            if hit["resolution_kind"] == "source-proven-dependency-attach-preload":
                if hit.get("unixlib_preload_source_evidence_sha256") != preload_evidence:
                    raise ClosureLoaderGuardError("resolved preload hit is not bound to supplied source evidence")
                expected_fields["unixlib_preload_source_evidence_sha256"] = preload_evidence
                expected_fields["preload_relation"] = hit["preload_relation"]
            for field, expected_value in expected_fields.items():
                if edge.get(field) != expected_value:
                    raise ClosureLoaderGuardError(
                        f"closure edge disagrees with authoritative loader state on {field}: {consumer_key} -> {soname}"
                    )
            target_key = f"ELF{chain[0]['elf']['class']}:machine={chain[0]['elf']['machine']}:{chain[0]['elf']['endianness']}:{soname}"
            target_sets.setdefault(target_key, set()).add((hit["scope"], hit["canonical_path"]))
            to_key = edge.get("to")
            expected_to = f"{hit['scope']}:{hit['canonical_path']}"
            if to_key != expected_to or to_key not in nodes:
                raise ClosureLoaderGuardError(f"closure edge target node drifted: {consumer_key} -> {soname}")
            if hit["scope"] == "rootfs-external":
                node = nodes[to_key]
                if edge.get("package") != node.get("package") or edge.get("version") != node.get("version"):
                    raise ClosureLoaderGuardError(f"closure edge package identity drifted: {consumer_key} -> {soname}")
                external_hits += 1
            else:
                stage_hits += 1
                if hit["resolution_kind"] == "source-proven-dependency-attach-preload":
                    dependency_attach_preload_hits += 1
            edges_checked += 1

    ambiguous = {key: sorted(values) for key, values in target_sets.items() if len(values) != 1}
    if ambiguous:
        raise ClosureLoaderGuardError(f"closure target depends on loaded-shortname/context state: {ambiguous}")
    if edges_checked == 0 or not target_sets:
        raise ClosureLoaderGuardError("closure guard checked no DT_NEEDED edges")

    counts = {
        "contexts_checked": len(contexts),
        "edges_checked": edges_checked,
        "stage_hits": stage_hits,
        "rootfs_hits": external_hits,
        "identity_soname_pairs": len(target_sets),
        "dependency_attach_preload_hits": dependency_attach_preload_hits,
    }
    core = {
        "runtime_id": contract["runtime_id"],
        "staging_manifest_sha256": stage_digest,
        "direct_inventory_sha256": direct_digest,
        "direct_evidence_sha256": evidence["evidence_sha256"],
        "closure_sha256": closure_digest,
        "shortname_targets": {
            key: {"scope": next(iter(values))[0], "canonical_path": next(iter(values))[1]}
            for key, values in sorted(target_sets.items())
        },
        "counts": counts,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "transitive-dt-needed-loader-guard-verified-not-runtime-promoted",
        **core,
        "validation_sha256": DIRECT.canonical_sha256(core),
        "gates": {
            "direct_authoritative_evidence_verified": True,
            "closure_first_pathname_hit_verified": True,
            "closure_shortname_reuse_invariance_verified": True,
            "closure_origin_alias_context_verified": True,
            "transitive_dt_needed_loader_semantics_verified": True,
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
    parser.add_argument("command", choices=["check", "verify"])
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--direct-dependency-proof", type=Path)
    parser.add_argument("--direct-evidence-proof", type=Path)
    parser.add_argument("--closure-proof", type=Path)
    parser.add_argument("--unixlib-preload-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility transitive closure loader guard contract: PASS")
        return 0
    required = (
        args.stage_dir,
        args.rootfs,
        args.full_build_proof,
        args.direct_dependency_proof,
        args.direct_evidence_proof,
        args.closure_proof,
        args.unixlib_preload_source_proof,
        args.out,
    )
    if not all(required):
        raise ClosureLoaderGuardError(
            "verify requires --stage-dir, --rootfs, --full-build-proof, --direct-dependency-proof, "
            "--direct-evidence-proof, --closure-proof, --unixlib-preload-source-proof and --out"
        )
    result = verify(
        args.stage_dir.resolve(),
        args.rootfs.resolve(),
        load_json(args.full_build_proof, "full-build proof"),
        load_json(args.direct_dependency_proof, "direct dependency proof"),
        load_json(args.direct_evidence_proof, "direct dependency evidence proof"),
        load_json(args.closure_proof, "raw closure proof"),
        load_json(args.unixlib_preload_source_proof, "unixlib preload source proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility transitive closure loader guard: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ClosureLoaderGuardError, FIRST.FirstHitGuardError, DIRECT.RuntimeDependencyError) as exc:
        print(f"windows-compat-runtime-closure-loader-guard: {exc}", file=sys.stderr)
        raise SystemExit(2)
