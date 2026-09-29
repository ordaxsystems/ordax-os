#!/usr/bin/env python3
"""Inventory logical Wine build triggers for generated C sources.

This proof consumes the source-authoritative producer-class proof and enumerates
which Makefile SOURCES / EXTRA_OBJS entries can trigger those producers. It does
not claim architecture-specific output fan-out, generated output bytes, or a
complete generated-source loader inventory.
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
CONTRACT_PATH = HERE / "runtime-generated-source-triggers.json"
SOURCE_LOCK_PATH = HERE / "source.json"
PRODUCER_PATH = HERE / "runtime_generated_source_producer_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-generated-source-trigger-proof/1"
MAX_MAKEFILE_BYTES = 2 * 1024 * 1024
MAX_TRIGGER_SOURCE_BYTES = 8 * 1024 * 1024
ASSIGN_RE = re.compile(r"^\s*([A-Za-z_][A-Za-z0-9_]*)\s*(\+=|:=|=)\s*(.*)$")
VAR_RE = re.compile(r"\$\(([A-Za-z_][A-Za-z0-9_]*)\)|\$\{([A-Za-z_][A-Za-z0-9_]*)\}")
PRAGMA_RE = re.compile(r"(?m)^\s*#\s*pragma\s+makedep(?:\s+([^\r\n]+))?\s*$")


class GeneratedSourceTriggerError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise GeneratedSourceTriggerError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PRODUCER = load_module("ordax_generated_source_producer_for_triggers", PRODUCER_PATH)


def canonical_sha256(value: object) -> str:
    raw = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise GeneratedSourceTriggerError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise GeneratedSourceTriggerError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    value = load_json(CONTRACT_PATH, "generated source trigger contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-generated-source-triggers/1":
        raise GeneratedSourceTriggerError("unexpected generated source trigger contract schema")
    if value.get("status") != "source-trigger-inventory-only-not-generated-output-inventory-complete":
        raise GeneratedSourceTriggerError("generated source trigger status drifted")
    semantics = value.get("trigger_semantics", {})
    if semantics.get("unresolved_make_expansion_allowed") is not False:
        raise GeneratedSourceTriggerError("unresolved make expansion must remain forbidden")
    if semantics.get("regular_source_member_required") is not True:
        raise GeneratedSourceTriggerError("trigger source members must remain regular files")
    if semantics.get("parentsrc_fallback_required") is not True:
        raise GeneratedSourceTriggerError("PARENTSRC fallback semantics must remain required")
    if semantics.get("proxy_makefile_produces_single_dlldata") is not True:
        raise GeneratedSourceTriggerError("proxy Makefile dlldata semantics drifted")
    if semantics.get("architecture_output_fanout_verified") is not False:
        raise GeneratedSourceTriggerError("architecture output fan-out is not proven in this stage")
    producer_ids = semantics.get("producer_ids")
    if not isinstance(producer_ids, list) or len(producer_ids) != 9 or len(set(producer_ids)) != 9:
        raise GeneratedSourceTriggerError("generated producer id set drifted")
    pragma_map = semantics.get("widl_pragma_map")
    if pragma_map != {"client": "widl-client", "server": "widl-server", "ident": "widl-ident", "proxy": "widl-proxy"}:
        raise GeneratedSourceTriggerError("WIDL pragma mapping drifted")
    boundaries = value.get("open_boundaries", {})
    if not boundaries or any(item is not False for item in boundaries.values()):
        raise GeneratedSourceTriggerError("generated source trigger open boundaries drifted")
    promotion = value.get("promotion", {})
    if not promotion or any(item is not False for item in promotion.values()):
        raise GeneratedSourceTriggerError("generated source trigger contract claims promotion/execution")
    return value


def source_lock() -> dict:
    value = load_json(SOURCE_LOCK_PATH, "source lock")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-source/1":
        raise GeneratedSourceTriggerError("unexpected source lock schema")
    return value


def producer_core(proof: dict) -> dict:
    return {
        "runtime_id": proof.get("runtime_id"),
        "source_archive_sha256": proof.get("source_archive_sha256"),
        "makedep_path": proof.get("makedep_path"),
        "makedep_sha256": proof.get("makedep_sha256"),
        "producer_rules": proof.get("producer_rules"),
    }


def validate_producer_proof(proof: dict, contract: dict, source: dict) -> str:
    if proof.get("$schema") != contract["input"]["producer_proof_schema"]:
        raise GeneratedSourceTriggerError("unexpected generated producer proof schema")
    if proof.get("runtime_id") != contract["runtime_id"] or proof.get("runtime_id") != source.get("runtime_id"):
        raise GeneratedSourceTriggerError("generated producer runtime identity drifted")
    if proof.get("source_archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceTriggerError("generated producer archive identity drifted")
    digest = proof.get("evidence_sha256")
    if not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest):
        raise GeneratedSourceTriggerError("generated producer evidence digest is invalid")
    if canonical_sha256(producer_core(proof)) != digest:
        raise GeneratedSourceTriggerError("generated producer evidence digest does not verify")
    rules = proof.get("producer_rules")
    if not isinstance(rules, list):
        raise GeneratedSourceTriggerError("generated producer rules are missing")
    ids = sorted(item.get("id") for item in rules if isinstance(item, dict))
    if ids != sorted(contract["trigger_semantics"]["producer_ids"]):
        raise GeneratedSourceTriggerError("generated producer rule identities drifted")
    if proof.get("counts") != {"producer_rules": 9}:
        raise GeneratedSourceTriggerError("generated producer rule counts drifted")
    expected_gates = {
        "source_archive_verified": True,
        "makedep_source_bound": True,
        "generated_c_producer_classes_classified": True,
        "all_producer_rules_observed": True,
        "generated_source_instances_inventoried": False,
        "generated_source_outputs_scanned": False,
        "generated_source_inventory_complete": False,
        "wrapper_call_graph_complete": False,
        "dynamic_load_inventory_complete": False,
        "runtime_dependency_inventory_complete": False,
        "runtime_package_content_hashes_pinned": False,
        "binary_artifact_pinned": False,
        "activation_authorized": False,
        "execution_authorized": False,
        "wine_executed": False,
        "windows_payload_executed": False,
    }
    if proof.get("gates") != expected_gates:
        raise GeneratedSourceTriggerError("generated producer proof gate set drifted")
    return digest


def strip_make_comment(line: str) -> str:
    out = []
    escaped = False
    for ch in line:
        if ch == "#" and not escaped:
            break
        out.append(ch)
        if ch == "\\":
            escaped = not escaped
        else:
            escaped = False
    return "".join(out)


def logical_make_lines(text: str) -> list[str]:
    result: list[str] = []
    current = ""
    for raw in text.splitlines():
        line = strip_make_comment(raw).rstrip()
        continued = line.endswith("\\") and not line.endswith("\\\\")
        if continued:
            line = line[:-1]
        current += (" " if current else "") + line.strip()
        if not continued:
            if current:
                result.append(current)
            current = ""
    if current:
        raise GeneratedSourceTriggerError("unterminated Makefile line continuation")
    return result


def parse_make_variables(text: str) -> dict[str, str]:
    values: dict[str, str] = {}
    for line in logical_make_lines(text):
        match = ASSIGN_RE.match(line)
        if not match:
            continue
        name, op, raw = match.groups()
        raw = raw.strip()
        if op == "+=":
            prior = values.get(name, "")
            values[name] = (prior + " " + raw).strip()
        else:
            values[name] = raw
    return values


def expand_make_value(name: str, variables: dict[str, str], stack: tuple[str, ...] = ()) -> str:
    if name in stack:
        raise GeneratedSourceTriggerError(f"recursive Makefile variable expansion: {' -> '.join((*stack, name))}")
    if name not in variables:
        raise GeneratedSourceTriggerError(f"unresolved Makefile variable: {name}")
    value = variables[name]
    if "$$" in value:
        raise GeneratedSourceTriggerError(f"shell-dollar expansion is not modeled in Makefile variable: {name}")
    if "$(" in value or "${" in value:
        def replace(match: re.Match[str]) -> str:
            child = match.group(1) or match.group(2)
            return expand_make_value(child, variables, (*stack, name))
        previous = None
        while previous != value:
            previous = value
            value = VAR_RE.sub(replace, value)
        if "$(" in value or "${" in value:
            raise GeneratedSourceTriggerError(f"unsupported Makefile expansion in {name}: {value!r}")
    if "$" in value:
        raise GeneratedSourceTriggerError(f"unsupported Makefile dollar expansion in {name}: {value!r}")
    return value.strip()


def split_make_tokens(value: str, label: str) -> list[str]:
    tokens = value.split()
    for token in tokens:
        if any(ch.isspace() for ch in token):
            raise GeneratedSourceTriggerError(f"invalid whitespace in {label} token")
    return tokens


def normalize_relative_path(*parts: str) -> str:
    stack: list[str] = []
    for raw in parts:
        if not isinstance(raw, str) or not raw or raw.startswith("/") or "\\" in raw:
            raise GeneratedSourceTriggerError(f"unsafe relative path component: {raw!r}")
        for part in PurePosixPath(raw).parts:
            if part in ("", "."):
                continue
            if part == "..":
                if not stack:
                    raise GeneratedSourceTriggerError(f"relative path escapes archive root: {parts!r}")
                stack.pop()
                continue
            stack.append(part)
    if not stack:
        raise GeneratedSourceTriggerError("relative path normalized to archive root")
    return PurePosixPath(*stack).as_posix()


def normalize_member_path(makefile_relative: str, token: str) -> str:
    if not token or token.startswith("/") or "\\" in token or ".." in PurePosixPath(token).parts:
        raise GeneratedSourceTriggerError(f"unsafe source token: {token!r}")
    parent = PurePosixPath(makefile_relative).parent.as_posix()
    return normalize_relative_path(parent, token)


def resolve_trigger_source(makefile_relative: str, token: str, variables: dict[str, str], members: dict[str, dict]) -> tuple[str, str]:
    local = normalize_member_path(makefile_relative, token)
    if members.get(local, {}).get("is_file") is True:
        return local, "local"
    if "PARENTSRC" not in variables:
        return local, "missing"
    parent_src = expand_make_value("PARENTSRC", variables)
    if not parent_src:
        return local, "missing"
    make_parent = PurePosixPath(makefile_relative).parent.as_posix()
    candidate = normalize_relative_path(make_parent, parent_src, token)
    if members.get(candidate, {}).get("is_file") is True:
        return candidate, "parentsrc"
    return candidate, "missing"


def replace_suffix(path: str, old: str, new: str) -> str:
    if not path.endswith(old):
        raise GeneratedSourceTriggerError(f"cannot replace suffix {old!r} in {path!r}")
    return path[:-len(old)] + new


def strip_c_comments(text: str) -> str:
    out = list(text)
    i = 0
    state = "code"
    while i < len(text):
        ch = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ""
        if state == "code":
            if ch == '"':
                state = "string"
            elif ch == "'":
                state = "char"
            elif ch == "/" and nxt == "/":
                out[i] = out[i + 1] = " "
                i += 2
                while i < len(text) and text[i] != "\n":
                    out[i] = " "
                    i += 1
                continue
            elif ch == "/" and nxt == "*":
                out[i] = out[i + 1] = " "
                state = "block"
                i += 2
                continue
        elif state == "string":
            if ch == "\\":
                i += 2
                continue
            if ch == '"':
                state = "code"
        elif state == "char":
            if ch == "\\":
                i += 2
                continue
            if ch == "'":
                state = "code"
        elif state == "block":
            if ch == "*" and nxt == "/":
                out[i] = out[i + 1] = " "
                state = "code"
                i += 2
                continue
            if ch != "\n":
                out[i] = " "
        i += 1
    if state == "block":
        raise GeneratedSourceTriggerError("unterminated block comment in trigger source")
    return "".join(out)


def widl_pragmas(text: str) -> set[str]:
    code = strip_c_comments(text)
    flags: set[str] = set()
    for match in PRAGMA_RE.finditer(code):
        tail = match.group(1) or ""
        flags.update(tail.split())
    return flags


def read_archive_inputs(archive: Path, source: dict, contract: dict) -> tuple[dict[str, dict], dict[str, bytes]]:
    upstream = source.get("upstream", {})
    if archive.stat().st_size != upstream.get("archive_size_bytes") or PRODUCER.sha256_file(archive) != upstream.get("archive_sha256"):
        raise GeneratedSourceTriggerError("Wine archive does not match source lock")
    if upstream.get("archive_sha256") != contract["input"]["source_archive_sha256"]:
        raise GeneratedSourceTriggerError("source lock and trigger contract archive digests differ")
    root = upstream.get("archive_root")
    if root != contract["input"]["archive_root"]:
        raise GeneratedSourceTriggerError("source archive root drifted")
    prefix = root + "/"
    members: dict[str, dict] = {}
    contents: dict[str, bytes] = {}
    relevant_suffixes = ("/Makefile.in", ".idl", ".y", ".l", ".xml")
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                if not member.name.startswith(prefix):
                    continue
                rel = member.name[len(prefix):]
                if not rel or rel.startswith("/") or ".." in PurePosixPath(rel).parts:
                    raise GeneratedSourceTriggerError(f"unsafe archive member path: {member.name}")
                if rel in members:
                    raise GeneratedSourceTriggerError(f"duplicate archive member: {rel}")
                members[rel] = {"is_file": member.isfile(), "size": member.size}
                if not (member.isfile() and rel.endswith(relevant_suffixes)):
                    continue
                limit = MAX_MAKEFILE_BYTES if rel.endswith("/Makefile.in") or rel == "Makefile.in" else MAX_TRIGGER_SOURCE_BYTES
                if member.size <= 0 or member.size > limit:
                    raise GeneratedSourceTriggerError(f"relevant source member exceeds bound: {rel}")
                handle = tar.extractfile(member)
                if handle is None:
                    raise GeneratedSourceTriggerError(f"cannot read relevant source member: {rel}")
                raw = handle.read(limit + 1)
                if len(raw) != member.size or len(raw) > limit:
                    raise GeneratedSourceTriggerError(f"relevant source member read mismatch: {rel}")
                contents[rel] = raw
    except (tarfile.TarError, OSError) as exc:
        raise GeneratedSourceTriggerError(f"cannot inspect Wine archive: {exc}") from exc
    return members, contents


def inventory_triggers(members: dict[str, dict], contents: dict[str, bytes], contract: dict) -> tuple[list[dict], dict]:
    makefile_name = contract["input"]["module_makefile_name"]
    source_var = contract["input"]["source_variable"]
    extra_var = contract["input"]["extra_objects_variable"]
    pragma_map = contract["trigger_semantics"]["widl_pragma_map"]
    trigger_records: list[dict] = []
    make_manifest: list[dict] = []
    source_token_count = 0
    bound_sources: set[str] = set()
    makefiles = sorted(path for path in contents if path == makefile_name or path.endswith("/" + makefile_name))
    if not makefiles:
        raise GeneratedSourceTriggerError("Wine archive contained no Makefile.in inputs")
    for makefile in makefiles:
        raw = contents[makefile]
        try:
            text = raw.decode("utf-8", errors="strict")
        except UnicodeDecodeError as exc:
            raise GeneratedSourceTriggerError(f"Makefile is not UTF-8: {makefile}") from exc
        make_manifest.append({"path": makefile, "sha256": hashlib.sha256(raw).hexdigest(), "size": len(raw)})
        variables = parse_make_variables(text)
        source_tokens = split_make_tokens(expand_make_value(source_var, variables), f"{makefile}:{source_var}") if source_var in variables else []
        extra_tokens = split_make_tokens(expand_make_value(extra_var, variables), f"{makefile}:{extra_var}") if extra_var in variables else []
        source_token_count += len(source_tokens)
        proxy_sources: list[str] = []
        for token in source_tokens:
            local_source_path = normalize_member_path(makefile, token)
            suffix = PurePosixPath(local_source_path).suffix
            source_path = local_source_path
            source_resolution = "local"
            if suffix in (".idl", ".y", ".l", ".xml"):
                source_path, source_resolution = resolve_trigger_source(makefile, token, variables, members)
            producer = None
            output = None
            if suffix == ".idl":
                meta = members.get(source_path)
                raw_source = contents.get(source_path)
                if not meta or meta.get("is_file") is not True or raw_source is None:
                    raise GeneratedSourceTriggerError(f"IDL trigger source is not a regular bounded archive member: {source_path}")
                try:
                    idl_text = raw_source.decode("utf-8", errors="strict")
                except UnicodeDecodeError as exc:
                    raise GeneratedSourceTriggerError(f"IDL trigger source is not UTF-8: {source_path}") from exc
                flags = widl_pragmas(idl_text)
                observed = []
                for flag, producer_id in sorted(pragma_map.items()):
                    if flag not in flags:
                        continue
                    output_suffix = {"client": "_c.c", "server": "_s.c", "ident": "_i.c", "proxy": "_p.c"}[flag]
                    trigger_records.append({"producer_id": producer_id, "makefile": makefile, "source": source_path, "source_resolution": source_resolution, "source_sha256": hashlib.sha256(raw_source).hexdigest(), "trigger": f"#pragma makedep {flag}", "logical_output": replace_suffix(local_source_path, ".idl", output_suffix)})
                    observed.append(flag)
                    if flag == "proxy":
                        proxy_sources.append(source_path)
                if observed:
                    bound_sources.add(source_path)
                continue
            if suffix == ".y":
                producer, output = "bison-parser", replace_suffix(local_source_path, ".y", ".tab.c")
            elif suffix == ".l":
                producer, output = "flex-scanner", replace_suffix(local_source_path, ".l", ".yy.c")
            elif suffix == ".xml":
                producer, output = "wayland-protocol", replace_suffix(local_source_path, ".xml", "-protocol.c")
            if producer is not None:
                meta = members.get(source_path)
                raw_source = contents.get(source_path)
                if not meta or meta.get("is_file") is not True or raw_source is None:
                    raise GeneratedSourceTriggerError(f"trigger source is not a regular bounded archive member: {source_path}")
                trigger_records.append({"producer_id": producer, "makefile": makefile, "source": source_path, "source_resolution": source_resolution, "source_sha256": hashlib.sha256(raw_source).hexdigest(), "trigger": f"{source_var}:{token}", "logical_output": output})
                bound_sources.add(source_path)
        if proxy_sources:
            parent = PurePosixPath(makefile).parent
            trigger_records.append({"producer_id": "widl-dlldata", "makefile": makefile, "proxy_sources": sorted(set(proxy_sources)), "trigger": "proxy-idl-present-in-makefile", "logical_output": (parent / "dlldata.c").as_posix()})
        for token in extra_tokens:
            if not token.endswith(".o"):
                continue
            object_path = normalize_member_path(makefile, token)
            trigger_records.append({"producer_id": "extra-objs-c-fallback", "makefile": makefile, "extra_object": object_path, "trigger": f"{extra_var}:{token}", "logical_output": replace_suffix(object_path, ".o", ".c")})
    trigger_records.sort(key=lambda item: json.dumps(item, sort_keys=True, separators=(",", ":")))
    if len({json.dumps(item, sort_keys=True, separators=(",", ":")) for item in trigger_records}) != len(trigger_records):
        raise GeneratedSourceTriggerError("duplicate generated source trigger record")
    by_producer = {item: 0 for item in contract["trigger_semantics"]["producer_ids"]}
    for record in trigger_records:
        producer_id = record["producer_id"]
        if producer_id not in by_producer:
            raise GeneratedSourceTriggerError(f"unmodeled generated source producer trigger: {producer_id}")
        by_producer[producer_id] += 1
    make_manifest.sort(key=lambda item: item["path"])
    return trigger_records, {"makefiles_scanned": len(makefiles), "source_tokens_inspected": source_token_count, "trigger_records": len(trigger_records), "trigger_source_members": len(bound_sources), "by_producer": by_producer, "makefile_manifest_sha256": canonical_sha256(make_manifest)}


def prove(archive: Path, producer_proof: dict) -> dict:
    contract = load_contract()
    source = source_lock()
    if source.get("runtime_id") != contract["runtime_id"]:
        raise GeneratedSourceTriggerError("runtime identity drifted")
    producer_digest = validate_producer_proof(producer_proof, contract, source)
    members, contents = read_archive_inputs(archive, source, contract)
    triggers, counts = inventory_triggers(members, contents, contract)
    if not triggers:
        raise GeneratedSourceTriggerError("no generated C source triggers were found")
    core = {"runtime_id": contract["runtime_id"], "source_archive_sha256": contract["input"]["source_archive_sha256"], "producer_evidence_sha256": producer_digest, "makefile_manifest_sha256": counts["makefile_manifest_sha256"], "trigger_records": triggers}
    public_counts = {key: value for key, value in counts.items() if key != "makefile_manifest_sha256"}
    return {"$schema": PROOF_SCHEMA, "status": "generated-c-source-triggers-inventoried-not-output-inventory-complete", **core, "evidence_sha256": canonical_sha256(core), "counts": public_counts, "gates": {"producer_proof_verified": True, "makefile_manifest_bound": True, "build_source_variables_expanded": True, "generated_c_trigger_instances_inventoried": True, "trigger_source_members_bound": True, "generated_source_instances_inventoried": False, "generated_source_output_fanout_verified": False, "generated_source_outputs_scanned": False, "generated_source_inventory_complete": False, "wrapper_call_graph_complete": False, "dynamic_load_inventory_complete": False, "runtime_dependency_inventory_complete": False, "runtime_package_content_hashes_pinned": False, "binary_artifact_pinned": False, "activation_authorized": False, "execution_authorized": False, "wine_executed": False, "windows_payload_executed": False}}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "prove"])
    parser.add_argument("--source-archive", type=Path)
    parser.add_argument("--producer-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility generated source trigger contract: PASS")
        return 0
    if not args.source_archive or not args.producer_proof or not args.out:
        raise GeneratedSourceTriggerError("prove requires --source-archive, --producer-proof and --out")
    producer_proof = load_json(args.producer_proof, "generated source producer proof")
    result = prove(args.source_archive.resolve(), producer_proof)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility generated C source triggers: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (GeneratedSourceTriggerError, PRODUCER.GeneratedSourceProducerError) as exc:
        print(f"windows-compat-runtime-generated-source-triggers: {exc}", file=sys.stderr)
        raise SystemExit(2)
