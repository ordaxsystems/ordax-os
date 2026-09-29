#!/usr/bin/env python3
"""Inventory direct host dynamic-loader callsites in locked Wine C sources.

This is deliberately a source-callsite discovery proof, not a complete runtime
dependency inventory. It binds direct dlopen/dlmopen sites to the exact locked
Wine source archive and to a deterministic manifest of the scanned C files.
Wrappers, generated sources, plugin naming conventions, and computed runtime
targets remain separate gates.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-dynamic-load-discovery.json"
SOURCE_LOCK = HERE / "source.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CALL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
STRING_TOKEN_RE = re.compile(r'(?:u8|u|U|L)?"(?:\\.|[^"\\])*"')
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-dynamic-load-source-proof/1"


class DynamicLoadDiscoveryError(RuntimeError):
    pass


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise DynamicLoadDiscoveryError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise DynamicLoadDiscoveryError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    contract = load_json(CONTRACT, "dynamic-load discovery contract")
    if contract.get("$schema") != "prototype-ordax.windows-compat-runtime-dynamic-load-discovery/1":
        raise DynamicLoadDiscoveryError("unexpected dynamic-load discovery contract schema")
    if contract.get("status") != "source-callsite-discovery-only-not-runtime-complete":
        raise DynamicLoadDiscoveryError("dynamic-load discovery status drifted")
    inspection = contract.get("inspection", {})
    required_true = (
        "comments_and_literals_must_not_create_callsites",
        "source_manifest_binding_required",
        "literal_target_classification_required",
        "dynamic_expression_classification_required",
    )
    if any(inspection.get(key) is not True for key in required_true):
        raise DynamicLoadDiscoveryError("dynamic-load source inspection guarantees drifted")
    required_false = (
        "unparseable_direct_call_allowed",
        "relevant_source_symlink_allowed",
        "wrapper_call_graph_complete",
        "generated_source_inventory_complete",
        "dynamic_load_inventory_complete",
    )
    if any(inspection.get(key) is not False for key in required_false):
        raise DynamicLoadDiscoveryError("dynamic-load source discovery scope drifted")
    apis = inspection.get("direct_host_loader_apis")
    if apis != {"dlopen": 0, "dlmopen": 1}:
        raise DynamicLoadDiscoveryError("direct host loader API model drifted")
    promotion = contract.get("promotion", {})
    if not promotion or any(value is not False for value in promotion.values()):
        raise DynamicLoadDiscoveryError("dynamic-load source discovery claims promotion or execution authority")
    return contract


def validate_source_lock(source: dict, contract: dict) -> None:
    if source.get("$schema") != contract["input"]["source_lock_schema"]:
        raise DynamicLoadDiscoveryError("unexpected source lock schema")
    if source.get("runtime_id") != contract.get("runtime_id"):
        raise DynamicLoadDiscoveryError("source lock runtime identity drifted")
    upstream = source.get("upstream", {})
    digest = upstream.get("archive_sha256")
    if not isinstance(digest, str) or not SHA256_RE.fullmatch(digest):
        raise DynamicLoadDiscoveryError("source archive digest is invalid")
    if digest != contract["input"]["source_archive_sha256"]:
        raise DynamicLoadDiscoveryError("source archive digest drifted from dynamic-load contract")


def validate_full_build_proof(proof: dict, contract: dict) -> None:
    if proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise DynamicLoadDiscoveryError("unexpected full build proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id"):
        raise DynamicLoadDiscoveryError("full build runtime identity drifted")
    gates = proof.get("gates")
    if not isinstance(gates, dict):
        raise DynamicLoadDiscoveryError("full build gates must be an object")
    for key in ("source_lock_verified", "full_build_proof_passed", "staged_install_completed"):
        if gates.get(key) is not True:
            raise DynamicLoadDiscoveryError(f"full build prerequisite is not proven: {key}")
    for key in (
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "wine_executed",
        "windows_payload_executed",
    ):
        if gates.get(key) is not False:
            raise DynamicLoadDiscoveryError(f"full build crossed forbidden runtime boundary: {key}")


def _replace_span(chars: list[str], start: int, end: int) -> None:
    for index in range(start, end):
        if chars[index] != "\n":
            chars[index] = " "


def lexical_views(text: str) -> tuple[str, str]:
    """Return comments-removed and code-only views with preserved positions."""
    comments_removed = list(text)
    code_only = list(text)
    i = 0
    length = len(text)
    while i < length:
        ch = text[i]
        nxt = text[i + 1] if i + 1 < length else ""
        if ch == "/" and nxt == "/":
            end = text.find("\n", i + 2)
            if end < 0:
                end = length
            _replace_span(comments_removed, i, end)
            _replace_span(code_only, i, end)
            i = end
            continue
        if ch == "/" and nxt == "*":
            end = text.find("*/", i + 2)
            if end < 0:
                raise DynamicLoadDiscoveryError("unterminated block comment in C source")
            end += 2
            _replace_span(comments_removed, i, end)
            _replace_span(code_only, i, end)
            i = end
            continue
        if ch in {'"', "'"}:
            quote = ch
            start = i
            i += 1
            while i < length:
                if text[i] == "\\":
                    i += 2
                    continue
                if text[i] == quote:
                    i += 1
                    break
                i += 1
            else:
                raise DynamicLoadDiscoveryError("unterminated string/char literal in C source")
            _replace_span(code_only, start, i)
            continue
        i += 1
    return "".join(comments_removed), "".join(code_only)


def extract_arguments(text: str, open_paren: int) -> list[str]:
    if open_paren >= len(text) or text[open_paren] != "(":
        raise DynamicLoadDiscoveryError("loader call opening parenthesis drifted")
    args: list[str] = []
    start = open_paren + 1
    i = start
    paren = bracket = brace = 0
    quote: str | None = None
    while i < len(text):
        ch = text[i]
        if quote is not None:
            if ch == "\\":
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue
        if ch in {'"', "'"}:
            quote = ch
            i += 1
            continue
        if ch == "(":
            paren += 1
        elif ch == ")":
            if paren == 0 and bracket == 0 and brace == 0:
                tail = text[start:i].strip()
                if tail or args:
                    args.append(tail)
                return args
            if paren == 0:
                raise DynamicLoadDiscoveryError("unbalanced loader call parenthesis")
            paren -= 1
        elif ch == "[":
            bracket += 1
        elif ch == "]":
            if bracket == 0:
                raise DynamicLoadDiscoveryError("unbalanced loader call bracket")
            bracket -= 1
        elif ch == "{":
            brace += 1
        elif ch == "}":
            if brace == 0:
                raise DynamicLoadDiscoveryError("unbalanced loader call brace")
            brace -= 1
        elif ch == "," and paren == 0 and bracket == 0 and brace == 0:
            args.append(text[start:i].strip())
            start = i + 1
        i += 1
    raise DynamicLoadDiscoveryError("unterminated direct host loader call")


def classify_target(expression: str) -> dict:
    value = expression.strip()
    if value in {"NULL", "0"}:
        return {"kind": "null", "expression": value}
    tokens = list(STRING_TOKEN_RE.finditer(value))
    if tokens:
        cursor = 0
        literals: list[str] = []
        valid = True
        for token in tokens:
            if value[cursor:token.start()].strip():
                valid = False
                break
            literals.append(token.group(0))
            cursor = token.end()
        if valid and not value[cursor:].strip():
            return {"kind": "static-string", "expression": value, "literal_tokens": literals}
    return {"kind": "dynamic-expression", "expression": value}


def relevant_sources(source_root: Path, extensions: set[str]) -> list[Path]:
    if not source_root.is_dir():
        raise DynamicLoadDiscoveryError("Wine source root is missing")
    files: list[Path] = []
    for path in sorted(source_root.rglob("*")):
        if path.suffix not in extensions:
            continue
        if path.is_symlink():
            raise DynamicLoadDiscoveryError(f"relevant source symlink is not modeled: {path}")
        if path.is_file():
            files.append(path)
    if not files:
        raise DynamicLoadDiscoveryError("locked Wine source produced no relevant C files")
    return files


def source_manifest(source_root: Path, files: list[Path]) -> tuple[str, int]:
    entries = []
    total_bytes = 0
    root = source_root.resolve()
    for path in files:
        resolved = path.resolve()
        try:
            relative = resolved.relative_to(root).as_posix()
        except ValueError as exc:
            raise DynamicLoadDiscoveryError(f"source file escaped root: {path}") from exc
        data = path.read_bytes()
        total_bytes += len(data)
        entries.append({"path": relative, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()})
    return canonical_sha256(entries), total_bytes


def scan_file(source_root: Path, path: Path, api_map: dict[str, int]) -> list[dict]:
    try:
        text = path.read_text(encoding="utf-8", errors="strict")
    except (OSError, UnicodeDecodeError) as exc:
        raise DynamicLoadDiscoveryError(f"cannot read C source {path}: {exc}") from exc
    comments_removed, code_only = lexical_views(text)
    relative = path.resolve().relative_to(source_root.resolve()).as_posix()
    records: list[dict] = []
    for match in CALL_RE.finditer(code_only):
        api = match.group(1)
        if api not in api_map:
            continue
        open_paren = code_only.find("(", match.start(1) + len(api), match.end())
        if open_paren < 0:
            raise DynamicLoadDiscoveryError(f"cannot locate loader call parenthesis: {relative}")
        args = extract_arguments(comments_removed, open_paren)
        target_index = api_map[api]
        if target_index >= len(args):
            line = text.count("\n", 0, match.start()) + 1
            raise DynamicLoadDiscoveryError(
                f"direct host loader call lacks modeled target argument: {relative}:{line}:{api}"
            )
        line = text.count("\n", 0, match.start()) + 1
        line_start = text.rfind("\n", 0, match.start()) + 1
        column = match.start() - line_start + 1
        records.append(
            {
                "path": relative,
                "line": line,
                "column": column,
                "api": api,
                "target_argument_index": target_index,
                "target": classify_target(args[target_index]),
            }
        )
    return records


def discover(source_root: Path, source_lock: dict, full_build_proof: dict) -> dict:
    contract = load_contract()
    validate_source_lock(source_lock, contract)
    validate_full_build_proof(full_build_proof, contract)
    extensions = set(contract["input"]["source_extensions"])
    if extensions != {".c"}:
        raise DynamicLoadDiscoveryError("dynamic-load source extension model drifted")
    files = relevant_sources(source_root, extensions)
    manifest_sha, total_bytes = source_manifest(source_root, files)
    api_map = contract["inspection"]["direct_host_loader_apis"]
    callsites: list[dict] = []
    for path in files:
        callsites.extend(scan_file(source_root, path, api_map))
    callsites.sort(key=lambda item: (item["path"], item["line"], item["column"], item["api"]))
    if not callsites:
        raise DynamicLoadDiscoveryError("locked Wine C source produced no modeled direct host loader callsites")
    kinds = {"static-string": 0, "dynamic-expression": 0, "null": 0}
    apis: dict[str, int] = {name: 0 for name in api_map}
    for item in callsites:
        kinds[item["target"]["kind"]] += 1
        apis[item["api"]] += 1
    counts = {
        "c_files_scanned": len(files),
        "c_source_bytes": total_bytes,
        "direct_loader_calls": len(callsites),
        "static_string_targets": kinds["static-string"],
        "dynamic_expression_targets": kinds["dynamic-expression"],
        "null_targets": kinds["null"],
        "calls_by_api": dict(sorted(apis.items())),
    }
    core = {
        "runtime_id": contract["runtime_id"],
        "source_archive_sha256": source_lock["upstream"]["archive_sha256"],
        "c_source_manifest_sha256": manifest_sha,
        "counts": counts,
        "callsites": callsites,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "direct-host-loader-source-sites-discovered-not-runtime-complete",
        **core,
        "inventory_sha256": canonical_sha256(core),
        "gates": {
            "source_lock_verified": True,
            "full_build_proof_verified": True,
            "c_source_manifest_bound": True,
            "direct_host_loader_calls_inventoried": True,
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
    parser.add_argument("command", choices=["check", "discover"])
    parser.add_argument("--source-dir", type=Path)
    parser.add_argument("--source-lock", type=Path, default=SOURCE_LOCK)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    contract = load_contract()
    if args.command == "check":
        validate_source_lock(load_json(args.source_lock, "source lock"), contract)
        print("windows compatibility dynamic-load source discovery contract: PASS")
        return 0
    if not all((args.source_dir, args.full_build_proof, args.out)):
        raise DynamicLoadDiscoveryError("discover requires --source-dir, --full-build-proof and --out")
    result = discover(
        args.source_dir.resolve(),
        load_json(args.source_lock, "source lock"),
        load_json(args.full_build_proof, "full build proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility direct host loader source sites: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except DynamicLoadDiscoveryError as exc:
        print(f"windows-compat-runtime-dynamic-load-source: {exc}", file=sys.stderr)
        raise SystemExit(2)
