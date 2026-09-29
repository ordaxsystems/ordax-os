#!/usr/bin/env python3
"""Resolve configured Wine SONAME_* dynamic-loader targets without execution.

Consumes the direct loader source proof, the real configure proof, generated
config.h, and the exact Alpine rootfs used by configure. Every SONAME_* symbol
observed at a direct dlopen callsite is classified as either disabled by
configure or resolved to the first compatible musl system-search pathname and
its exact Alpine package owner. Runtime-computed loader targets remain a
separate, explicitly incomplete gate.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-configured-soname-resolution.json"
DEPENDENCY_PROBE = HERE / "runtime_dependency_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-configured-soname-proof/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
SYMBOL_RE = re.compile(r"^SONAME_[A-Z0-9_]+$")
DEFINE_RE = re.compile(r'^\s*#\s*define\s+(SONAME_[A-Z0-9_]+)\s+("(?:\\.|[^"\\])*")\s*$')
UNDEF_RE = re.compile(r"^\s*/\*\s*#\s*undef\s+(SONAME_[A-Z0-9_]+)\s*\*/\s*$")
SAFE_SONAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9+._-]*\.so(?:\.[A-Za-z0-9+._-]+)*$")


class ConfiguredSonameError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ConfiguredSonameError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DEP = load_module("ordax_windows_compat_dependency_for_configured_sonames", DEPENDENCY_PROBE)


def canonical_sha256(value: object) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(data).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    try:
        with path.open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
    except OSError as exc:
        raise ConfiguredSonameError(f"cannot hash {path}: {exc}") from exc
    return digest.hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ConfiguredSonameError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ConfiguredSonameError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "configured SONAME contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-configured-soname-resolution/1":
        raise ConfiguredSonameError("unexpected configured SONAME contract schema")
    if contract.get("status") != "configured-soname-resolution-only-not-runtime-complete":
        raise ConfiguredSonameError("configured SONAME contract status drifted")
    inspection = contract.get("inspection", {})
    required_true = (
        "dynamic_source_digest_binding_required",
        "configure_proof_binding_required",
        "config_h_content_binding_required",
        "explicit_undefined_symbol_is_disabled",
        "defined_symbol_must_be_string_literal",
        "defined_soname_must_be_safe_basename",
        "rootfs_package_graph_must_match_configure_proof",
        "musl_system_search_order_required",
        "first_existing_pathname_must_be_compatible_elf",
        "exact_alpine_owner_required",
    )
    if any(inspection.get(key) is not True for key in required_true):
        raise ConfiguredSonameError("configured SONAME verification guarantees drifted")
    required_false = (
        "missing_requested_symbol_allowed",
        "runtime_computed_target_resolution_complete",
        "wrapper_call_graph_complete",
        "generated_source_inventory_complete",
        "dynamic_load_inventory_complete",
    )
    if any(inspection.get(key) is not False for key in required_false):
        raise ConfiguredSonameError("configured SONAME fail-closed boundary drifted")
    expected_elf = contract.get("input", {}).get("expected_elf")
    if expected_elf != {"class": 64, "machine": 62, "endianness": "little"}:
        raise ConfiguredSonameError("configured SONAME ELF identity drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise ConfiguredSonameError("configured SONAME contract claims promotion/execution authority")
    return contract


def dynamic_source_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "source_proof_sha256": proof.get("source_proof_sha256"),
        "c_archive_manifest_sha256": proof.get("c_archive_manifest_sha256"),
        "counts": proof.get("counts"),
        "callsites": proof.get("callsites"),
    }


def validate_dynamic_source_proof(proof: dict, contract: dict) -> tuple[str, dict[str, int]]:
    if proof.get("$schema") != contract["input"]["dynamic_source_proof_schema"]:
        raise ConfiguredSonameError("unexpected dynamic source proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id"):
        raise ConfiguredSonameError("dynamic source runtime identity drifted")
    digest = proof.get("inventory_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise ConfiguredSonameError("dynamic source inventory digest is invalid")
    if canonical_sha256(dynamic_source_core(proof)) != digest:
        raise ConfiguredSonameError("dynamic source inventory digest does not verify")

    callsites = proof.get("callsites")
    if not isinstance(callsites, list):
        raise ConfiguredSonameError("dynamic source callsites are missing")
    symbols: dict[str, int] = {}
    for item in callsites:
        if not isinstance(item, dict):
            raise ConfiguredSonameError("dynamic source callsite is invalid")
        target = item.get("target")
        if not isinstance(target, dict):
            raise ConfiguredSonameError("dynamic source callsite target is invalid")
        if target.get("kind") != "configured-soname-symbol":
            continue
        symbol = target.get("symbol")
        if not isinstance(symbol, str) or not SYMBOL_RE.fullmatch(symbol) or target.get("expression") != symbol:
            raise ConfiguredSonameError("configured SONAME callsite symbol is invalid")
        symbols[symbol] = symbols.get(symbol, 0) + 1
    if not symbols:
        raise ConfiguredSonameError("dynamic source proof contains no configured SONAME callsites")

    counts = proof.get("counts", {})
    if counts.get("configured_soname_symbol_targets") != sum(symbols.values()):
        raise ConfiguredSonameError("configured SONAME call count drifted")
    if counts.get("configured_soname_symbols") != dict(sorted(symbols.items())):
        raise ConfiguredSonameError("configured SONAME symbol inventory drifted")
    gates = proof.get("gates", {})
    for key in (
        "source_lock_verified",
        "source_proof_verified",
        "c_archive_manifest_bound",
        "direct_host_loader_calls_inventoried",
        "configured_soname_symbols_classified",
    ):
        if gates.get(key) is not True:
            raise ConfiguredSonameError(f"dynamic source prerequisite is not proven: {key}")
    for key in (
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
    ):
        if gates.get(key) is not False:
            raise ConfiguredSonameError(f"dynamic source proof crossed forbidden boundary: {key}")
    return digest, dict(sorted(symbols.items()))


def validate_configure_proof(proof: dict, contract: dict) -> str:
    if proof.get("$schema") != contract["input"]["configure_proof_schema"]:
        raise ConfiguredSonameError("unexpected configure proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id"):
        raise ConfiguredSonameError("configure proof runtime identity drifted")
    if proof.get("wine_version") != "11.0" or proof.get("configure_proof_passed") is not True:
        raise ConfiguredSonameError("configure proof is not authoritative")
    for key in (
        "package_versions_pinned",
        "full_build_proof_passed",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
    ):
        if proof.get(key) is not False:
            raise ConfiguredSonameError(f"configure proof crossed forbidden boundary: {key}")
    packages = proof.get("resolved_installed_packages")
    if not isinstance(packages, dict) or not packages:
        raise ConfiguredSonameError("configure proof installed package graph is missing")
    return canonical_sha256(proof)


def parse_config_h(path: Path, requested: dict[str, int]) -> tuple[str, dict[str, dict]]:
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeDecodeError) as exc:
        raise ConfiguredSonameError(f"cannot read generated config.h: {exc}") from exc
    states: dict[str, dict] = {}
    for line_number, line in enumerate(text.splitlines(), 1):
        defined = DEFINE_RE.match(line)
        undefined = UNDEF_RE.match(line)
        match = defined or undefined
        if match is None:
            continue
        symbol = match.group(1)
        if symbol not in requested:
            continue
        if symbol in states:
            raise ConfiguredSonameError(f"duplicate config.h state for {symbol}")
        if defined:
            literal = defined.group(2)
            try:
                value = ast.literal_eval(literal)
            except (ValueError, SyntaxError) as exc:
                raise ConfiguredSonameError(f"invalid configured SONAME literal for {symbol}") from exc
            if not isinstance(value, str) or not SAFE_SONAME_RE.fullmatch(value):
                raise ConfiguredSonameError(f"unsafe configured SONAME value for {symbol}: {value!r}")
            if "/" in value or "\\" in value or value in {".", ".."}:
                raise ConfiguredSonameError(f"configured SONAME is not a basename: {symbol}={value!r}")
            states[symbol] = {
                "state": "defined",
                "soname": value,
                "config_line": line_number,
                "source_calls": requested[symbol],
            }
        else:
            states[symbol] = {
                "state": "disabled-by-configure",
                "config_line": line_number,
                "source_calls": requested[symbol],
            }
    missing = sorted(set(requested) - set(states))
    if missing:
        raise ConfiguredSonameError(f"requested configured SONAME symbols missing from config.h: {missing}")
    return hashlib.sha256(text.encode("utf-8")).hexdigest(), dict(sorted(states.items()))


def verify_rootfs_package_graph(rootfs: Path, configure_proof: dict) -> tuple[dict, dict, str]:
    try:
        versions, owners = DEP.parse_apk_installed(rootfs)
    except DEP.RuntimeDependencyError as exc:
        raise ConfiguredSonameError(str(exc)) from exc
    expected = configure_proof.get("resolved_installed_packages")
    if dict(sorted(versions.items())) != expected:
        raise ConfiguredSonameError("rootfs installed package graph does not match configure proof")
    database = rootfs / "lib/apk/db/installed"
    return versions, owners, sha256_file(database)


def resolve_defined_symbol(
    symbol: str,
    state: dict,
    rootfs: Path,
    expected_elf: dict,
    versions: dict,
    owners: dict,
) -> dict:
    soname = state["soname"]
    try:
        search = DEP.musl_system_search_directories(rootfs, expected_elf)
    except DEP.RuntimeDependencyError as exc:
        raise ConfiguredSonameError(str(exc)) from exc
    expected_identity = DEP.elf_identity(expected_elf)
    for position, item in enumerate(search):
        directory = item["directory"]
        relative = PurePosixPath(directory) / soname
        candidate = rootfs.joinpath(*relative.parts)
        if not (candidate.exists() or candidate.is_symlink()):
            continue
        try:
            canonical = DEP.resolve_rooted_path(rootfs, candidate)
            elf = DEP.parse_elf_dynamic(rootfs / canonical)
        except (DEP.RuntimeDependencyError, OSError) as exc:
            raise ConfiguredSonameError(f"invalid first pathname for {symbol}={soname}: {exc}") from exc
        if elf is None:
            raise ConfiguredSonameError(f"non-ELF first pathname for {symbol}={soname}: /{relative}")
        actual_identity = DEP.elf_identity(elf)
        if actual_identity != expected_identity:
            raise ConfiguredSonameError(
                f"incompatible first pathname for {symbol}={soname}: "
                f"expected={expected_identity} actual={actual_identity} path=/{relative}"
            )
        candidate_record = {
            "candidate_paths": [relative.as_posix()],
            "canonical_path": canonical,
        }
        try:
            package, version = DEP.require_single_apk_owner(candidate_record, owners)
        except DEP.RuntimeDependencyError as exc:
            raise ConfiguredSonameError(str(exc)) from exc
        if versions.get(package) != version:
            raise ConfiguredSonameError(f"package version drifted for {symbol}: {package}")
        return {
            **state,
            "path": relative.as_posix(),
            "canonical_path": canonical,
            "elf": {
                "class": elf["class"],
                "machine": elf["machine"],
                "endianness": elf["endianness"],
            },
            "package": package,
            "version": version,
            "search_directory": "/" + directory,
            "search_source": item["source"],
            "search_position": position,
        }
    raise ConfiguredSonameError(f"configured SONAME has no rootfs pathname: {symbol}={soname}")


def resolve(
    dynamic_source: dict,
    configure_proof: dict,
    config_h: Path,
    rootfs: Path,
) -> dict:
    contract = load_contract()
    dynamic_digest, requested = validate_dynamic_source_proof(dynamic_source, contract)
    configure_digest = validate_configure_proof(configure_proof, contract)
    if not rootfs.is_dir():
        raise ConfiguredSonameError("configure rootfs is missing")
    config_digest, states = parse_config_h(config_h, requested)
    versions, owners, apk_db_digest = verify_rootfs_package_graph(rootfs, configure_proof)
    expected_elf = contract["input"]["expected_elf"]

    resolved: dict[str, dict] = {}
    for symbol, state in states.items():
        if state["state"] == "disabled-by-configure":
            resolved[symbol] = state
        else:
            resolved[symbol] = resolve_defined_symbol(
                symbol, state, rootfs, expected_elf, versions, owners
            )

    defined_symbols = [value for value in resolved.values() if value["state"] == "defined"]
    disabled_symbols = [value for value in resolved.values() if value["state"] == "disabled-by-configure"]
    packages = sorted({value["package"] for value in defined_symbols})
    counts = {
        "requested_symbols": len(requested),
        "requested_callsites": sum(requested.values()),
        "defined_symbols": len(defined_symbols),
        "disabled_symbols": len(disabled_symbols),
        "defined_callsites": sum(value["source_calls"] for value in defined_symbols),
        "disabled_callsites": sum(value["source_calls"] for value in disabled_symbols),
        "resolved_packages": len(packages),
    }
    if counts["defined_symbols"] + counts["disabled_symbols"] != counts["requested_symbols"]:
        raise ConfiguredSonameError("configured SONAME symbol count drifted")
    if counts["defined_callsites"] + counts["disabled_callsites"] != counts["requested_callsites"]:
        raise ConfiguredSonameError("configured SONAME callsite count drifted")

    core = {
        "runtime_id": contract["runtime_id"],
        "dynamic_source_inventory_sha256": dynamic_digest,
        "configure_proof_sha256": configure_digest,
        "config_h_sha256": config_digest,
        "apk_installed_sha256": apk_db_digest,
        "expected_elf": expected_elf,
        "symbols": resolved,
        "counts": counts,
        "resolved_packages": packages,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "configured-sonames-resolved-runtime-computed-targets-open",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "dynamic_source_proof_verified": True,
            "configure_proof_verified": True,
            "config_h_bound": True,
            "rootfs_package_graph_verified": True,
            "configured_soname_values_resolved": True,
            "configured_soname_rootfs_resolution_verified": True,
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
    parser.add_argument("command", choices=["check", "resolve"])
    parser.add_argument("--dynamic-source-proof", type=Path)
    parser.add_argument("--configure-proof", type=Path)
    parser.add_argument("--config-h", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility configured SONAME resolution contract: PASS")
        return 0
    if not all((args.dynamic_source_proof, args.configure_proof, args.config_h, args.rootfs, args.out)):
        raise ConfiguredSonameError(
            "resolve requires --dynamic-source-proof, --configure-proof, --config-h, --rootfs and --out"
        )
    result = resolve(
        load_json(args.dynamic_source_proof, "dynamic source proof"),
        load_json(args.configure_proof, "configure proof"),
        args.config_h.resolve(),
        args.rootfs.resolve(),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility configured SONAME resolution: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except ConfiguredSonameError as exc:
        print(f"windows-compat-runtime-configured-soname: {exc}", file=sys.stderr)
        raise SystemExit(2)
