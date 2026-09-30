#!/usr/bin/env python3
"""Validate and consume source-derived Wine unixlib preload relations at runtime-proof time.

This helper never executes Wine. A source-derived relation is only usable when
the exact staged provider exists beside the staged consumer, resolves within the
stage tree, and has the same ELF identity as the consumer. Source evidence alone
never grants a runtime hit; staged bytes alone never grant preload semantics.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path, PurePosixPath

PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-unixlib-preload-source-proof/1"
PROOF_STATUS = "source-derived-dependency-attach-unixlib-preloads-not-runtime-complete"
SEARCH_SOURCE = "wine-source-derived-dependency-attach-preload"


class UnixlibPreloadRuntimeError(RuntimeError):
    pass


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def proof_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "source_archive_member_count": proof.get("source_archive_member_count"),
        "module_makefile_count": proof.get("module_makefile_count"),
        "module_makefile_manifest_sha256": proof.get("module_makefile_manifest_sha256"),
        "loader_semantics": proof.get("loader_semantics"),
        "relations": proof.get("relations"),
    }


def validate_source_proof(proof: dict, runtime_id: str) -> str:
    if not isinstance(proof, dict):
        raise UnixlibPreloadRuntimeError("unixlib preload source proof must be an object")
    if proof.get("$schema") != PROOF_SCHEMA:
        raise UnixlibPreloadRuntimeError("unexpected unixlib preload source proof schema")
    if proof.get("status") != PROOF_STATUS:
        raise UnixlibPreloadRuntimeError("unixlib preload source proof status drifted")
    if proof.get("runtime_id") != runtime_id:
        raise UnixlibPreloadRuntimeError("unixlib preload source proof runtime identity drifted")
    evidence = proof.get("evidence_sha256")
    if not isinstance(evidence, str) or len(evidence) != 64 or any(ch not in "0123456789abcdef" for ch in evidence):
        raise UnixlibPreloadRuntimeError("unixlib preload source evidence digest is invalid")
    if canonical_sha256(proof_core(proof)) != evidence:
        raise UnixlibPreloadRuntimeError("unixlib preload source evidence digest does not verify")

    counts = proof.get("counts")
    if not isinstance(counts, dict):
        raise UnixlibPreloadRuntimeError("unixlib preload source proof counts are missing")
    candidate = counts.get("candidate_relations")
    proven = counts.get("proven_relations")
    relations = proof.get("relations")
    if not isinstance(candidate, int) or not isinstance(proven, int) or candidate < proven or proven < 1:
        raise UnixlibPreloadRuntimeError("unixlib preload source relation counts are invalid")
    if not isinstance(relations, list) or len(relations) != proven:
        raise UnixlibPreloadRuntimeError("unixlib preload source relation count drifted")

    expected_true = {
        "source_archive_verified",
        "module_makefile_surface_bound",
        "normal_pe_import_dependency_semantics_verified",
        "dependency_attach_order_verified",
        "builtin_unix_path_registration_verified",
        "winecrt_memory_query_bridge_verified",
        "lazy_unixlib_dlopen_verified",
        "source_derived_unixlib_preload_relations_verified",
    }
    expected_false = {
        "unixlib_preload_relations_runtime_verified",
        "dynamic_load_inventory_complete",
        "external_transitive_closure_verified",
        "runtime_dependency_inventory_complete",
        "runtime_package_content_hashes_pinned",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    }
    gates = proof.get("gates")
    if not isinstance(gates, dict) or set(gates) != expected_true | expected_false:
        raise UnixlibPreloadRuntimeError("unixlib preload source proof gate set drifted")
    if any(gates[key] is not True for key in expected_true):
        raise UnixlibPreloadRuntimeError("unixlib preload source prerequisite is not proven")
    if any(gates[key] is not False for key in expected_false):
        raise UnixlibPreloadRuntimeError("unixlib preload source proof crossed a forbidden boundary")

    relation_map(proof)
    return evidence


def _safe_name(value: object, label: str) -> str:
    if not isinstance(value, str) or not value or "/" in value or "\\" in value or value in {".", ".."}:
        raise UnixlibPreloadRuntimeError(f"unsafe unixlib preload {label}")
    return value


def relation_map(proof: dict) -> dict[tuple[str, str], dict]:
    relations = proof.get("relations")
    if not isinstance(relations, list):
        raise UnixlibPreloadRuntimeError("unixlib preload source relations are missing")
    mapped: dict[tuple[str, str], dict] = {}
    for relation in relations:
        if not isinstance(relation, dict):
            raise UnixlibPreloadRuntimeError("unixlib preload relation must be an object")
        consumer = _safe_name(relation.get("consumer_unixlib"), "consumer unixlib")
        provider = _safe_name(relation.get("provider_unixlib"), "provider unixlib")
        link_name = _safe_name(relation.get("link_name"), "link name")
        for field in ("consumer_module", "provider_module", "consumer_makefile", "provider_makefile"):
            if not isinstance(relation.get(field), str) or not relation[field]:
                raise UnixlibPreloadRuntimeError(f"unixlib preload relation lacks {field}")
        if relation.get("preload_order") != "provider-pe-dependency-attach-before-consumer-unixlib-dlopen":
            raise UnixlibPreloadRuntimeError("unixlib preload relation order semantics drifted")
        for field in ("consumer_attach", "provider_attach"):
            attach = relation.get(field)
            if not isinstance(attach, dict) or attach.get("process_attach_unix_init_verified") is not True:
                raise UnixlibPreloadRuntimeError(f"unixlib preload relation lacks verified {field}")
        key = (consumer, provider)
        if key in mapped:
            raise UnixlibPreloadRuntimeError(f"duplicate unixlib preload relation: {consumer} -> {provider}")
        mapped[key] = relation
    return mapped


def resolve_preloaded_unixlib(
    stage: Path,
    consumer_relative: str,
    soname: str,
    consumer_elf: dict,
    source_proof: dict,
    *,
    parse_elf,
    elf_identity,
    resolve_rooted_path,
) -> dict | None:
    consumer_path = PurePosixPath(consumer_relative)
    if consumer_path.is_absolute() or ".." in consumer_path.parts or not consumer_path.parts:
        raise UnixlibPreloadRuntimeError(f"unsafe unixlib preload consumer path: {consumer_relative!r}")
    provider_name = _safe_name(soname, "provider soname")
    relation = relation_map(source_proof).get((consumer_path.name, provider_name))
    if relation is None:
        return None

    expected_relative = consumer_path.parent / provider_name
    if expected_relative.is_absolute() or ".." in expected_relative.parts:
        raise UnixlibPreloadRuntimeError("unixlib preload provider path is unsafe")
    stage_root = stage.resolve()
    candidate = stage_root.joinpath(*expected_relative.parts)
    if not (candidate.exists() or candidate.is_symlink()):
        raise UnixlibPreloadRuntimeError(
            f"source-proven preloaded unixlib is missing beside consumer: {consumer_relative} -> {expected_relative}"
        )
    try:
        canonical = resolve_rooted_path(stage_root, candidate)
        info = parse_elf(stage_root / canonical)
    except Exception as exc:
        if isinstance(exc, UnixlibPreloadRuntimeError):
            raise
        raise UnixlibPreloadRuntimeError(
            f"invalid staged source-proven unixlib preload target {expected_relative}: {exc}"
        ) from exc
    if info is None:
        raise UnixlibPreloadRuntimeError(f"source-proven unixlib preload target is not ELF: {expected_relative}")
    expected_identity = elf_identity(consumer_elf)
    actual_identity = elf_identity(info)
    if actual_identity != expected_identity:
        raise UnixlibPreloadRuntimeError(
            f"source-proven unixlib preload ELF identity mismatch for {consumer_relative} -> {provider_name}: "
            f"expected={expected_identity} actual={actual_identity}"
        )

    return {
        "path": expected_relative.as_posix(),
        "candidate_paths": [expected_relative.as_posix()],
        "canonical_path": canonical,
        "class": expected_identity[0],
        "machine": expected_identity[1],
        "endianness": expected_identity[2],
        "scope": "stage-internal",
        "resolution_kind": "source-proven-dependency-attach-preload",
        "search_directory": None,
        "search_source": SEARCH_SOURCE,
        "search_position": None,
        "unixlib_preload_source_evidence_sha256": source_proof["evidence_sha256"],
        "preload_relation": {
            "link_name": relation["link_name"],
            "consumer_module": relation["consumer_module"],
            "provider_module": relation["provider_module"],
        },
    }
