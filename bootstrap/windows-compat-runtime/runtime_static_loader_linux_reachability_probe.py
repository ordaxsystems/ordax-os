#!/usr/bin/env python3
"""Prove Linux build reachability of classified static Wine dlopen targets.

This proof does not execute Wine. It recomputes the source/dynamic/static proof
chain from the exact Wine archive, validates the real full-build staging tree,
proves the Wine configure host-selection semantics, verifies that the generated
Makefile disabled the host-specific modules, and confirms their artifacts are
absent from the exact staged install. Absence alone is never authoritative.
"""

from __future__ import annotations

import argparse
import fnmatch
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import sys
import tarfile

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-static-loader-linux-reachability.json"
BUILD_PATH = HERE / "build.py"
DYNAMIC_PATH = HERE / "runtime_dynamic_load_source_probe.py"
STATIC_PATH = HERE / "runtime_static_loader_target_classifier.py"
CONTAINER_FULL_PATH = HERE / "container_full_build_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-static-loader-linux-reachability-proof/1"
MAX_TEXT_MEMBER_BYTES = 2 * 1024 * 1024
MAX_BUILD_TEXT_BYTES = 16 * 1024 * 1024
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class StaticLoaderReachabilityError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise StaticLoaderReachabilityError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load_module("ordax_static_reachability_source", BUILD_PATH)
DYNAMIC = load_module("ordax_static_reachability_dynamic", DYNAMIC_PATH)
STATIC = load_module("ordax_static_reachability_classification", STATIC_PATH)
CONTAINER_FULL = load_module("ordax_static_reachability_full_build", CONTAINER_FULL_PATH)
FULL = CONTAINER_FULL.FULL


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


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
        raise StaticLoaderReachabilityError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise StaticLoaderReachabilityError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT_PATH, "static loader Linux reachability contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-static-loader-linux-reachability/1":
        raise StaticLoaderReachabilityError("unexpected static loader Linux reachability schema")
    if contract.get("status") != "linux-build-reachability-only-not-dynamic-inventory-complete":
        raise StaticLoaderReachabilityError("static loader Linux reachability status drifted")
    required_true = (
        "exact_locked_source_archive_required",
        "dynamic_source_recomputation_required",
        "static_classification_recomputation_required",
        "full_build_runtime_identity_required",
        "configure_host_os_required",
        "configure_host_rule_required",
        "generated_disabled_subdirs_required",
        "module_makefile_identity_required",
        "staged_module_absence_required_when_host_disabled",
    )
    verification = contract.get("verification", {})
    if any(verification.get(key) is not True for key in required_true):
        raise StaticLoaderReachabilityError("reachability verification guarantees drifted")
    if verification.get("absence_without_host_disable_evidence_allowed") is not False:
        raise StaticLoaderReachabilityError("staging absence may not be authoritative by itself")
    if contract.get("source_authority", {}).get("disabled_subdir_semantics_required") is not True:
        raise StaticLoaderReachabilityError("disabled-subdir source semantics are not required")
    if contract.get("source_authority", {}).get("staging_manifest_recomputation_required") is not True:
        raise StaticLoaderReachabilityError("staging manifest recomputation is not required")
    modules = contract.get("modules")
    if not isinstance(modules, list) or len(modules) != 2:
        raise StaticLoaderReachabilityError("exactly two host-specific module rules are required")
    ids: set[str] = set()
    rule_ids: set[str] = set()
    for module in modules:
        if not isinstance(module, dict):
            raise StaticLoaderReachabilityError("module reachability rule must be an object")
        for field in (
            "id", "source_subdir", "makefile_source_path", "enable_variable",
            "host_os_enable_pattern", "expected_module", "expected_unixlib",
        ):
            if not isinstance(module.get(field), str) or not module[field]:
                raise StaticLoaderReachabilityError(f"module reachability rule lacks {field}")
        if module["id"] in ids:
            raise StaticLoaderReachabilityError(f"duplicate module rule id: {module['id']}")
        ids.add(module["id"])
        current = module.get("static_rule_ids")
        if not isinstance(current, list) or not current or any(not isinstance(item, str) or not item for item in current):
            raise StaticLoaderReachabilityError(f"invalid static rule ids for {module['id']}")
        if rule_ids.intersection(current):
            raise StaticLoaderReachabilityError("static classification rule mapped to multiple modules")
        rule_ids.update(current)
    open_boundaries = contract.get("open_boundaries", {})
    if not open_boundaries or any(value is not False for value in open_boundaries.values()):
        raise StaticLoaderReachabilityError("open dynamic-load boundaries drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise StaticLoaderReachabilityError("reachability contract claims promotion or execution authority")
    return contract


def read_bounded_text(path: Path, label: str, limit: int = MAX_BUILD_TEXT_BYTES) -> tuple[str, str]:
    try:
        size = path.stat().st_size
    except OSError as exc:
        raise StaticLoaderReachabilityError(f"cannot stat {label}: {exc}") from exc
    if size <= 0 or size > limit:
        raise StaticLoaderReachabilityError(f"{label} size is outside bound")
    try:
        raw = path.read_bytes()
    except OSError as exc:
        raise StaticLoaderReachabilityError(f"cannot read {label}: {exc}") from exc
    if len(raw) != size:
        raise StaticLoaderReachabilityError(f"{label} size changed while reading")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise StaticLoaderReachabilityError(f"{label} is not UTF-8") from exc
    return text, sha256_bytes(raw)


def extract_source_members(archive: Path, source: dict, relative_paths: list[str]) -> dict[str, dict]:
    archive_proof = BUILD.validate_archive(source, archive)
    if archive_proof.get("archive_sha256") != source["upstream"]["archive_sha256"]:
        raise StaticLoaderReachabilityError("locked source archive proof digest drifted")
    root = source["upstream"]["archive_root"]
    wanted = {f"{root}/{path}": path for path in relative_paths}
    seen: dict[str, dict] = {}
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                relative = wanted.get(member.name)
                if relative is None:
                    continue
                if relative in seen:
                    raise StaticLoaderReachabilityError(f"duplicate source authority member: {relative}")
                if not member.isfile() or member.size <= 0 or member.size > MAX_TEXT_MEMBER_BYTES:
                    raise StaticLoaderReachabilityError(f"invalid source authority member type/size: {relative}")
                handle = tar.extractfile(member)
                if handle is None:
                    raise StaticLoaderReachabilityError(f"cannot read source authority member: {relative}")
                raw = handle.read(MAX_TEXT_MEMBER_BYTES + 1)
                if len(raw) != member.size or len(raw) > MAX_TEXT_MEMBER_BYTES:
                    raise StaticLoaderReachabilityError(f"source authority member exceeded exact bound: {relative}")
                try:
                    text = raw.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise StaticLoaderReachabilityError(f"source authority member is not UTF-8: {relative}") from exc
                seen[relative] = {"text": text, "sha256": sha256_bytes(raw), "size": len(raw)}
    except (tarfile.TarError, OSError) as exc:
        raise StaticLoaderReachabilityError(f"cannot inspect source authority members: {exc}") from exc
    missing = sorted(set(relative_paths) - set(seen))
    if missing:
        raise StaticLoaderReachabilityError(f"locked source archive lacks authority members: {missing}")
    return seen


def parse_simple_makefile_identity(text: str, label: str) -> dict:
    values: dict[str, str] = {}
    for name in ("MODULE", "UNIXLIB"):
        matches = re.findall(rf"(?m)^\s*{re.escape(name)}\s*=\s*([^#\n]+?)\s*$", text)
        if len(matches) != 1:
            raise StaticLoaderReachabilityError(f"{label} must define exactly one {name}")
        value = matches[0].strip()
        if not value or any(ch.isspace() for ch in value):
            raise StaticLoaderReachabilityError(f"{label} has unsafe {name}")
        values[name] = value
    return values


def prove_configure_host_rule(configure: str, module: dict) -> dict:
    variable = module["enable_variable"]
    pattern = module["host_os_enable_pattern"]
    yes_line = f"{variable}=${{{variable}:-yes}}"
    no_line = f"{variable}=${{{variable}:-no}}"
    yes_index = configure.find(yes_line)
    if yes_index < 0:
        raise StaticLoaderReachabilityError(f"configure does not enable {variable} in its modeled host branch")
    branch_token = f"{pattern})"
    branch_index = configure.rfind(branch_token, 0, yes_index)
    case_index = configure.rfind("case $host_os in", 0, branch_index)
    if case_index < 0 or branch_index < case_index or yes_index < branch_index:
        raise StaticLoaderReachabilityError(f"configure host_os branch for {variable} is not proven")
    esac_index = configure.find("\nesac", yes_index)
    if esac_index < 0 or esac_index - case_index > 20000:
        raise StaticLoaderReachabilityError(f"configure host_os case boundary for {variable} is ambiguous")
    no_index = configure.find(no_line, esac_index)
    if no_index < 0 or no_index - esac_index > 20000:
        raise StaticLoaderReachabilityError(f"configure default-disable semantics for {variable} are not proven")
    makefile_token = f"WINE_CONFIG_MAKEFILE({module['source_subdir']})"
    makefile_index = configure.find(makefile_token, no_index)
    if makefile_index < 0:
        raise StaticLoaderReachabilityError(f"configure does not register module makefile: {module['source_subdir']}")
    return {
        "enable_variable": variable,
        "host_os_enable_pattern": pattern,
        "host_branch_enables_by_default": True,
        "nonmatching_host_defaults_disabled": True,
        "wine_config_makefile_registered": True,
    }


def prove_disabled_subdir_macro(aclocal: str) -> None:
    required_patterns = (
        r"wine_fn_config_makefile\s*\(\s*\)\s*\{",
        r"AS_VAR_COPY\(\[enable\],\[\$\[2\]\]\)",
        r"no\)\s*AS_VAR_APPEND\(\[DISABLED_SUBDIRS\],\[\" \$\[1\]\"\]\)\s*;;",
        r"AC_DEFUN\(\[WINE_CONFIG_MAKEFILE\]",
        r"wine_fn_config_makefile\s+\[\$1\]\s+ac_enable",
    )
    normalized = re.sub(r"\s+", " ", aclocal)
    for pattern in required_patterns:
        if re.search(pattern, normalized) is None:
            raise StaticLoaderReachabilityError(f"Wine disabled-subdir macro semantics drifted: {pattern}")


def source_semantics(members: dict[str, dict], contract: dict) -> dict:
    authority = contract["source_authority"]
    configure = members[authority["configure_path"]]["text"]
    aclocal = members[authority["makefile_macro_path"]]["text"]
    prove_disabled_subdir_macro(aclocal)
    modules: list[dict] = []
    for module in contract["modules"]:
        makefile = members[module["makefile_source_path"]]
        identity = parse_simple_makefile_identity(makefile["text"], module["makefile_source_path"])
        if identity["MODULE"] != module["expected_module"] or identity["UNIXLIB"] != module["expected_unixlib"]:
            raise StaticLoaderReachabilityError(f"module Makefile identity drifted: {module['id']}")
        modules.append({
            "id": module["id"],
            "source_subdir": module["source_subdir"],
            "makefile_source_path": module["makefile_source_path"],
            "makefile_source_sha256": makefile["sha256"],
            "module": identity["MODULE"],
            "unixlib": identity["UNIXLIB"],
            "configure": prove_configure_host_rule(configure, module),
        })
    return {
        "configure_path": authority["configure_path"],
        "configure_sha256": members[authority["configure_path"]]["sha256"],
        "makefile_macro_path": authority["makefile_macro_path"],
        "makefile_macro_sha256": members[authority["makefile_macro_path"]]["sha256"],
        "disabled_subdir_macro_verified": True,
        "modules": modules,
    }


def make_variable(text: str, name: str) -> list[str]:
    lines = text.splitlines()
    values: list[str] = []
    i = 0
    pattern = re.compile(rf"^\s*{re.escape(name)}\s*=\s*(.*)$")
    while i < len(lines):
        match = pattern.match(lines[i])
        if not match:
            i += 1
            continue
        parts: list[str] = []
        current = match.group(1)
        while True:
            continued = current.rstrip().endswith("\\")
            if continued:
                current = current.rstrip()[:-1]
            parts.append(current.strip())
            if not continued:
                break
            i += 1
            if i >= len(lines):
                raise StaticLoaderReachabilityError(f"unterminated generated Makefile variable: {name}")
            current = lines[i]
        values.append(" ".join(part for part in parts if part).strip())
        i += 1
    if len(values) != 1:
        raise StaticLoaderReachabilityError(f"generated Makefile must define exactly one {name}")
    tokens = values[0].split()
    if len(tokens) != len(set(tokens)):
        raise StaticLoaderReachabilityError(f"generated Makefile {name} contains duplicates")
    return tokens


def config_log_value(text: str, name: str) -> str:
    patterns = (
        rf"(?m)^{re.escape(name)}='([^']*)'$",
        rf'(?m)^{re.escape(name)}="([^"]*)"$',
        rf"(?m)^{re.escape(name)}=([^\s]+)$",
    )
    values: list[str] = []
    for pattern in patterns:
        values.extend(re.findall(pattern, text))
    unique = sorted(set(values))
    if len(unique) != 1 or not unique[0]:
        raise StaticLoaderReachabilityError(f"config.log must expose exactly one {name}")
    return unique[0]


def validate_full_build(full: dict, source: dict, stage_dir: Path) -> tuple[str, str, dict]:
    if full.get("$schema") != "prototype-ordax.windows-compat-full-build-proof/2":
        raise StaticLoaderReachabilityError("unexpected full-build proof schema")
    if full.get("status") != "full-build-proven-in-locked-container-staged-not-runtime-pinned-not-executable":
        raise StaticLoaderReachabilityError("full-build proof status drifted")
    if full.get("runtime_id") != source["runtime_id"] or full.get("wine_version") != source["version"]:
        raise StaticLoaderReachabilityError("full-build runtime identity drifted")
    if full.get("source_archive_sha256") != source["upstream"]["archive_sha256"]:
        raise StaticLoaderReachabilityError("full-build source archive identity drifted")
    gates = full.get("gates", {})
    for key in (
        "source_lock_verified", "version_lock_verified", "apk_content_lock_verified",
        "offline_content_replay_passed", "locked_rootfs_container_imported",
        "container_network_disabled", "container_rootfs_read_only",
        "container_capabilities_dropped", "compiler_execution_reproven_inside_container",
        "configure_completed", "full_build_proof_passed", "staged_install_completed",
    ):
        if gates.get(key) is not True:
            raise StaticLoaderReachabilityError(f"full-build prerequisite is not proven: {key}")
    for key in ("runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized", "execution_authorized", "wine_executed", "windows_payload_executed"):
        if gates.get(key) is not False:
            raise StaticLoaderReachabilityError(f"full-build proof crossed forbidden boundary: {key}")
    content_lock, version_lock, _, toolchain = FULL.load_inputs()
    triplet = full.get("compiler", {}).get("triplet")
    expected_triplet = toolchain["native"]["triplet"]
    if triplet != expected_triplet or triplet != version_lock["configure"]["native_compiler_triplet"]:
        raise StaticLoaderReachabilityError("full-build compiler triplet drifted from locked toolchain")
    if content_lock.get("runtime_id") != source["runtime_id"]:
        raise StaticLoaderReachabilityError("full-build content lock runtime identity drifted")
    manifest, total_bytes = FULL.staging_manifest(stage_dir)
    digest = FULL.canonical_manifest_sha256(manifest)
    staging = full.get("staging", {})
    if staging.get("canonical_manifest_sha256") != digest:
        raise StaticLoaderReachabilityError("staging manifest digest changed after full-build proof")
    actual_counts = {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total_bytes,
    }
    for key, value in actual_counts.items():
        if staging.get(key) != value:
            raise StaticLoaderReachabilityError(f"staging {key} changed after full-build proof")
    return digest, triplet, manifest


def evaluate_reachability(
    contract: dict,
    static_proof: dict,
    host_os: str,
    generated_subdirs: list[str],
    disabled_subdirs: list[str],
    stage_manifest: dict,
    source_info: dict,
) -> tuple[list[dict], list[dict], dict]:
    classifications = static_proof.get("classifications")
    if not isinstance(classifications, list) or not classifications:
        raise StaticLoaderReachabilityError("static classification proof has no classifications")
    by_rule: dict[str, list[dict]] = {}
    for item in classifications:
        if not isinstance(item, dict) or not isinstance(item.get("rule_id"), str):
            raise StaticLoaderReachabilityError("invalid static classification record")
        by_rule.setdefault(item["rule_id"], []).append(item)
    source_modules = {item["id"]: item for item in source_info["modules"]}
    module_records: list[dict] = []
    callsite_records: list[dict] = []
    consumed_rules: set[str] = set()
    for module in contract["modules"]:
        source_module = source_modules.get(module["id"])
        if source_module is None:
            raise StaticLoaderReachabilityError(f"source authority missing module: {module['id']}")
        subdir = module["source_subdir"]
        if subdir not in generated_subdirs:
            raise StaticLoaderReachabilityError(f"generated Makefile omitted configured module subdir: {subdir}")
        host_enabled = fnmatch.fnmatchcase(host_os, module["host_os_enable_pattern"])
        if host_enabled:
            raise StaticLoaderReachabilityError(
                f"host enables {module['id']}; this proof only authorizes host-disabled static targets"
            )
        if subdir not in disabled_subdirs:
            raise StaticLoaderReachabilityError(f"host-disabled module is not in generated DISABLED_SUBDIRS: {subdir}")
        expected_names = {module["expected_module"], module["expected_unixlib"]}
        staged_hits = sorted(path for path in stage_manifest if PurePosixPath(path).name in expected_names)
        if staged_hits:
            raise StaticLoaderReachabilityError(
                f"host-disabled module unexpectedly produced staged artifacts: {module['id']}:{staged_hits}"
            )
        module_calls = 0
        for rule_id in module["static_rule_ids"]:
            if rule_id in consumed_rules:
                raise StaticLoaderReachabilityError(f"static rule consumed twice: {rule_id}")
            records = by_rule.get(rule_id)
            if not records:
                raise StaticLoaderReachabilityError(f"static classification rule missing from proof: {rule_id}")
            consumed_rules.add(rule_id)
            for record in records:
                module_calls += 1
                callsite_records.append({
                    "rule_id": rule_id,
                    "path": record.get("path"),
                    "line": record.get("line"),
                    "api": record.get("api"),
                    "expression": record.get("expression"),
                    "module_id": module["id"],
                    "reachability": "unreachable-host-disabled",
                })
        module_records.append({
            "id": module["id"],
            "source_subdir": subdir,
            "host_os_enable_pattern": module["host_os_enable_pattern"],
            "host_pattern_matches": False,
            "generated_subdir_present": True,
            "generated_disabled_subdir_present": True,
            "module": module["expected_module"],
            "unixlib": module["expected_unixlib"],
            "staged_artifact_hits": [],
            "static_callsites": module_calls,
            "reachability": "unreachable-host-disabled",
        })
    extra_rules = sorted(set(by_rule) - consumed_rules)
    if extra_rules:
        raise StaticLoaderReachabilityError(f"static classification rules are outside reachability contract: {extra_rules}")
    callsite_records.sort(key=lambda item: (item.get("path") or "", item.get("line") or 0, item["rule_id"]))
    counts = {
        "modules": len(module_records),
        "static_callsites": len(callsite_records),
        "reachable_static_callsites": 0,
        "unreachable_host_disabled_static_callsites": len(callsite_records),
    }
    if counts["static_callsites"] != static_proof.get("counts", {}).get("static_callsites"):
        raise StaticLoaderReachabilityError("static callsite reachability count drifted from classification proof")
    return module_records, callsite_records, counts


def verify(
    archive: Path,
    source_proof: dict,
    dynamic_proof: dict,
    static_proof: dict,
    full_build_proof: dict,
    build_output_dir: Path,
    stage_dir: Path,
) -> dict:
    contract = load_contract()
    source = BUILD.validate_source(BUILD.load_source())
    if contract["runtime_id"] != source["runtime_id"]:
        raise StaticLoaderReachabilityError("reachability contract runtime identity drifted")
    if contract["input"]["source_archive_sha256"] != source["upstream"]["archive_sha256"]:
        raise StaticLoaderReachabilityError("reachability contract source archive digest drifted")
    expected_source_proof = BUILD.validate_archive(source, archive)
    if source_proof != expected_source_proof:
        raise StaticLoaderReachabilityError("source proof is not the proof of the supplied locked archive")
    expected_dynamic = DYNAMIC.discover(archive, source, source_proof)
    if dynamic_proof != expected_dynamic:
        raise StaticLoaderReachabilityError("dynamic source proof does not recompute from the supplied locked archive")
    expected_static = STATIC.classify(dynamic_proof)
    if static_proof != expected_static:
        raise StaticLoaderReachabilityError("static classification proof does not recompute from dynamic source evidence")
    stage_digest, triplet, stage_manifest = validate_full_build(full_build_proof, source, stage_dir)

    relative_paths = [
        contract["source_authority"]["configure_path"],
        contract["source_authority"]["makefile_macro_path"],
        *[module["makefile_source_path"] for module in contract["modules"]],
    ]
    members = extract_source_members(archive, source, relative_paths)
    source_info = source_semantics(members, contract)

    config_log, config_log_sha = read_bounded_text(build_output_dir / "config.log", "configure log")
    generated_makefile, generated_makefile_sha = read_bounded_text(build_output_dir / "Makefile", "generated Makefile")
    host = config_log_value(config_log, "host")
    host_os = config_log_value(config_log, "host_os")
    if host != triplet:
        raise StaticLoaderReachabilityError(f"configure host does not match full-build compiler triplet: {host} != {triplet}")
    if "linux" not in host_os or "musl" not in host_os:
        raise StaticLoaderReachabilityError(f"configure host_os is outside locked Linux/musl target: {host_os}")
    generated_subdirs = make_variable(generated_makefile, contract["source_authority"]["generated_subdirs_variable"])
    disabled_subdirs = make_variable(generated_makefile, contract["source_authority"]["generated_makefile_variable"])
    module_records, callsite_records, counts = evaluate_reachability(
        contract,
        static_proof,
        host_os,
        generated_subdirs,
        disabled_subdirs,
        stage_manifest,
        source_info,
    )

    core = {
        "runtime_id": source["runtime_id"],
        "source_archive_sha256": source["upstream"]["archive_sha256"],
        "source_proof_sha256": DYNAMIC.canonical_sha256(DYNAMIC.source_proof_core(source_proof)),
        "dynamic_source_inventory_sha256": dynamic_proof["inventory_sha256"],
        "static_classification_evidence_sha256": static_proof["evidence_sha256"],
        "full_build_proof_sha256": canonical_sha256(full_build_proof),
        "staging_manifest_sha256": stage_digest,
        "compiler_triplet": triplet,
        "configure_host": host,
        "configure_host_os": host_os,
        "configure_log_sha256": config_log_sha,
        "generated_makefile_sha256": generated_makefile_sha,
        "source_authority": source_info,
        "modules": module_records,
        "callsites": callsite_records,
        "counts": counts,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "static-loader-linux-reachability-verified-all-static-callsites-host-disabled-not-dynamic-inventory-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "source_archive_verified": True,
            "dynamic_source_recomputed": True,
            "static_classification_recomputed": True,
            "full_build_proof_verified": True,
            "configure_host_identity_verified": True,
            "configure_host_selection_semantics_verified": True,
            "generated_disabled_subdirs_verified": True,
            "staging_manifest_recomputed": True,
            "linux_build_reachability_verified": True,
            "static_target_runtime_resolution_complete": True,
            "configured_soname_caller_loader_context_complete": False,
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
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    verify_parser = sub.add_parser("verify")
    verify_parser.add_argument("--source-archive", type=Path, required=True)
    verify_parser.add_argument("--source-proof", type=Path, required=True)
    verify_parser.add_argument("--dynamic-source-proof", type=Path, required=True)
    verify_parser.add_argument("--static-classification-proof", type=Path, required=True)
    verify_parser.add_argument("--full-build-proof", type=Path, required=True)
    verify_parser.add_argument("--build-output-dir", type=Path, required=True)
    verify_parser.add_argument("--stage-dir", type=Path, required=True)
    verify_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility static loader Linux reachability contract: PASS")
        return 0
    result = verify(
        args.source_archive.resolve(),
        load_json(args.source_proof, "source proof"),
        load_json(args.dynamic_source_proof, "dynamic source proof"),
        load_json(args.static_classification_proof, "static classification proof"),
        load_json(args.full_build_proof, "full-build proof"),
        args.build_output_dir.resolve(),
        args.stage_dir.resolve(),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility static loader Linux reachability: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        StaticLoaderReachabilityError,
        BUILD.CompatibilityRuntimeBuildError,
        DYNAMIC.DynamicLoadDiscoveryError,
        STATIC.StaticTargetClassificationError,
        FULL.FullBuildProofError,
    ) as exc:
        print(f"windows-compat-runtime-static-loader-linux-reachability: {exc}", file=sys.stderr)
        raise SystemExit(2)
