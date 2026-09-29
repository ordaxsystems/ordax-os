#!/usr/bin/env python3
"""Inventory direct loader calls in C materialized by the locked Wine full build.

The upstream source proof scans every .c member in the pinned archive. This proof
covers the complementary out-of-tree build surface: every .c pathname that
exists under wine-output after the successful full build. Exact source mirrors
or symlinks are reconciled against the archive proof; every other C file is
content-addressed and scanned with the exact dlopen/dlmopen parser from the
source proof.

The pinned tools/makedep.c is also inspected to bind the release's generated-C
target semantics (IDL, bison, flex, Wayland XML, testlist, dlldata and
EXTRA_OBJS). This prevents silently declaring completeness from filename
heuristics alone.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-generated-source-inventory.json"
DYNAMIC_PATH = HERE / "runtime_dynamic_load_source_probe.py"
CONTAINER_FULL_PATH = HERE / "container_full_build_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-generated-source-proof/1"


class GeneratedSourceProofError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise GeneratedSourceProofError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DYNAMIC = load_module("ordax_dynamic_source_for_generated_inventory", DYNAMIC_PATH)
CONTAINER_FULL = load_module("ordax_container_full_for_generated_inventory", CONTAINER_FULL_PATH)
FULL = CONTAINER_FULL.FULL


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GeneratedSourceProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise GeneratedSourceProofError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    value = load_json(CONTRACT_PATH, "generated source inventory contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-generated-source-inventory/1":
        raise GeneratedSourceProofError("unexpected generated source contract schema")
    if value.get("status") != "generated-build-c-loader-discovery-not-dynamic-load-complete":
        raise GeneratedSourceProofError("generated source contract status drifted")
    inspection = value.get("inspection", {})
    required_true = (
        "out_of_tree_build_required",
        "all_materialized_build_tree_c_required",
        "build_tree_c_manifest_binding_required",
        "source_archive_counterpart_comparison_required",
        "build_tree_c_symlink_must_resolve_within_build_or_source_tree",
        "source_symlink_must_resolve_to_exact_archive_member",
        "makedep_generated_c_semantics_required",
        "direct_host_loader_parser_reuse_required",
        "comments_and_literals_must_not_create_callsites",
        "generated_direct_loader_calls_may_be_reported",
    )
    if any(inspection.get(key) is not True for key in required_true):
        raise GeneratedSourceProofError("generated source inspection guarantees drifted")
    required_false = (
        "external_c_symlink_allowed",
        "generated_direct_loader_calls_may_be_silently_ignored",
        "unparseable_generated_c_allowed",
        "unmodeled_generated_c_family_allowed",
    )
    if any(inspection.get(key) is not False for key in required_false):
        raise GeneratedSourceProofError("generated source fail-closed boundary drifted")
    for key in ("max_c_files", "max_single_c_bytes", "max_total_c_bytes"):
        if not isinstance(inspection.get(key), int) or inspection[key] <= 0:
            raise GeneratedSourceProofError(f"invalid generated source bound: {key}")
    if not value.get("open_boundaries") or any(item is not False for item in value["open_boundaries"].values()):
        raise GeneratedSourceProofError("generated source open boundaries drifted")
    if not value.get("promotion") or any(item is not False for item in value["promotion"].values()):
        raise GeneratedSourceProofError("generated source contract claims promotion/execution authority")
    return value


def dynamic_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "source_proof_sha256": proof.get("source_proof_sha256"),
        "c_archive_manifest_sha256": proof.get("c_archive_manifest_sha256"),
        "counts": proof.get("counts"),
        "callsites": proof.get("callsites"),
    }


def validate_dynamic_proof(proof: dict, contract: dict) -> str:
    if proof.get("$schema") != contract["input"]["dynamic_source_proof_schema"]:
        raise GeneratedSourceProofError("unexpected dynamic source proof schema")
    if proof.get("runtime_id") != contract["runtime_id"]:
        raise GeneratedSourceProofError("dynamic source runtime identity drifted")
    if proof.get("source_archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceProofError("dynamic source archive identity drifted")
    claimed = proof.get("inventory_sha256")
    if not isinstance(claimed, str) or canonical_sha256(dynamic_core(proof)) != claimed:
        raise GeneratedSourceProofError("dynamic source inventory digest does not verify")
    gates = proof.get("gates", {})
    for key in (
        "source_lock_verified", "source_proof_verified", "c_archive_manifest_bound",
        "direct_host_loader_calls_inventoried", "configured_soname_symbols_classified",
    ):
        if gates.get(key) is not True:
            raise GeneratedSourceProofError(f"dynamic source prerequisite is not proven: {key}")
    for key in (
        "configured_soname_values_resolved", "wrapper_call_graph_complete",
        "generated_source_inventory_complete", "dynamic_load_inventory_complete",
        "external_transitive_closure_verified", "runtime_dependency_inventory_complete",
        "runtime_package_content_hashes_pinned", "binary_artifact_pinned",
        "activation_authorized", "execution_authorized", "wine_executed", "windows_payload_executed",
    ):
        if gates.get(key) is not False:
            raise GeneratedSourceProofError(f"dynamic source proof crossed forbidden boundary: {key}")
    return claimed


def expected_full_build_gates() -> dict[str, bool]:
    true = (
        "source_lock_verified", "version_lock_verified", "apk_content_lock_verified",
        "offline_content_replay_passed", "proot_full_build_rejected_by_diagnostic",
        "locked_rootfs_container_imported", "container_network_disabled",
        "container_rootfs_read_only", "container_capabilities_dropped",
        "compiler_execution_reproven_inside_container", "configure_completed",
        "generated_idl_header_barrier_completed", "full_build_proof_passed", "staged_install_completed",
    )
    false = (
        "runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized",
        "execution_authorized", "windows_payload_executed", "wine_executed",
    )
    return {**{key: True for key in true}, **{key: False for key in false}}


def validate_full_build(proof: dict, work_dir: Path, contract: dict) -> str:
    if proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise GeneratedSourceProofError("unexpected full build proof schema")
    if proof.get("status") != "full-build-proven-in-locked-container-staged-not-runtime-pinned-not-executable":
        raise GeneratedSourceProofError("full build proof status drifted")
    if proof.get("runtime_id") != contract["runtime_id"]:
        raise GeneratedSourceProofError("full build runtime identity drifted")
    if proof.get("source_archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceProofError("full build source archive identity drifted")
    if proof.get("gates") != expected_full_build_gates():
        raise GeneratedSourceProofError("full build gate boundary drifted")
    stage = work_dir / "container-build/stage"
    if not stage.is_dir():
        raise GeneratedSourceProofError("full build stage is missing from work directory")
    manifest, total = FULL.staging_manifest(stage)
    staging = {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total,
        "canonical_manifest_sha256": FULL.canonical_manifest_sha256(manifest),
    }
    if staging != proof.get("staging"):
        raise GeneratedSourceProofError("stage changed after full build proof")
    return staging["canonical_manifest_sha256"]


def safe_relative(root: Path, path: Path, label: str) -> str:
    try:
        rel = path.relative_to(root).as_posix()
    except ValueError as exc:
        raise GeneratedSourceProofError(f"{label} is outside expected root: {path}") from exc
    pure = PurePosixPath(rel)
    if pure.is_absolute() or not pure.parts or ".." in pure.parts:
        raise GeneratedSourceProofError(f"unsafe {label}: {rel!r}")
    return pure.as_posix()


def read_exact(path: Path, max_bytes: int, label: str) -> bytes:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise GeneratedSourceProofError(f"cannot stat {label}: {exc}") from exc
    if size < 0 or size > max_bytes:
        raise GeneratedSourceProofError(f"{label} exceeds configured bound: {size}")
    try:
        data = path.read_bytes()
    except OSError as exc:
        raise GeneratedSourceProofError(f"cannot read {label}: {exc}") from exc
    if len(data) != size:
        raise GeneratedSourceProofError(f"{label} changed while being read")
    return data


def archive_c_manifest(archive: Path, contract: dict) -> tuple[dict[str, dict], dict[str, str]]:
    dynamic_contract = DYNAMIC.load_contract()
    if dynamic_contract["input"]["source_archive_sha256"] != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceProofError("dynamic source and generated source archive locks differ")
    entries, sources, _ = DYNAMIC.read_relevant_members(archive, dynamic_contract)
    entry_map = {item["path"]: item for item in entries}
    source_map = {item["path"]: item["text"] for item in sources}
    if len(entry_map) != len(entries) or len(source_map) != len(sources):
        raise GeneratedSourceProofError("source archive C paths are not unique")
    return entry_map, source_map


def extract_archive_text(archive: Path, member_name: str, max_bytes: int) -> tuple[str, str]:
    try:
        with tarfile.open(archive, "r:xz") as tar:
            matches = [member for member in tar if member.name == member_name]
            if len(matches) != 1:
                raise GeneratedSourceProofError(f"archive member cardinality drifted: {member_name}: {len(matches)}")
            member = matches[0]
            if not member.isfile() or member.size <= 0 or member.size > max_bytes:
                raise GeneratedSourceProofError(f"invalid archive text member: {member_name}")
            handle = tar.extractfile(member)
            if handle is None:
                raise GeneratedSourceProofError(f"cannot read archive text member: {member_name}")
            data = handle.read(max_bytes + 1)
            if len(data) != member.size or len(data) > max_bytes:
                raise GeneratedSourceProofError(f"archive text member exceeded exact bound: {member_name}")
    except (tarfile.TarError, OSError) as exc:
        if isinstance(exc, GeneratedSourceProofError):
            raise
        raise GeneratedSourceProofError(f"cannot inspect archive text member: {exc}") from exc
    try:
        return data.decode("utf-8", errors="strict"), hashlib.sha256(data).hexdigest()
    except UnicodeDecodeError as exc:
        raise GeneratedSourceProofError(f"archive text member is not UTF-8: {member_name}") from exc


def function_body(text: str, signature: str) -> str:
    start = text.find(signature)
    if start < 0:
        raise GeneratedSourceProofError(f"makedep function signature missing: {signature}")
    _, code = DYNAMIC.lexical_views(text)
    opening = code.find("{", start)
    if opening < 0:
        raise GeneratedSourceProofError(f"makedep function body missing: {signature}")
    depth = 0
    for index in range(opening, len(code)):
        if code[index] == "{":
            depth += 1
        elif code[index] == "}":
            depth -= 1
            if depth == 0:
                return text[opening + 1:index]
    raise GeneratedSourceProofError(f"unterminated makedep function body: {signature}")


def validate_makedep_semantics(archive: Path, contract: dict) -> dict:
    root = contract["input"]["archive_root"]
    text, digest = extract_archive_text(archive, f"{root}/tools/makedep.c", 4 * 1024 * 1024)
    generated = function_body(text, "static void add_generated_sources")
    c_literals = set(re.findall(r'"([^"\\]*\.c)"', generated))
    expected_literals = {
        "_c.c", "_s.c", "_i.c", "_p.c", "dlldata.c", ".tab.c", ".yy.c",
        "-protocol.c", "testlist.c", ".c",
    }
    if c_literals != expected_literals:
        raise GeneratedSourceProofError(
            f"unmodeled generated C family in pinned makedep: expected={sorted(expected_literals)} actual={sorted(c_literals)}"
        )
    required_markers = (
        "FLAG_IDL_CLIENT", "FLAG_IDL_SERVER", "FLAG_IDL_IDENT", "FLAG_IDL_PROXY",
        "EXTRA_OBJS", "FLAG_C_UNIX", 'strendswith( source->name, ".y" )',
        'strendswith( source->name, ".l" )', 'strendswith( source->name, ".xml" )',
    )
    if any(marker not in generated for marker in required_markers):
        raise GeneratedSourceProofError("pinned makedep generated-C semantics marker drifted")
    bison = function_body(text, "static void output_source_y")
    if ".tab.$$$$.c" not in bison or "rm -f" not in bison or ".tab.c" not in bison:
        raise GeneratedSourceProofError("bison generated-C persistence semantics drifted")
    flex = function_body(text, "static void output_source_l")
    if ".yy.c" not in flex:
        raise GeneratedSourceProofError("flex generated-C persistence semantics drifted")
    return {
        "makedep_sha256": digest,
        "generated_c_literals": sorted(c_literals),
        "families": [
            "idl-client-server-ident-proxy",
            "idl-dlldata",
            "bison-tab-c",
            "flex-yy-c",
            "wayland-xml-protocol-c",
            "testlist-c",
            "extra-objs-c",
        ],
        "bison_header_temp_c_removed": True,
        "bison_persistent_tab_c_target_verified": True,
        "flex_persistent_yy_c_target_verified": True,
    }


def source_calls_by_path(dynamic_proof: dict) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    for call in dynamic_proof.get("callsites", []):
        if not isinstance(call, dict) or not isinstance(call.get("path"), str):
            raise GeneratedSourceProofError("invalid dynamic source callsite")
        result.setdefault(call["path"], []).append(call)
    for calls in result.values():
        calls.sort(key=lambda item: (item["line"], item["column"], item["api"]))
    return result


def resolve_c_symlink(path: Path, build_root: Path, source_root: Path) -> tuple[str, str, Path]:
    try:
        target = path.resolve(strict=True)
    except (OSError, RuntimeError) as exc:
        raise GeneratedSourceProofError(f"cannot resolve build-tree C symlink {path}: {exc}") from exc
    if target.is_symlink() or not target.is_file():
        raise GeneratedSourceProofError(f"build-tree C symlink does not resolve to a regular file: {path}")
    try:
        return "build-internal-symlink", safe_relative(build_root, target, "build symlink target"), target
    except GeneratedSourceProofError:
        pass
    try:
        return "source-symlink", safe_relative(source_root, target, "source symlink target"), target
    except GeneratedSourceProofError as exc:
        raise GeneratedSourceProofError(f"build-tree C symlink escapes build/source roots: {path} -> {target}") from exc


def inventory_build_c(
    build_root: Path,
    source_root: Path,
    archive_entries: dict[str, dict],
    dynamic_proof: dict,
    contract: dict,
) -> tuple[list[dict], list[dict], dict]:
    inspection = contract["inspection"]
    paths = sorted(path for path in build_root.rglob("*.c") if path.is_file() or path.is_symlink())
    if not paths:
        raise GeneratedSourceProofError("full build output produced no materialized C files")
    if len(paths) > inspection["max_c_files"]:
        raise GeneratedSourceProofError("build-tree C file count exceeded configured bound")

    source_calls = source_calls_by_path(dynamic_proof)
    manifest: list[dict] = []
    generated_calls: list[dict] = []
    total_bytes = generated_bytes = 0
    source_covered = generated = regular_count = symlink_count = 0
    source_reconciled_calls = 0

    for path in paths:
        relative = safe_relative(build_root, path, "build-tree C path")
        if path.is_symlink():
            symlink_count += 1
            kind, canonical_rel, canonical_path = resolve_c_symlink(path, build_root, source_root)
            data = read_exact(canonical_path, inspection["max_single_c_bytes"], f"C symlink target {relative}")
            if kind == "source-symlink":
                entry = archive_entries.get(canonical_rel)
                digest = hashlib.sha256(data).hexdigest()
                if entry is None or entry["size"] != len(data) or entry["sha256"] != digest:
                    raise GeneratedSourceProofError(f"source C symlink target is not exact archive content: {relative}")
                source_path = canonical_rel
                source_covered += 1
            else:
                source_path = None
                generated += 1
        else:
            regular_count += 1
            canonical_rel = relative
            data = read_exact(path, inspection["max_single_c_bytes"], f"build-tree C file {relative}")
            digest = hashlib.sha256(data).hexdigest()
            entry = archive_entries.get(relative)
            if entry is not None and entry["size"] == len(data) and entry["sha256"] == digest:
                kind = "source-identical-shadow"
                source_path = relative
                source_covered += 1
            else:
                kind = "build-generated-shadow" if entry is not None else "build-generated"
                source_path = None
                generated += 1

        total_bytes += len(data)
        if total_bytes > inspection["max_total_c_bytes"]:
            raise GeneratedSourceProofError("build-tree C bytes exceeded configured bound")
        digest = hashlib.sha256(data).hexdigest()
        try:
            text = data.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise GeneratedSourceProofError(f"build-tree C is not UTF-8: {relative}") from exc

        if source_path is not None:
            observed = DYNAMIC.scan_text(source_path, text, DYNAMIC.load_contract()["inspection"]["direct_host_loader_apis"])
            observed.sort(key=lambda item: (item["line"], item["column"], item["api"]))
            expected = source_calls.get(source_path, [])
            if observed != expected:
                raise GeneratedSourceProofError(f"source-covered build C diverges from archive loader proof: {relative}")
            source_reconciled_calls += len(observed)
        else:
            generated_bytes += len(data)
            calls = DYNAMIC.scan_text(
                f"build-output/{relative}", text, DYNAMIC.load_contract()["inspection"]["direct_host_loader_apis"]
            )
            generated_calls.extend(calls)

        manifest.append({
            "path": relative,
            "kind": kind,
            "size": len(data),
            "sha256": digest,
            "canonical_path": canonical_rel,
            "source_path": source_path,
        })

    manifest.sort(key=lambda item: item["path"])
    generated_calls.sort(key=lambda item: (item["path"], item["line"], item["column"], item["api"]))
    counts = {
        "build_tree_c_files": len(manifest),
        "regular_c_files": regular_count,
        "c_symlinks": symlink_count,
        "source_covered_c_files": source_covered,
        "generated_c_files": generated,
        "build_tree_c_bytes": total_bytes,
        "generated_c_bytes": generated_bytes,
        "source_reconciled_loader_calls": source_reconciled_calls,
        "generated_direct_loader_calls": len(generated_calls),
    }
    if counts["build_tree_c_files"] != counts["source_covered_c_files"] + counts["generated_c_files"]:
        raise GeneratedSourceProofError("build-tree C provenance classification is incomplete")
    return manifest, generated_calls, counts


def prove(work_dir: Path, full_build_proof: dict, dynamic_proof: dict) -> dict:
    contract = load_contract()
    work_dir = work_dir.resolve()
    build_root = work_dir / contract["input"]["build_output_relative_path"]
    source_root = work_dir / contract["input"]["source_tree_relative_path"]
    if not build_root.is_dir() or not source_root.is_dir():
        raise GeneratedSourceProofError("expected out-of-tree Wine build/source roots are missing")
    if build_root.resolve() == source_root.resolve():
        raise GeneratedSourceProofError("generated source proof requires an out-of-tree build")

    stage_digest = validate_full_build(full_build_proof, work_dir, contract)
    dynamic_digest = validate_dynamic_proof(dynamic_proof, contract)

    source_lock = DYNAMIC.load_json(DYNAMIC.SOURCE_LOCK, "source lock")
    upstream = source_lock.get("upstream", {})
    archive = work_dir / "wine-source-cache" / upstream.get("archive_name", "")
    if not archive.is_file() or DYNAMIC.sha256_file(archive) != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceProofError("full-build Wine archive is missing or does not match the source lock")
    archive_entries, _ = archive_c_manifest(archive, contract)
    makedep = validate_makedep_semantics(archive, contract)
    manifest, generated_calls, counts = inventory_build_c(
        build_root, source_root, archive_entries, dynamic_proof, contract
    )
    if counts["generated_c_files"] <= 0:
        raise GeneratedSourceProofError("full build produced no generated C files; generation model likely drifted")

    generated_manifest = [item for item in manifest if item["source_path"] is None]
    core = {
        "runtime_id": contract["runtime_id"],
        "source_archive_sha256": contract["input"]["source_archive_sha256"],
        "dynamic_source_inventory_sha256": dynamic_digest,
        "staging_manifest_sha256": stage_digest,
        "makedep": makedep,
        "build_tree_c_manifest_sha256": canonical_sha256(manifest),
        "generated_c_manifest_sha256": canonical_sha256(generated_manifest),
        "counts": counts,
        "generated_callsites": generated_calls,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "full-build-generated-c-loader-sites-inventoried-not-dynamic-load-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "full_build_proof_verified": True,
            "staging_manifest_recomputed": True,
            "dynamic_source_proof_verified": True,
            "makedep_generated_c_semantics_verified": True,
            "build_tree_c_manifest_bound": True,
            "all_materialized_build_tree_c_parsed": True,
            "source_covered_build_c_reconciled": True,
            "generated_source_inventory_complete": True,
            "wrapper_call_graph_complete": False,
            "runtime_computed_target_resolution_complete": False,
            "configured_soname_caller_loader_context_complete": False,
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
    parser.add_argument("command", choices=["check", "prove"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--dynamic-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility generated C loader inventory contract: PASS")
        return 0
    if not all((args.work_dir, args.full_build_proof, args.dynamic_source_proof, args.out)):
        raise GeneratedSourceProofError(
            "prove requires --work-dir, --full-build-proof, --dynamic-source-proof and --out"
        )
    result = prove(
        args.work_dir,
        load_json(args.full_build_proof, "full-build proof"),
        load_json(args.dynamic_source_proof, "dynamic source proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility generated C loader inventory: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        GeneratedSourceProofError,
        DYNAMIC.DynamicLoadDiscoveryError,
        CONTAINER_FULL.ContainerFullBuildError,
    ) as exc:
        print(f"windows-compat-runtime-generated-source: {exc}", file=sys.stderr)
        raise SystemExit(2)
