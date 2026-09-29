#!/usr/bin/env python3
"""Map configured SONAME dlopen callsites to authoritative Wine source modules.

This proof is intentionally source/build-identity only. It does not claim that a
module's staged ELF identity or final loader context is known. For each direct
configured SONAME callsite from the locked dynamic source proof, it derives the
containing dlls/<module> directory, opens that exact directory's Makefile.in from
the pinned Wine archive, requires a unique MODULE identity, and proves that the
callsite translation unit is listed by a Makefile source variable.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-configured-soname-caller-modules.json"
SOURCE_LOCK_PATH = HERE / "source.json"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-configured-soname-caller-module-proof/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
MODULE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]*$")
ASSIGN_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|\+=|=)\s*(.*)$")
MAX_MAKEFILE_BYTES = 1024 * 1024


class CallerModuleProofError(RuntimeError):
    pass


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise CallerModuleProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise CallerModuleProofError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT_PATH, "configured SONAME caller module contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-configured-soname-caller-modules/1":
        raise CallerModuleProofError("unexpected configured SONAME caller module schema")
    if contract.get("status") != "configured-soname-caller-source-module-mapping-only-not-loader-context-complete":
        raise CallerModuleProofError("configured SONAME caller module status drifted")
    mapping = contract.get("mapping", {})
    required_true = (
        "translation_unit_membership_required",
        "line_numbers_are_not_authority",
        "module_directory_is_derived_from_callsite_path",
        "module_identity_must_be_unique_across_directories",
    )
    if any(mapping.get(key) is not True for key in required_true):
        raise CallerModuleProofError("caller module mapping guarantees drifted")
    if mapping.get("configured_soname_target_kind") != "configured-soname-symbol":
        raise CallerModuleProofError("configured SONAME target kind drifted")
    if mapping.get("required_path_prefix") != "dlls/" or mapping.get("module_makefile_name") != "Makefile.in":
        raise CallerModuleProofError("caller module path authority drifted")
    if mapping.get("module_identity_variable") != "MODULE":
        raise CallerModuleProofError("caller module identity variable drifted")
    boundaries = contract.get("open_boundaries", {})
    if not boundaries or any(value is not False for value in boundaries.values()):
        raise CallerModuleProofError("caller module open boundaries drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise CallerModuleProofError("caller module contract claims promotion/execution authority")
    expected = contract.get("expected", {})
    if expected != {
        "configured_soname_callsites": 32,
        "configured_soname_symbols": 24,
        "caller_module_directories": 15,
    }:
        raise CallerModuleProofError("caller module expected counts drifted")
    return contract


def source_lock() -> dict:
    source = load_json(SOURCE_LOCK_PATH, "source lock")
    if source.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1":
        raise CallerModuleProofError("unexpected source lock schema")
    return source


def dynamic_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "source_proof_sha256": proof.get("source_proof_sha256"),
        "c_archive_manifest_sha256": proof.get("c_archive_manifest_sha256"),
        "counts": proof.get("counts"),
        "callsites": proof.get("callsites"),
    }


def validate_dynamic_source(proof: dict, contract: dict, source: dict) -> str:
    if proof.get("$schema") != contract["input"]["dynamic_source_proof_schema"]:
        raise CallerModuleProofError("unexpected dynamic source proof schema")
    if proof.get("runtime_id") != contract["runtime_id"] or proof.get("runtime_id") != source.get("runtime_id"):
        raise CallerModuleProofError("dynamic source runtime identity drifted")
    digest = proof.get("inventory_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise CallerModuleProofError("dynamic source inventory digest is invalid")
    if canonical_sha256(dynamic_core(proof)) != digest:
        raise CallerModuleProofError("dynamic source inventory digest does not verify")
    if proof.get("source_archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise CallerModuleProofError("dynamic source archive identity drifted")
    counts = proof.get("counts", {})
    expected = contract["expected"]
    if counts.get("configured_soname_symbol_targets") != expected["configured_soname_callsites"]:
        raise CallerModuleProofError("configured SONAME callsite count drifted")
    symbols = counts.get("configured_soname_symbols")
    if not isinstance(symbols, dict) or len(symbols) != expected["configured_soname_symbols"]:
        raise CallerModuleProofError("configured SONAME symbol count drifted")
    gates = proof.get("gates", {})
    required_true = {
        "source_lock_verified",
        "source_proof_verified",
        "c_archive_manifest_bound",
        "direct_host_loader_calls_inventoried",
        "configured_soname_symbols_classified",
    }
    required_false = {
        "configured_soname_values_resolved",
        "wrapper_call_graph_complete",
        "generated_source_inventory_complete",
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
    if any(gates.get(key) is not True for key in required_true):
        raise CallerModuleProofError("dynamic source prerequisite gate drifted")
    if any(gates.get(key) is not False for key in required_false):
        raise CallerModuleProofError("dynamic source proof crossed forbidden boundary")
    return digest


def module_dir_from_callsite(path: str) -> str:
    posix = PurePosixPath(path)
    if posix.is_absolute() or ".." in posix.parts or len(posix.parts) < 3 or posix.parts[0] != "dlls":
        raise CallerModuleProofError(f"configured SONAME callsite is outside dll module tree: {path}")
    return PurePosixPath(*posix.parts[:2]).as_posix()


def logical_make_assignments(text: str) -> dict[str, list[str]]:
    assignments: dict[str, list[str]] = {}
    lines = text.splitlines()
    i = 0
    while i < len(lines):
        line = lines[i]
        match = ASSIGN_RE.match(line)
        if not match:
            i += 1
            continue
        name = match.group(1)
        parts: list[str] = []
        current = match.group(2)
        while True:
            stripped = current.rstrip()
            continued = stripped.endswith("\\")
            if continued:
                stripped = stripped[:-1]
            parts.append(stripped.strip())
            if not continued:
                break
            i += 1
            if i >= len(lines):
                raise CallerModuleProofError(f"unterminated Makefile assignment: {name}")
            current = lines[i]
        value = " ".join(part for part in parts if part).strip()
        assignments.setdefault(name, []).append(value)
        i += 1
    return assignments


def makefile_authority(module_dir: str, text: str, source_basenames: set[str]) -> dict:
    assignments = logical_make_assignments(text)
    module_values = assignments.get("MODULE", [])
    if len(module_values) != 1:
        raise CallerModuleProofError(f"{module_dir}/Makefile.in must define exactly one MODULE")
    module = module_values[0].strip()
    if not MODULE_RE.fullmatch(module) or any(ch.isspace() for ch in module):
        raise CallerModuleProofError(f"unsafe MODULE identity in {module_dir}: {module!r}")
    source_variables: dict[str, list[str]] = {}
    for basename in sorted(source_basenames):
        owners: list[str] = []
        for name, values in assignments.items():
            if "SOURCE" not in name:
                continue
            tokens = []
            for value in values:
                tokens.extend(value.split())
            normalized = {PurePosixPath(token).name for token in tokens if token and not token.startswith("$(")}
            if basename in normalized:
                owners.append(name)
        if not owners:
            raise CallerModuleProofError(
                f"translation unit {basename} is not listed by a source variable in {module_dir}/Makefile.in"
            )
        source_variables[basename] = sorted(owners)
    return {"module": module, "translation_unit_source_variables": source_variables}


def extract_makefiles(archive: Path, source: dict, module_sources: dict[str, set[str]], contract: dict) -> dict[str, dict]:
    upstream = source.get("upstream", {})
    if archive.stat().st_size != upstream.get("archive_size_bytes") or sha256_file(archive) != upstream.get("archive_sha256"):
        raise CallerModuleProofError("Wine archive does not match source lock")
    if upstream.get("archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise CallerModuleProofError("source lock and caller module contract archive digest differ")
    root = upstream.get("archive_root")
    if root != contract["input"]["archive_root"]:
        raise CallerModuleProofError("source archive root drifted")
    wanted = {
        f"{root}/{module_dir}/{contract['mapping']['module_makefile_name']}": module_dir
        for module_dir in module_sources
    }
    result: dict[str, dict] = {}
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                module_dir = wanted.get(member.name)
                if module_dir is None:
                    continue
                if module_dir in result:
                    raise CallerModuleProofError(f"duplicate module Makefile in archive: {module_dir}")
                if not member.isfile() or member.size <= 0 or member.size > MAX_MAKEFILE_BYTES:
                    raise CallerModuleProofError(f"invalid module Makefile member: {module_dir}")
                handle = tar.extractfile(member)
                if handle is None:
                    raise CallerModuleProofError(f"cannot read module Makefile: {module_dir}")
                raw = handle.read(MAX_MAKEFILE_BYTES + 1)
                if len(raw) != member.size or len(raw) > MAX_MAKEFILE_BYTES:
                    raise CallerModuleProofError(f"module Makefile exceeded exact bound: {module_dir}")
                try:
                    text = raw.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise CallerModuleProofError(f"module Makefile is not UTF-8: {module_dir}") from exc
                authority = makefile_authority(module_dir, text, module_sources[module_dir])
                result[module_dir] = {
                    "makefile_path": f"{module_dir}/Makefile.in",
                    "makefile_sha256": hashlib.sha256(raw).hexdigest(),
                    **authority,
                }
    except (tarfile.TarError, OSError) as exc:
        raise CallerModuleProofError(f"cannot inspect Wine archive module Makefiles: {exc}") from exc
    missing = sorted(set(module_sources) - set(result))
    if missing:
        raise CallerModuleProofError(f"Wine archive lacks module Makefiles: {missing}")
    modules: dict[str, str] = {}
    for directory, item in result.items():
        identity = item["module"]
        prior = modules.get(identity)
        if prior is not None and prior != directory:
            raise CallerModuleProofError(f"MODULE identity is ambiguous across directories: {identity}: {prior}, {directory}")
        modules[identity] = directory
    return result


def prove(archive: Path, dynamic_source: dict) -> dict:
    contract = load_contract()
    source = source_lock()
    dynamic_digest = validate_dynamic_source(dynamic_source, contract, source)
    callsites = dynamic_source.get("callsites")
    if not isinstance(callsites, list):
        raise CallerModuleProofError("dynamic source callsites are missing")
    configured: list[dict] = []
    module_sources: dict[str, set[str]] = {}
    for call in callsites:
        if not isinstance(call, dict) or not isinstance(call.get("target"), dict):
            raise CallerModuleProofError("invalid dynamic source callsite")
        target = call["target"]
        if target.get("kind") != contract["mapping"]["configured_soname_target_kind"]:
            continue
        path = call.get("path")
        symbol = target.get("symbol")
        if not isinstance(path, str) or not isinstance(symbol, str) or target.get("expression") != symbol:
            raise CallerModuleProofError("invalid configured SONAME callsite identity")
        if call.get("api") != "dlopen":
            raise CallerModuleProofError(f"unmodeled configured SONAME loader API: {call.get('api')}")
        module_dir = module_dir_from_callsite(path)
        basename = PurePosixPath(path).name
        module_sources.setdefault(module_dir, set()).add(basename)
        configured.append({
            "path": path,
            "line": call.get("line"),
            "column": call.get("column"),
            "api": "dlopen",
            "symbol": symbol,
            "module_dir": module_dir,
            "translation_unit": basename,
        })
    expected = contract["expected"]
    if len(configured) != expected["configured_soname_callsites"]:
        raise CallerModuleProofError("configured SONAME callsite extraction count drifted")
    symbols = {item["symbol"] for item in configured}
    if len(symbols) != expected["configured_soname_symbols"]:
        raise CallerModuleProofError("configured SONAME symbol extraction count drifted")
    if len(module_sources) != expected["caller_module_directories"]:
        raise CallerModuleProofError("configured SONAME caller module directory count drifted")
    authorities = extract_makefiles(archive, source, module_sources, contract)
    records: list[dict] = []
    for item in configured:
        authority = authorities[item["module_dir"]]
        owners = authority["translation_unit_source_variables"].get(item["translation_unit"])
        if not owners:
            raise CallerModuleProofError("translation unit ownership vanished after Makefile proof")
        records.append({
            **item,
            "module": authority["module"],
            "makefile_path": authority["makefile_path"],
            "makefile_sha256": authority["makefile_sha256"],
            "source_variables": owners,
        })
    records.sort(key=lambda item: (item["path"], item.get("line") or 0, item["symbol"]))
    module_records = [
        {
            "module_dir": directory,
            "module": item["module"],
            "makefile_path": item["makefile_path"],
            "makefile_sha256": item["makefile_sha256"],
            "translation_unit_source_variables": item["translation_unit_source_variables"],
        }
        for directory, item in sorted(authorities.items())
    ]
    counts = {
        "configured_soname_callsites": len(records),
        "configured_soname_symbols": len(symbols),
        "caller_module_directories": len(module_records),
        "caller_module_identities": len({item["module"] for item in module_records}),
        "translation_units": len({item["path"] for item in records}),
    }
    core = {
        "runtime_id": contract["runtime_id"],
        "source_archive_sha256": contract["input"]["source_archive_sha256"],
        "dynamic_source_inventory_sha256": dynamic_digest,
        "modules": module_records,
        "callsites": records,
        "counts": counts,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "configured-soname-callers-mapped-to-source-modules-not-staged-loader-context-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "dynamic_source_proof_verified": True,
            "caller_module_makefiles_bound": True,
            "caller_translation_unit_membership_verified": True,
            "configured_soname_caller_source_module_mapping_complete": True,
            "caller_binary_staged_identity_verified": False,
            "caller_rpath_runpath_verified": False,
            "caller_loader_search_order_verified": False,
            "caller_loader_context_resolution_complete": False,
            "runtime_computed_target_resolution_complete": False,
            "wrapper_call_graph_complete": False,
            "generated_source_inventory_complete": False,
            "dynamic_load_inventory_complete": False,
            "external_transitive_closure_verified": False,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "prove"])
    parser.add_argument("--source-archive", type=Path)
    parser.add_argument("--dynamic-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility configured SONAME caller module contract: PASS")
        return 0
    if not all((args.source_archive, args.dynamic_source_proof, args.out)):
        raise CallerModuleProofError("prove requires --source-archive, --dynamic-source-proof and --out")
    result = prove(args.source_archive.resolve(), load_json(args.dynamic_source_proof, "dynamic source proof"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility configured SONAME caller source modules: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except CallerModuleProofError as exc:
        print(f"windows-compat-runtime-configured-soname-caller-modules: {exc}", file=sys.stderr)
        raise SystemExit(2)
