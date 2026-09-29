#!/usr/bin/env python3
"""Inventory direct host dynamic-loader callsites in the locked Wine archive.

This proof is intentionally limited to direct dlopen/dlmopen callsites in the
exact pinned upstream C sources. It distinguishes source literals, configure-
resolved SONAME_* symbols, and truly computed runtime expressions, but does not
claim wrapper closure, generated-source coverage, plugin naming coverage, or a
complete runtime dependency inventory.
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
CONTRACT = HERE / "runtime-dynamic-load-discovery.json"
SOURCE_LOCK = HERE / "source.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
CALL_RE = re.compile(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\(")
STRING_TOKEN_RE = re.compile(r'(?:u8|u|U|L)?"(?:\\.|[^"\\])*"')
CONFIGURED_SONAME_RE = re.compile(r"^SONAME_[A-Z0-9_]+$")
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-dynamic-load-source-proof/1"


class DynamicLoadDiscoveryError(RuntimeError):
    pass


def canonical_sha256(value: object) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


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
        "archive_member_manifest_binding_required",
        "literal_target_classification_required",
        "configured_soname_symbol_classification_required",
        "dynamic_expression_classification_required",
    )
    if any(inspection.get(key) is not True for key in required_true):
        raise DynamicLoadDiscoveryError("dynamic-load source inspection guarantees drifted")
    required_false = (
        "unparseable_direct_call_allowed",
        "relevant_source_link_allowed",
        "wrapper_call_graph_complete",
        "generated_source_inventory_complete",
        "dynamic_load_inventory_complete",
    )
    if any(inspection.get(key) is not False for key in required_false):
        raise DynamicLoadDiscoveryError("dynamic-load source discovery scope drifted")
    if inspection.get("direct_host_loader_apis") != {"dlopen": 0, "dlmopen": 1}:
        raise DynamicLoadDiscoveryError("direct host loader API model drifted")

    inputs = contract.get("input", {})
    if inputs.get("archive_root") != "wine-11.0" or inputs.get("source_extensions") != [".c"]:
        raise DynamicLoadDiscoveryError("dynamic-load archive scan surface drifted")
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
    if upstream.get("archive_root") != contract["input"]["archive_root"]:
        raise DynamicLoadDiscoveryError("source archive root drifted from dynamic-load contract")


def source_proof_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "engine": proof.get("engine"),
        "version": proof.get("version"),
        "archive_name": proof.get("archive_name"),
        "archive_size_bytes": proof.get("archive_size_bytes"),
        "archive_sha256": proof.get("archive_sha256"),
        "archive_member_count": proof.get("archive_member_count"),
        "version_file_value": proof.get("version_file_value"),
        "build_performed": proof.get("build_performed"),
        "activation_authorized": proof.get("activation_authorized"),
        "execution_authorized": proof.get("execution_authorized"),
    }


def validate_source_proof(proof: dict, source: dict, contract: dict) -> str:
    if proof.get("$schema") != contract["input"]["source_proof_schema"]:
        raise DynamicLoadDiscoveryError("unexpected source proof schema")
    if proof.get("runtime_id") != contract.get("runtime_id"):
        raise DynamicLoadDiscoveryError("source proof runtime identity drifted")
    if proof.get("engine") != "wine" or proof.get("version") != "11.0":
        raise DynamicLoadDiscoveryError("source proof engine/version drifted")

    upstream = source["upstream"]
    expected = {
        "archive_name": upstream["archive_name"],
        "archive_size_bytes": upstream["archive_size_bytes"],
        "archive_sha256": upstream["archive_sha256"],
        "version_file_value": upstream["version_file_expected"],
    }
    for key, value in expected.items():
        if proof.get(key) != value:
            raise DynamicLoadDiscoveryError(f"source proof {key} drifted")
    if not isinstance(proof.get("archive_member_count"), int) or proof["archive_member_count"] < 1000:
        raise DynamicLoadDiscoveryError("source proof archive member count is invalid")
    for key in ("build_performed", "activation_authorized", "execution_authorized"):
        if proof.get(key) is not False:
            raise DynamicLoadDiscoveryError(f"source proof crossed forbidden boundary: {key}")
    return canonical_sha256(source_proof_core(proof))


def _replace_span(chars: list[str], start: int, end: int) -> None:
    for index in range(start, end):
        if chars[index] != "\n":
            chars[index] = " "


def lexical_views(text: str) -> tuple[str, str]:
    """Return comment-removed and code-only views while preserving offsets."""
    comments_removed = list(text)
    code_only = list(text)
    i = 0
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if ch == "/" and nxt == "/":
            end = text.find("\n", i + 2)
            if end < 0:
                end = len(text)
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
            while i < len(text):
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
    if CONFIGURED_SONAME_RE.fullmatch(value):
        return {"kind": "configured-soname-symbol", "expression": value, "symbol": value}
    return {"kind": "dynamic-expression", "expression": value}


def scan_text(path: str, text: str, api_map: dict[str, int]) -> list[dict]:
    comments_removed, code_only = lexical_views(text)
    records: list[dict] = []
    for match in CALL_RE.finditer(code_only):
        api = match.group(1)
        if api not in api_map:
            continue
        open_paren = code_only.find("(", match.start(1) + len(api), match.end())
        if open_paren < 0:
            raise DynamicLoadDiscoveryError(f"cannot locate loader call parenthesis: {path}")
        args = extract_arguments(comments_removed, open_paren)
        target_index = api_map[api]
        if target_index >= len(args):
            line = text.count("\n", 0, match.start()) + 1
            raise DynamicLoadDiscoveryError(
                f"direct host loader call lacks modeled target argument: {path}:{line}:{api}"
            )
        line = text.count("\n", 0, match.start()) + 1
        line_start = text.rfind("\n", 0, match.start()) + 1
        records.append(
            {
                "path": path,
                "line": line,
                "column": match.start() - line_start + 1,
                "api": api,
                "target_argument_index": target_index,
                "target": classify_target(args[target_index]),
            }
        )
    return records


def read_relevant_members(archive: Path, contract: dict) -> tuple[list[dict], list[dict], int]:
    if not archive.is_file():
        raise DynamicLoadDiscoveryError("locked Wine source archive is missing")
    expected_sha = contract["input"]["source_archive_sha256"]
    if sha256_file(archive) != expected_sha:
        raise DynamicLoadDiscoveryError("Wine source archive digest does not match dynamic-load contract")

    archive_root = contract["input"]["archive_root"]
    extensions = set(contract["input"]["source_extensions"])
    entries: list[dict] = []
    sources: list[dict] = []
    total_bytes = 0
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                path = PurePosixPath(member.name)
                if path.is_absolute() or ".." in path.parts or not path.parts or path.parts[0] != archive_root:
                    raise DynamicLoadDiscoveryError(f"unsafe or unexpected archive member: {member.name}")
                relative = PurePosixPath(*path.parts[1:])
                if relative.suffix not in extensions:
                    continue
                if member.issym() or member.islnk():
                    raise DynamicLoadDiscoveryError(f"relevant source link is not modeled: {member.name}")
                if not member.isfile():
                    continue
                handle = tar.extractfile(member)
                if handle is None:
                    raise DynamicLoadDiscoveryError(f"cannot read relevant archive member: {member.name}")
                data = handle.read()
                if len(data) != member.size:
                    raise DynamicLoadDiscoveryError(f"relevant archive member size drifted: {member.name}")
                try:
                    text = data.decode("utf-8")
                except UnicodeDecodeError as exc:
                    raise DynamicLoadDiscoveryError(f"C source is not UTF-8: {member.name}") from exc
                relative_name = relative.as_posix()
                entries.append(
                    {
                        "path": relative_name,
                        "size": len(data),
                        "sha256": hashlib.sha256(data).hexdigest(),
                    }
                )
                sources.append({"path": relative_name, "text": text})
                total_bytes += len(data)
    except (tarfile.TarError, OSError) as exc:
        raise DynamicLoadDiscoveryError(f"cannot inspect Wine source archive: {exc}") from exc
    if not entries:
        raise DynamicLoadDiscoveryError("locked Wine archive produced no relevant C source members")
    entries.sort(key=lambda item: item["path"])
    sources.sort(key=lambda item: item["path"])
    return entries, sources, total_bytes


def build_inventory(
    source_proof_sha256: str,
    source_archive_sha256: str,
    entries: list[dict],
    sources: list[dict],
    total_bytes: int,
    api_map: dict[str, int],
    runtime_id: str,
) -> dict:
    callsites: list[dict] = []
    for source in sources:
        callsites.extend(scan_text(source["path"], source["text"], api_map))
    callsites.sort(key=lambda item: (item["path"], item["line"], item["column"], item["api"]))
    if not callsites:
        raise DynamicLoadDiscoveryError("locked Wine C source produced no modeled direct host loader callsites")

    kinds = {
        "static-string": 0,
        "configured-soname-symbol": 0,
        "dynamic-expression": 0,
        "null": 0,
    }
    apis: dict[str, int] = {name: 0 for name in api_map}
    symbols: dict[str, int] = {}
    for item in callsites:
        target = item["target"]
        kinds[target["kind"]] += 1
        apis[item["api"]] += 1
        if target["kind"] == "configured-soname-symbol":
            symbol = target["symbol"]
            symbols[symbol] = symbols.get(symbol, 0) + 1

    counts = {
        "c_archive_members_scanned": len(entries),
        "c_source_bytes": total_bytes,
        "direct_loader_calls": len(callsites),
        "static_string_targets": kinds["static-string"],
        "configured_soname_symbol_targets": kinds["configured-soname-symbol"],
        "dynamic_expression_targets": kinds["dynamic-expression"],
        "null_targets": kinds["null"],
        "calls_by_api": dict(sorted(apis.items())),
        "configured_soname_symbols": dict(sorted(symbols.items())),
    }
    if len(callsites) != (
        counts["static_string_targets"]
        + counts["configured_soname_symbol_targets"]
        + counts["dynamic_expression_targets"]
        + counts["null_targets"]
    ):
        raise DynamicLoadDiscoveryError("dynamic-load target classification count drifted")

    core = {
        "runtime_id": runtime_id,
        "source_archive_sha256": source_archive_sha256,
        "source_proof_sha256": source_proof_sha256,
        "c_archive_manifest_sha256": canonical_sha256(entries),
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
            "source_proof_verified": True,
            "c_archive_manifest_bound": True,
            "direct_host_loader_calls_inventoried": True,
            "configured_soname_symbols_classified": True,
            "configured_soname_values_resolved": False,
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


def discover(archive: Path, source_lock: dict, source_proof: dict) -> dict:
    contract = load_contract()
    validate_source_lock(source_lock, contract)
    proof_sha = validate_source_proof(source_proof, source_lock, contract)
    entries, sources, total_bytes = read_relevant_members(archive, contract)
    return build_inventory(
        proof_sha,
        source_lock["upstream"]["archive_sha256"],
        entries,
        sources,
        total_bytes,
        contract["inspection"]["direct_host_loader_apis"],
        contract["runtime_id"],
    )


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "discover"])
    parser.add_argument("--archive", type=Path)
    parser.add_argument("--source-lock", type=Path, default=SOURCE_LOCK)
    parser.add_argument("--source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    contract = load_contract()
    source_lock = load_json(args.source_lock, "source lock")
    validate_source_lock(source_lock, contract)
    if args.command == "check":
        print("windows compatibility dynamic-load source discovery contract: PASS")
        return 0
    if not all((args.archive, args.source_proof, args.out)):
        raise DynamicLoadDiscoveryError("discover requires --archive, --source-proof and --out")
    result = discover(
        args.archive.resolve(),
        source_lock,
        load_json(args.source_proof, "source proof"),
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
