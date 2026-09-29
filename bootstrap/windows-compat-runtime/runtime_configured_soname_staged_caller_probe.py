#!/usr/bin/env python3
"""Bind configure-enabled SONAME caller source modules to exact staged Unix ELFs.

This stage intentionally stops before loader-context resolution. It reopens the
same pinned Wine Makefile.in bytes already bound by the caller-module proof,
requires a unique UNIXLIB identity per module, parses the real generated
config.h with the same parser used by the configured-SONAME proof, recomputes
the exact staged manifest, and requires exactly one compatible
ELF64/x86_64/little caller only for modules with at least one defined SONAME.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-configured-soname-staged-callers.json"
SOURCE_LOCK_PATH = HERE / "source.json"
CALLER_PATH = HERE / "runtime_configured_soname_caller_module_probe.py"
CONFIGURED_PATH = HERE / "runtime_dynamic_load_configure_probe.py"
DEP_PATH = HERE / "runtime_dependency_probe.py"
CONTAINER_FULL_PATH = HERE / "container_full_build_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-configured-soname-staged-caller-proof/1"
SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]*$")
MAX_MAKEFILE_BYTES = 1024 * 1024


class StagedCallerProofError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise StagedCallerProofError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


CALLER = load_module("ordax_configured_soname_caller_module", CALLER_PATH)
CONFIGURED = load_module("ordax_configured_soname_state_parser", CONFIGURED_PATH)
DEP = load_module("ordax_configured_soname_staged_dep", DEP_PATH)
CONTAINER_FULL = load_module("ordax_configured_soname_staged_full", CONTAINER_FULL_PATH)
FULL = CONTAINER_FULL.FULL


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise StagedCallerProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise StagedCallerProofError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    value = load_json(CONTRACT_PATH, "staged configured SONAME caller contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-configured-soname-staged-callers/1":
        raise StagedCallerProofError("unexpected staged caller contract schema")
    if value.get("status") != "configured-soname-caller-staged-elf-identity-only-not-loader-context-complete":
        raise StagedCallerProofError("staged caller contract status drifted")
    verification = value.get("verification", {})
    for key in (
        "caller_module_evidence_binding_required",
        "module_makefile_digest_binding_required",
        "unixlib_source_identity_required",
        "real_generated_config_h_required",
        "configured_symbol_state_parser_reuse_required",
        "disabled_only_modules_do_not_require_staged_elf",
        "stage_manifest_recomputation_required",
        "all_same_basename_stage_candidates_inspected",
        "exactly_one_compatible_staged_elf_required_for_enabled_modules",
        "rooted_symlink_resolution_required",
    ):
        if verification.get(key) is not True:
            raise StagedCallerProofError(f"staged caller verification requirement drifted: {key}")
    for key in (
        "first_basename_candidate_selection_allowed",
        "rpath_runpath_resolution_complete",
        "loader_search_order_resolution_complete",
    ):
        if verification.get(key) is not False:
            raise StagedCallerProofError(f"staged caller boundary drifted: {key}")
    if value.get("input", {}).get("expected_elf") != {"class": 64, "machine": 62, "endianness": "little"}:
        raise StagedCallerProofError("staged caller ELF identity drifted")
    if value.get("expected") != {
        "caller_modules": 15,
        "configured_soname_callsites": 32,
        "configured_soname_symbols": 24,
        "defined_callsites": 30,
        "disabled_callsites": 2,
        "staged_caller_modules": 13,
        "disabled_only_modules": 2,
    }:
        raise StagedCallerProofError("staged caller expected counts drifted")
    if not value.get("open_boundaries") or any(item is not False for item in value["open_boundaries"].values()):
        raise StagedCallerProofError("staged caller open boundaries drifted")
    if not value.get("promotion") or any(item is not False for item in value["promotion"].values()):
        raise StagedCallerProofError("staged caller contract claims promotion/execution authority")
    return value


def source_lock() -> dict:
    value = load_json(SOURCE_LOCK_PATH, "source lock")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1":
        raise StagedCallerProofError("unexpected source lock schema")
    return value


def caller_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "dynamic_source_inventory_sha256": proof.get("dynamic_source_inventory_sha256"),
        "modules": proof.get("modules"),
        "callsites": proof.get("callsites"),
        "counts": proof.get("counts"),
    }


def validate_caller_proof(proof: dict, contract: dict, source: dict) -> str:
    if proof.get("$schema") != contract["input"]["caller_module_proof_schema"]:
        raise StagedCallerProofError("unexpected caller-module proof schema")
    if proof.get("runtime_id") != contract["runtime_id"] or proof.get("runtime_id") != source.get("runtime_id"):
        raise StagedCallerProofError("caller-module runtime identity drifted")
    if proof.get("source_archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise StagedCallerProofError("caller-module source identity drifted")
    evidence = proof.get("evidence_sha256")
    if not isinstance(evidence, str) or canonical_sha256(caller_core(proof)) != evidence:
        raise StagedCallerProofError("caller-module evidence digest does not verify")
    counts = proof.get("counts", {})
    expected = contract["expected"]
    if counts.get("caller_module_directories") != expected["caller_modules"]:
        raise StagedCallerProofError("caller-module count drifted")
    if counts.get("caller_module_identities") != expected["caller_modules"]:
        raise StagedCallerProofError("caller MODULE identity count drifted")
    if counts.get("configured_soname_callsites") != expected["configured_soname_callsites"]:
        raise StagedCallerProofError("configured SONAME caller count drifted")
    if counts.get("configured_soname_symbols") != expected["configured_soname_symbols"]:
        raise StagedCallerProofError("configured SONAME symbol count drifted")
    expected_gates = {
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
        "windows_payload_executed": False,
    }
    if proof.get("gates") != expected_gates:
        raise StagedCallerProofError("caller-module gate boundary drifted")
    return evidence


def expected_full_build_gates() -> dict[str, bool]:
    true = (
        "source_lock_verified", "version_lock_verified", "apk_content_lock_verified",
        "offline_content_replay_passed", "proot_full_build_rejected_by_diagnostic",
        "locked_rootfs_container_imported", "container_network_disabled",
        "container_rootfs_read_only", "container_capabilities_dropped",
        "compiler_execution_reproven_inside_container", "configure_completed",
        "generated_idl_header_barrier_completed", "full_build_proof_passed",
        "staged_install_completed",
    )
    false = (
        "runtime_dependency_inventory_complete", "binary_artifact_pinned",
        "activation_authorized", "execution_authorized", "windows_payload_executed", "wine_executed",
    )
    return {**{key: True for key in true}, **{key: False for key in false}}


def validate_full_build(proof: dict, stage_dir: Path, contract: dict, source: dict) -> tuple[str, dict]:
    if proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise StagedCallerProofError("unexpected full-build proof schema")
    if proof.get("status") != "full-build-proven-in-locked-container-staged-not-runtime-pinned-not-executable":
        raise StagedCallerProofError("full-build proof status drifted")
    if proof.get("runtime_id") != contract["runtime_id"] or proof.get("runtime_id") != source.get("runtime_id"):
        raise StagedCallerProofError("full-build runtime identity drifted")
    if proof.get("source_archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise StagedCallerProofError("full-build source archive identity drifted")
    if proof.get("gates") != expected_full_build_gates():
        raise StagedCallerProofError("full-build gate boundary drifted")
    manifest, total_bytes = FULL.staging_manifest(stage_dir)
    digest = FULL.canonical_manifest_sha256(manifest)
    staging = proof.get("staging", {})
    expected_counts = {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total_bytes,
        "canonical_manifest_sha256": digest,
    }
    if staging != expected_counts:
        raise StagedCallerProofError("staging manifest/counts changed after full-build proof")
    return digest, manifest


def requested_symbols(caller_proof: dict) -> dict[str, int]:
    requested: dict[str, int] = {}
    callsites = caller_proof.get("callsites")
    if not isinstance(callsites, list):
        raise StagedCallerProofError("caller-module proof has no callsites")
    for item in callsites:
        symbol = item.get("symbol") if isinstance(item, dict) else None
        if not isinstance(symbol, str) or not CONFIGURED.SYMBOL_RE.fullmatch(symbol):
            raise StagedCallerProofError("caller-module proof contains invalid configured SONAME symbol")
        requested[symbol] = requested.get(symbol, 0) + 1
    return dict(sorted(requested.items()))


def derive_module_symbol_states(caller_proof: dict, states: dict[str, dict]) -> dict[str, dict]:
    modules = caller_proof.get("modules")
    callsites = caller_proof.get("callsites")
    if not isinstance(modules, list) or not isinstance(callsites, list):
        raise StagedCallerProofError("caller-module evidence is incomplete")
    result: dict[str, dict] = {}
    for module in modules:
        module_dir = module.get("module_dir") if isinstance(module, dict) else None
        if not isinstance(module_dir, str) or module_dir in result:
            raise StagedCallerProofError("invalid or duplicate caller module directory")
        module_calls = [item for item in callsites if item.get("module_dir") == module_dir]
        if not module_calls:
            raise StagedCallerProofError(f"caller module has no configured SONAME callsites: {module_dir}")
        defined: set[str] = set()
        disabled: set[str] = set()
        defined_calls = disabled_calls = 0
        for item in module_calls:
            symbol = item["symbol"]
            state = states.get(symbol)
            if state is None:
                raise StagedCallerProofError(f"configured symbol state missing for caller: {symbol}")
            if state["state"] == "defined":
                defined.add(symbol)
                defined_calls += 1
            elif state["state"] == "disabled-by-configure":
                disabled.add(symbol)
                disabled_calls += 1
            else:
                raise StagedCallerProofError(f"unexpected configured symbol state: {symbol}:{state.get('state')}")
        result[module_dir] = {
            "defined_symbols": sorted(defined),
            "disabled_symbols": sorted(disabled),
            "defined_callsites": defined_calls,
            "disabled_callsites": disabled_calls,
            "staged_elf_required": defined_calls > 0,
        }
    return result


def validate_config_h(config_h: Path, caller_proof: dict, contract: dict) -> tuple[str, dict, dict]:
    requested = requested_symbols(caller_proof)
    expected = contract["expected"]
    if len(requested) != expected["configured_soname_symbols"] or sum(requested.values()) != expected["configured_soname_callsites"]:
        raise StagedCallerProofError("requested configured SONAME inventory drifted")
    try:
        digest, states = CONFIGURED.parse_config_h(config_h, requested)
    except CONFIGURED.ConfiguredSonameError as exc:
        raise StagedCallerProofError(str(exc)) from exc
    defined_calls = sum(item["source_calls"] for item in states.values() if item["state"] == "defined")
    disabled_calls = sum(item["source_calls"] for item in states.values() if item["state"] == "disabled-by-configure")
    if defined_calls != expected["defined_callsites"] or disabled_calls != expected["disabled_callsites"]:
        raise StagedCallerProofError(
            f"configured SONAME state cardinality drifted: defined={defined_calls} disabled={disabled_calls}"
        )
    module_states = derive_module_symbol_states(caller_proof, states)
    staged_modules = sum(1 for item in module_states.values() if item["staged_elf_required"])
    disabled_only = len(module_states) - staged_modules
    if staged_modules != expected["staged_caller_modules"] or disabled_only != expected["disabled_only_modules"]:
        raise StagedCallerProofError(
            f"configured caller module state drifted: staged={staged_modules} disabled_only={disabled_only}"
        )
    return digest, states, module_states


def read_unixlibs(archive: Path, source: dict, caller_proof: dict) -> dict[str, dict]:
    upstream = source.get("upstream", {})
    if archive.stat().st_size != upstream.get("archive_size_bytes") or CALLER.sha256_file(archive) != upstream.get("archive_sha256"):
        raise StagedCallerProofError("Wine source archive does not match source lock")
    modules = caller_proof.get("modules")
    if not isinstance(modules, list) or len(modules) != 15:
        raise StagedCallerProofError("caller-module proof has unexpected module list")
    root = upstream.get("archive_root")
    wanted = {f"{root}/{item['makefile_path']}": item for item in modules}
    result: dict[str, dict] = {}
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                prior = wanted.get(member.name)
                if prior is None:
                    continue
                module_dir = prior.get("module_dir")
                if not isinstance(module_dir, str) or module_dir in result:
                    raise StagedCallerProofError("duplicate or invalid caller module Makefile identity")
                if not member.isfile() or member.size <= 0 or member.size > MAX_MAKEFILE_BYTES:
                    raise StagedCallerProofError(f"invalid caller module Makefile member: {module_dir}")
                handle = tar.extractfile(member)
                if handle is None:
                    raise StagedCallerProofError(f"cannot read caller module Makefile: {module_dir}")
                raw = handle.read(MAX_MAKEFILE_BYTES + 1)
                if len(raw) != member.size or len(raw) > MAX_MAKEFILE_BYTES:
                    raise StagedCallerProofError(f"caller module Makefile exceeded exact bound: {module_dir}")
                digest = hashlib.sha256(raw).hexdigest()
                if digest != prior.get("makefile_sha256"):
                    raise StagedCallerProofError(f"caller module Makefile digest drifted: {module_dir}")
                try:
                    text = raw.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise StagedCallerProofError(f"caller module Makefile is not UTF-8: {module_dir}") from exc
                assignments = CALLER.logical_make_assignments(text)
                modules_seen = assignments.get("MODULE", [])
                unixlibs = assignments.get("UNIXLIB", [])
                if modules_seen != [prior.get("module")]:
                    raise StagedCallerProofError(f"caller MODULE identity changed: {module_dir}")
                if len(unixlibs) != 1:
                    raise StagedCallerProofError(f"caller module must define exactly one UNIXLIB: {module_dir}")
                unixlib = unixlibs[0].strip()
                if not SAFE_NAME_RE.fullmatch(unixlib) or "/" in unixlib or "\\" in unixlib or ".so" not in unixlib:
                    raise StagedCallerProofError(f"unsafe UNIXLIB identity for {module_dir}: {unixlib!r}")
                result[module_dir] = {
                    "module_dir": module_dir,
                    "module": prior["module"],
                    "makefile_path": prior["makefile_path"],
                    "makefile_sha256": digest,
                    "unixlib": unixlib,
                }
    except (tarfile.TarError, OSError) as exc:
        raise StagedCallerProofError(f"cannot inspect caller module Makefiles: {exc}") from exc
    missing = sorted(item["module_dir"] for item in modules if item["module_dir"] not in result)
    if missing:
        raise StagedCallerProofError(f"Wine source archive lacks caller module Makefiles: {missing}")
    unixlib_owner: dict[str, str] = {}
    for module_dir, item in result.items():
        prior = unixlib_owner.get(item["unixlib"])
        if prior is not None and prior != module_dir:
            raise StagedCallerProofError(
                f"UNIXLIB identity is ambiguous across caller modules: {item['unixlib']}: {prior}, {module_dir}"
            )
        unixlib_owner[item["unixlib"]] = module_dir
    return result


def bind_staged_elf(stage_dir: Path, stage_manifest: dict, unixlib: str, expected_identity: dict) -> dict:
    basename_paths = sorted(path for path in stage_manifest if PurePosixPath(path).name == unixlib)
    if not basename_paths:
        raise StagedCallerProofError(f"staging contains no pathname for UNIXLIB: {unixlib}")
    inspected: list[dict] = []
    compatible: list[dict] = []
    expected_tuple = DEP.elf_identity(expected_identity)
    for relative in basename_paths:
        path = stage_dir / relative
        try:
            canonical = DEP.resolve_rooted_path(stage_dir, path)
            info = DEP.parse_elf_dynamic(stage_dir / canonical)
        except (DEP.RuntimeDependencyError, OSError) as exc:
            raise StagedCallerProofError(f"cannot inspect staged UNIXLIB candidate {relative}: {exc}") from exc
        if info is None:
            raise StagedCallerProofError(f"staged UNIXLIB basename is not ELF: {relative}")
        identity = {"class": info["class"], "machine": info["machine"], "endianness": info["endianness"]}
        record = {
            "path": relative,
            "canonical_path": canonical,
            "elf": identity,
            "rpath": info["rpath"],
            "runpath": info["runpath"],
        }
        inspected.append(record)
        if DEP.elf_identity(info) == expected_tuple:
            compatible.append(record)
    if len(compatible) != 1:
        raise StagedCallerProofError(
            f"UNIXLIB must resolve to exactly one compatible staged ELF: {unixlib} compatible={len(compatible)}"
        )
    return {"staged_candidates": inspected, "selected": compatible[0]}


def prove(
    archive: Path,
    caller_proof: dict,
    full_build_proof: dict,
    config_h: Path,
    stage_dir: Path,
) -> dict:
    contract = load_contract()
    source = source_lock()
    caller_digest = validate_caller_proof(caller_proof, contract, source)
    stage_digest, stage_manifest = validate_full_build(full_build_proof, stage_dir, contract, source)
    config_h_digest, symbol_states, module_states = validate_config_h(config_h, caller_proof, contract)
    unixlibs = read_unixlibs(archive, source, caller_proof)
    records: list[dict] = []
    selected_paths: list[str] = []
    candidate_count = 0
    for module in caller_proof["modules"]:
        module_dir = module["module_dir"]
        authority = unixlibs[module_dir]
        configured = module_states[module_dir]
        if configured["staged_elf_required"]:
            staged = bind_staged_elf(stage_dir, stage_manifest, authority["unixlib"], contract["input"]["expected_elf"])
            selected_paths.append(staged["selected"]["path"])
            candidate_count += len(staged["staged_candidates"])
            record = {
                **authority,
                "configured": configured,
                **staged,
                "resolution": "configure-enabled-staged-elf-verified",
            }
        else:
            record = {
                **authority,
                "configured": configured,
                "staged_candidates": [],
                "selected": None,
                "resolution": "disabled-only-no-staged-elf-required",
            }
        records.append(record)
    records.sort(key=lambda item: item["module_dir"])
    expected = contract["expected"]
    if len(records) != expected["caller_modules"] or len(selected_paths) != expected["staged_caller_modules"]:
        raise StagedCallerProofError("staged caller module count drifted")
    if len(selected_paths) != len(set(selected_paths)):
        raise StagedCallerProofError("one staged ELF was selected for multiple distinct caller modules")
    core = {
        "runtime_id": contract["runtime_id"],
        "source_archive_sha256": contract["input"]["source_archive_sha256"],
        "caller_module_evidence_sha256": caller_digest,
        "full_build_proof_sha256": canonical_sha256(full_build_proof),
        "config_h_sha256": config_h_digest,
        "staging_manifest_sha256": stage_digest,
        "expected_elf": contract["input"]["expected_elf"],
        "configured_symbol_states": symbol_states,
        "modules": records,
        "counts": {
            "caller_modules": len(records),
            "defined_callsites": expected["defined_callsites"],
            "disabled_callsites": expected["disabled_callsites"],
            "staged_caller_modules": len(selected_paths),
            "disabled_only_modules": len(records) - len(selected_paths),
            "selected_staged_elfs": len(selected_paths),
            "same_basename_candidates_inspected": candidate_count,
        },
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "configured-soname-enabled-caller-staged-elf-identities-verified-not-loader-context-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "caller_module_evidence_verified": True,
            "full_build_proof_verified": True,
            "configured_symbol_states_verified": True,
            "staging_manifest_recomputed": True,
            "caller_unixlib_source_identity_verified": True,
            "caller_binary_staged_identity_verified": True,
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
            "windows_payload_executed": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "prove"])
    parser.add_argument("--source-archive", type=Path)
    parser.add_argument("--caller-module-proof", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--config-h", type=Path)
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility configured SONAME staged caller contract: PASS")
        return 0
    if not all((args.source_archive, args.caller_module_proof, args.full_build_proof, args.config_h, args.stage_dir, args.out)):
        raise StagedCallerProofError(
            "prove requires --source-archive, --caller-module-proof, --full-build-proof, --config-h, --stage-dir and --out"
        )
    result = prove(
        args.source_archive.resolve(),
        load_json(args.caller_module_proof, "caller-module proof"),
        load_json(args.full_build_proof, "full-build proof"),
        args.config_h.resolve(),
        args.stage_dir.resolve(),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility configured SONAME staged caller identities: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        StagedCallerProofError,
        CALLER.CallerModuleProofError,
        CONFIGURED.ConfiguredSonameError,
        DEP.RuntimeDependencyError,
        FULL.FullBuildProofError,
    ) as exc:
        print(f"windows-compat-runtime-configured-soname-staged-callers: {exc}", file=sys.stderr)
        raise SystemExit(2)
