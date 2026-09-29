#!/usr/bin/env python3
"""Discover named C wrapper candidates around direct host loader calls.

This proof is deliberately narrower than wrapper-call-graph completeness. It
recomputes the authoritative direct dlopen/dlmopen inventory from the exact
Wine archive, maps every direct loader call to one top-level C function, then
follows ordinary named function calls to those functions transitively.

Static functions are translation-unit scoped. Cross-translation-unit calls to
non-static functions are followed only when the function name has exactly one
global definition in the scanned C source. Ambiguous global names are recorded
as an open boundary instead of being guessed by source order or module layout.
Function-pointer aliases, macro-expanded calls, conditional-preprocessor call
graphs and generated sources remain explicit open boundaries.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT_PATH = HERE / "runtime-loader-wrapper-discovery.json"
DYNAMIC_PATH = HERE / "runtime_dynamic_load_source_probe.py"
BUILD_PATH = HERE / "build.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-loader-wrapper-discovery-proof/1"
CONTROL_WORDS = {"if", "for", "while", "switch", "return", "sizeof", "_Static_assert"}
DIRECTIVE_RE = re.compile(r"^#\s*([A-Za-z_][A-Za-z0-9_]*)")
CONDITIONAL_START = {"if", "ifdef", "ifndef"}
CONDITIONAL_BRANCH = {"elif", "else"}


class LoaderWrapperDiscoveryError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise LoaderWrapperDiscoveryError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DYNAMIC = load_module("ordax_wrapper_dynamic_source", DYNAMIC_PATH)
BUILD = load_module("ordax_wrapper_source_lock", BUILD_PATH)


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise LoaderWrapperDiscoveryError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise LoaderWrapperDiscoveryError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT_PATH, "loader wrapper discovery contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-loader-wrapper-discovery/1":
        raise LoaderWrapperDiscoveryError("unexpected loader wrapper discovery schema")
    if contract.get("status") != "named-wrapper-discovery-only-not-call-graph-complete":
        raise LoaderWrapperDiscoveryError("loader wrapper discovery status drifted")
    required_true = (
        "direct_loader_calls_must_map_to_exactly_one_top_level_function",
        "static_function_callers_are_translation_unit_scoped",
        "global_function_callers_may_cross_translation_units",
        "named_calls_are_followed_transitively_to_fixpoint",
        "line_numbers_are_not_independent_authority",
        "preprocessor_logical_lines_excluded_from_c_structure",
        "conditional_preprocessor_regions_excluded_from_c_structure",
    )
    discovery = contract.get("discovery", {})
    if any(discovery.get(key) is not True for key in required_true):
        raise LoaderWrapperDiscoveryError("loader wrapper discovery guarantees drifted")
    required_false = (
        "function_pointer_aliases_complete",
        "macro_expansion_call_graph_complete",
        "conditional_preprocessor_call_graph_complete",
        "generated_source_inventory_complete",
        "wrapper_call_graph_complete",
        "dynamic_load_inventory_complete",
    )
    if any(discovery.get(key) is not False for key in required_false):
        raise LoaderWrapperDiscoveryError("loader wrapper open boundaries drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise LoaderWrapperDiscoveryError("loader wrapper contract claims promotion or execution authority")
    if contract.get("runtime_id") != "wine-11.0-wow64-x86_64-candidate":
        raise LoaderWrapperDiscoveryError("loader wrapper runtime identity drifted")
    return contract


def _blank_range(chars: list[str], start: int, end: int) -> None:
    for index in range(start, end):
        if chars[index] not in {"\r", "\n"}:
            chars[index] = " "


def structural_code_view(code_only: str, path: str = "<fixture>") -> str:
    """Return an offset-preserving C-structure view.

    Preprocessor logical lines are not C structure. Conditional regions are
    also removed because concatenating mutually-exclusive branches can create
    impossible brace/parenthesis structures. This proof does not evaluate a
    configure-specific preprocessor environment, so calls that exist only in
    those regions remain part of the explicit conditional call-graph boundary.
    """
    chars = list(code_only)
    offset = 0
    conditional_depth = 0
    macro_continuation = False

    for line_number, line in enumerate(code_only.splitlines(keepends=True), 1):
        logical = line.rstrip("\r\n")
        stripped = logical.lstrip()
        directive = None
        if not macro_continuation and stripped.startswith("#"):
            match = DIRECTIVE_RE.match(stripped)
            directive = match.group(1) if match else ""

        if macro_continuation or conditional_depth > 0 or directive is not None:
            _blank_range(chars, offset, offset + len(line))

        if macro_continuation:
            macro_continuation = logical.rstrip().endswith("\\")
            offset += len(line)
            continue

        if directive in CONDITIONAL_START:
            conditional_depth += 1
        elif directive in CONDITIONAL_BRANCH:
            if conditional_depth == 0:
                raise LoaderWrapperDiscoveryError(
                    f"unmatched preprocessor #{directive}: {path}:{line_number}"
                )
        elif directive == "endif":
            if conditional_depth == 0:
                raise LoaderWrapperDiscoveryError(
                    f"unmatched preprocessor #endif: {path}:{line_number}"
                )
            conditional_depth -= 1
        elif directive == "define" and logical.rstrip().endswith("\\"):
            macro_continuation = True

        offset += len(line)

    if macro_continuation:
        raise LoaderWrapperDiscoveryError(f"unterminated preprocessor macro continuation: {path}")
    if conditional_depth:
        raise LoaderWrapperDiscoveryError(f"unterminated conditional preprocessor region: {path}")
    return "".join(chars)


def _matching_open_paren(text: str, close_index: int) -> int | None:
    depth = 0
    for index in range(close_index, -1, -1):
        ch = text[index]
        if ch == ")":
            depth += 1
        elif ch == "(":
            depth -= 1
            if depth == 0:
                return index
    return None


def _matching_close_brace(text: str, open_index: int, path: str) -> int:
    depth = 0
    for index in range(open_index, len(text)):
        ch = text[index]
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return index
    line = text.count("\n", 0, open_index) + 1
    raise LoaderWrapperDiscoveryError(
        f"unterminated top-level brace while parsing C source: {path}:{line}"
    )


def _header_start(text: str, brace_index: int) -> int:
    return max(text.rfind(";", 0, brace_index), text.rfind("}", 0, brace_index)) + 1


def _function_header(code_only: str, brace_index: int) -> tuple[str, bool, int] | None:
    start = _header_start(code_only, brace_index)
    stripped = code_only[start:brace_index].rstrip()
    if not stripped or not stripped.endswith(")"):
        return None
    open_local = _matching_open_paren(stripped, len(stripped) - 1)
    if open_local is None:
        return None
    prefix = stripped[:open_local].rstrip()
    match = re.search(r"([A-Za-z_][A-Za-z0-9_]*)\s*$", prefix)
    if match is None or match.group(1) in CONTROL_WORDS:
        return None
    name = match.group(1)
    before_name = prefix[:match.start(1)]
    is_static = re.search(r"(?:^|\s)static(?:\s|$)", before_name) is not None
    return name, is_static, start


def parse_functions(path: str, text: str) -> list[dict]:
    _, lexical_code = DYNAMIC.lexical_views(text)
    code_only = structural_code_view(lexical_code, path)
    functions: list[dict] = []
    index = 0
    while index < len(code_only):
        brace = code_only.find("{", index)
        if brace < 0:
            break
        close = _matching_close_brace(code_only, brace, path)
        header = _function_header(code_only, brace)
        if header is not None:
            name, is_static, header_start = header
            functions.append({
                "path": path,
                "name": name,
                "static": is_static,
                "header_start": header_start,
                "body_start": brace + 1,
                "body_end": close,
                "start_line": text.count("\n", 0, header_start) + 1,
                "end_line": text.count("\n", 0, close) + 1,
                "body_code": code_only[brace + 1:close],
            })
        index = close + 1
    return functions


def line_column_to_offset(text: str, line: int, column: int) -> int:
    if line < 1 or column < 1:
        raise LoaderWrapperDiscoveryError("invalid source line/column in direct loader proof")
    starts = [0]
    starts.extend(match.end() for match in re.finditer("\n", text))
    if line > len(starts):
        raise LoaderWrapperDiscoveryError("direct loader proof line exceeds source member")
    offset = starts[line - 1] + column - 1
    if offset >= len(text):
        raise LoaderWrapperDiscoveryError("direct loader proof column exceeds source member")
    return offset


def function_key(function: dict) -> str:
    scope = "static" if function["static"] else "global"
    return f"{scope}:{function['path']}:{function['name']}"


def function_identity(function: dict) -> dict:
    return {
        "key": function_key(function),
        "path": function["path"],
        "name": function["name"],
        "static": function["static"],
        "start_line": function["start_line"],
        "end_line": function["end_line"],
    }


def map_direct_calls(dynamic_proof: dict, source_texts: dict[str, str], functions_by_path: dict[str, list[dict]]) -> tuple[list[dict], dict[str, dict]]:
    mapped: list[dict] = []
    direct_functions: dict[str, dict] = {}
    for call in dynamic_proof.get("callsites", []):
        path = call.get("path")
        line = call.get("line")
        column = call.get("column")
        if not isinstance(path, str) or not isinstance(line, int) or not isinstance(column, int):
            raise LoaderWrapperDiscoveryError("invalid direct loader callsite record")
        text = source_texts.get(path)
        if text is None:
            raise LoaderWrapperDiscoveryError(f"direct loader source member missing: {path}")
        offset = line_column_to_offset(text, line, column)
        matches = [f for f in functions_by_path.get(path, []) if f["body_start"] <= offset < f["body_end"]]
        if len(matches) != 1:
            raise LoaderWrapperDiscoveryError(
                f"direct loader call must map to exactly one top-level function: {path}:{line}:{column} matches={len(matches)}"
            )
        function = matches[0]
        identity = function_identity(function)
        direct_functions[identity["key"]] = identity
        mapped.append({
            "path": path,
            "line": line,
            "column": column,
            "api": call.get("api"),
            "target_kind": call.get("target", {}).get("kind"),
            "target_expression": call.get("target", {}).get("expression"),
            "function_key": identity["key"],
            "function_name": identity["name"],
            "function_static": identity["static"],
        })
    if len(mapped) != dynamic_proof.get("counts", {}).get("direct_loader_calls"):
        raise LoaderWrapperDiscoveryError("mapped direct loader call count drifted")
    mapped.sort(key=lambda item: (item["path"], item["line"], item["column"], item["api"] or ""))
    return mapped, direct_functions


def global_definition_counts(functions: list[dict]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for function in functions:
        if not function["static"]:
            counts[function["name"]] = counts.get(function["name"], 0) + 1
    return counts


def named_calls(caller: dict, target: dict, global_counts: dict[str, int]) -> tuple[int, bool]:
    if target["static"]:
        if caller["path"] != target["path"]:
            return 0, False
    elif caller["path"] != target["path"] and global_counts.get(target["name"], 0) != 1:
        return 0, True
    pattern = re.compile(rf"\b{re.escape(target['name'])}\s*\(")
    return len(pattern.findall(caller["body_code"])), False


def discover_named_graph(functions: list[dict], direct_functions: dict[str, dict]) -> tuple[list[dict], list[dict], list[str]]:
    function_index = {function_key(function): function for function in functions}
    if len(function_index) != len(functions):
        raise LoaderWrapperDiscoveryError("function identity collision in parsed source graph")
    global_counts = global_definition_counts(functions)
    reached = set(direct_functions)
    frontier = set(direct_functions)
    edges: set[tuple[str, str, int]] = set()
    ambiguous_names: set[str] = set()

    while frontier:
        next_frontier: set[str] = set()
        targets = [function_index[key] for key in sorted(frontier)]
        for caller in functions:
            caller_key = function_key(caller)
            for target in targets:
                target_key = function_key(target)
                count, ambiguous = named_calls(caller, target, global_counts)
                if ambiguous:
                    ambiguous_names.add(target["name"])
                    continue
                if not count:
                    continue
                edges.add((caller_key, target_key, count))
                if caller_key not in reached:
                    reached.add(caller_key)
                    next_frontier.add(caller_key)
        frontier = next_frontier

    wrappers = [function_identity(function_index[key]) for key in sorted(reached - set(direct_functions))]
    edge_records = [
        {"caller_key": caller, "callee_key": callee, "named_call_count": count}
        for caller, callee, count in sorted(edges)
    ]
    return wrappers, edge_records, sorted(ambiguous_names)


def build_proof(dynamic_proof: dict, entries: list[dict], sources: list[dict], contract: dict) -> dict:
    source_texts = {item["path"]: item["text"] for item in sources}
    all_functions: list[dict] = []
    functions_by_path: dict[str, list[dict]] = {}
    for source in sources:
        parsed = parse_functions(source["path"], source["text"])
        functions_by_path[source["path"]] = parsed
        all_functions.extend(parsed)
    mapped_calls, direct_functions = map_direct_calls(dynamic_proof, source_texts, functions_by_path)
    wrappers, edges, ambiguous_names = discover_named_graph(all_functions, direct_functions)

    direct_records = sorted(direct_functions.values(), key=lambda item: item["key"])
    counts = {
        "c_archive_members_scanned": len(entries),
        "parsed_top_level_functions": len(all_functions),
        "direct_loader_calls": len(mapped_calls),
        "direct_loader_functions": len(direct_records),
        "transitive_named_wrapper_functions": len(wrappers),
        "named_wrapper_edges": len(edges),
        "ambiguous_global_callee_names": len(ambiguous_names),
    }
    core = {
        "runtime_id": contract["runtime_id"],
        "source_archive_sha256": contract["input"]["source_archive_sha256"],
        "dynamic_source_inventory_sha256": dynamic_proof["inventory_sha256"],
        "c_archive_manifest_sha256": dynamic_proof["c_archive_manifest_sha256"],
        "counts": counts,
        "direct_loader_functions": direct_records,
        "mapped_direct_calls": mapped_calls,
        "named_wrappers": wrappers,
        "named_edges": edges,
        "ambiguous_global_callee_names": ambiguous_names,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "named-wrapper-candidates-discovered-not-wrapper-call-graph-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "gates": {
            "dynamic_source_proof_recomputed": True,
            "all_direct_loader_calls_mapped_to_functions": True,
            "named_wrapper_candidates_discovered": True,
            "named_wrapper_transitive_fixpoint_reached": True,
            "ambiguous_global_symbol_resolution_complete": False,
            "function_pointer_aliases_complete": False,
            "macro_expansion_call_graph_complete": False,
            "conditional_preprocessor_call_graph_complete": False,
            "generated_source_inventory_complete": False,
            "wrapper_call_graph_complete": False,
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


def discover(archive: Path, source_proof: dict, dynamic_proof: dict) -> dict:
    contract = load_contract()
    source = BUILD.validate_source(BUILD.load_source())
    if source["runtime_id"] != contract["runtime_id"]:
        raise LoaderWrapperDiscoveryError("source lock runtime identity drifted")
    if source["upstream"]["archive_sha256"] != contract["input"]["source_archive_sha256"]:
        raise LoaderWrapperDiscoveryError("source archive digest drifted from wrapper contract")
    expected_source_proof = BUILD.validate_archive(source, archive)
    if source_proof != expected_source_proof:
        raise LoaderWrapperDiscoveryError("source proof is not the proof of the supplied locked archive")
    expected_dynamic = DYNAMIC.discover(archive, source, source_proof)
    if dynamic_proof != expected_dynamic:
        raise LoaderWrapperDiscoveryError("dynamic source proof does not recompute from the supplied locked archive")
    dynamic_contract = DYNAMIC.load_contract()
    entries, sources, _ = DYNAMIC.read_relevant_members(archive, dynamic_contract)
    if canonical_sha256(entries) != dynamic_proof["c_archive_manifest_sha256"]:
        raise LoaderWrapperDiscoveryError("C archive manifest changed during wrapper discovery")
    return build_proof(dynamic_proof, entries, sources, contract)


def main() -> int:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    run = sub.add_parser("discover")
    run.add_argument("--archive", type=Path, required=True)
    run.add_argument("--source-proof", type=Path, required=True)
    run.add_argument("--dynamic-source-proof", type=Path, required=True)
    run.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility named loader wrapper discovery contract: PASS")
        return 0
    proof = discover(
        args.archive.resolve(),
        load_json(args.source_proof, "source proof"),
        load_json(args.dynamic_source_proof, "dynamic source proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility named loader wrapper discovery: PASS")
    print(json.dumps(proof["counts"], sort_keys=True))
    print("evidence:", proof["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        LoaderWrapperDiscoveryError,
        BUILD.CompatibilityRuntimeBuildError,
        DYNAMIC.DynamicLoadDiscoveryError,
    ) as exc:
        print(f"windows-compat-runtime-loader-wrappers: {exc}", file=sys.stderr)
        raise SystemExit(2)
