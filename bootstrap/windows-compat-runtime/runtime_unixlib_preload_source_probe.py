#!/usr/bin/env python3
"""Derive source-authoritative Wine Unixlib preload relations without execution.

The proof has two fail-closed derivation classes:
* direct dependency-attach: the Unixlib consumer also imports the provider PE DLL;
* forwarder prerequisite: a PE forwarding module proves that the provider PE DLL
  is dependency-attached before the Unixlib consumer is activated lazily.

Both classes are derived only from the locked Wine 11.0 source archive. Runtime
use additionally requires the exact staged provider beside the consumer and an
identical ELF identity. Nothing here authorizes Wine or Windows execution.
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
CONTRACT_PATH = HERE / "runtime-unixlib-preload-source.json"
BUILD_PATH = HERE / "build.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-unixlib-preload-source-proof/1"
MAX_TEXT_BYTES = 4 * 1024 * 1024
MAKEFILE_RE = re.compile(r"^dlls/[^/]+/Makefile\.in$")
ASSIGN_RE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*(\+?=)\s*(.*?)\s*$")
LINK_RE = re.compile(r"^-l([A-Za-z0-9_+.-]+)$")

DIRECT_RELATION_KIND = "direct-consumer-pe-dependency-attach"
FORWARDER_RELATION_KIND = "forwarder-prerequisite-pe-dependency-attach"
PRELOAD_ORDER = "provider-pe-dependency-attach-before-consumer-unixlib-dlopen"


class UnixlibPreloadSourceError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise UnixlibPreloadSourceError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load_module("ordax_unixlib_preload_build", BUILD_PATH)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def canonical_sha256(value: object) -> str:
    data = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return sha256_bytes(data)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise UnixlibPreloadSourceError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise UnixlibPreloadSourceError(f"{label} must be an object")
    return value


def load_contract() -> dict:
    value = load_json(CONTRACT_PATH, "unixlib preload source contract")
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-unixlib-preload-source/1":
        raise UnixlibPreloadSourceError("unexpected unixlib preload source contract schema")
    if value.get("status") != "source-derived-dependency-attach-unixlib-preloads-not-runtime-complete":
        raise UnixlibPreloadSourceError("unixlib preload source contract status drifted")
    if value.get("runtime_id") != "wine-11.0-wow64-x86_64-candidate":
        raise UnixlibPreloadSourceError("unixlib preload source runtime identity drifted")
    source = value.get("input", {})
    if source.get("source_archive_sha256") != "c07a6857933c1fc60dff5448d79f39c92481c1e9db5aa628db9d0358446e0701":
        raise UnixlibPreloadSourceError("unixlib preload source archive identity drifted")
    if source.get("archive_root") != "wine-11.0" or source.get("module_makefile_glob") != "dlls/*/Makefile.in":
        raise UnixlibPreloadSourceError("unixlib preload source scan surface drifted")

    derivation = value.get("derivation", {})
    required = (
        "consumer_unixlib_required",
        "consumer_normal_pe_import_required",
        "consumer_unix_link_flag_required",
        "provider_importlib_required",
        "provider_unixlib_required",
        "provider_process_attach_unix_init_required",
        "consumer_process_attach_unix_init_required",
        "dependency_attach_precedes_consumer_attach_required",
        "forwarder_activation_prerequisite_required",
        "winecrt_memory_query_bridge_required",
        "builtin_unix_path_registration_required",
        "lazy_unixlib_dlopen_required",
        "comments_must_not_satisfy_source_anchors",
        "line_numbers_are_not_authority",
    )
    if any(derivation.get(key) is not True for key in required):
        raise UnixlibPreloadSourceError("unixlib preload derivation guarantees drifted")

    authority = value.get("source_authority")
    if not isinstance(authority, dict):
        raise UnixlibPreloadSourceError("unixlib preload source authority is missing")
    expected_core = {
        "pe_loader_path": "dlls/ntdll/loader.c",
        "unix_loader_path": "dlls/ntdll/unix/loader.c",
        "virtual_memory_path": "dlls/ntdll/unix/virtual.c",
        "winecrt_unix_path": "dlls/winecrt0/unix_lib.c",
    }
    if any(authority.get(key) != expected for key, expected in expected_core.items()):
        raise UnixlibPreloadSourceError("unixlib preload source authority paths drifted")
    activation = authority.get("forwarder_activation_prerequisites")
    if not isinstance(activation, list) or not activation:
        raise UnixlibPreloadSourceError("forwarder activation prerequisite authority is missing")
    seen: set[tuple[str, str]] = set()
    required_activation_fields = (
        "consumer_module",
        "consumer_unixlib",
        "consumer_makefile",
        "provider_importlib",
        "provider_module",
        "provider_unixlib",
        "provider_makefile",
        "forwarder_module",
        "forwarder_makefile",
        "forwarder_spec",
        "forwarder_target_prefix",
        "forwarder_attach_source",
        "forwarder_attach_call",
        "prerequisite_importlib",
        "prerequisite_module",
        "prerequisite_makefile",
        "consumer_lazy_source",
        "consumer_lazy_init_fragment",
        "consumer_lazy_once_fragment",
    )
    for item in activation:
        if not isinstance(item, dict) or any(not isinstance(item.get(key), str) or not item[key] for key in required_activation_fields):
            raise UnixlibPreloadSourceError("invalid forwarder activation prerequisite authority")
        key = (item["consumer_unixlib"], item["provider_unixlib"])
        if key in seen:
            raise UnixlibPreloadSourceError("duplicate forwarder activation prerequisite authority")
        seen.add(key)

    promotion = value.get("promotion", {})
    if not promotion or any(flag is not False for flag in promotion.values()):
        raise UnixlibPreloadSourceError("unixlib preload source contract claims promotion or execution")
    return value


def lexical_comments_removed(text: str) -> str:
    """Remove C comments while preserving strings, chars, newlines and offsets."""
    chars = list(text)
    index = 0
    while index < len(text):
        ch = text[index]
        nxt = text[index + 1] if index + 1 < len(text) else ""
        if ch == "/" and nxt == "/":
            end = text.find("\n", index + 2)
            if end < 0:
                end = len(text)
            for pos in range(index, end):
                if chars[pos] != "\n":
                    chars[pos] = " "
            index = end
            continue
        if ch == "/" and nxt == "*":
            end = text.find("*/", index + 2)
            if end < 0:
                raise UnixlibPreloadSourceError("unterminated C block comment")
            end += 2
            for pos in range(index, end):
                if chars[pos] != "\n":
                    chars[pos] = " "
            index = end
            continue
        if ch in {'"', "'"}:
            quote = ch
            index += 1
            while index < len(text):
                if text[index] == "\\":
                    index += 2
                    continue
                if text[index] == quote:
                    index += 1
                    break
                index += 1
            else:
                raise UnixlibPreloadSourceError("unterminated C string/char literal")
            continue
        index += 1
    return "".join(chars)


def normalized_code(text: str) -> str:
    return re.sub(r"\s+", " ", lexical_comments_removed(text)).strip()


def parse_makefile(text: str) -> dict[str, str]:
    physical = text.splitlines()
    logical: list[str] = []
    index = 0
    while index < len(physical):
        current = physical[index]
        parts: list[str] = []
        while True:
            stripped = current.rstrip()
            continued = stripped.endswith("\\")
            if continued:
                stripped = stripped[:-1]
            parts.append(stripped)
            if not continued:
                break
            index += 1
            if index >= len(physical):
                raise UnixlibPreloadSourceError("unterminated Makefile continuation")
            current = physical[index]
        logical.append(" ".join(parts))
        index += 1

    values: dict[str, str] = {}
    for line in logical:
        content = line.split("#", 1)[0].strip()
        if not content:
            continue
        match = ASSIGN_RE.match(content)
        if not match:
            continue
        name, operator, raw = match.groups()
        raw = raw.strip()
        if operator == "+=":
            values[name] = (values.get(name, "") + " " + raw).strip()
        else:
            if name in values:
                raise UnixlibPreloadSourceError(f"duplicate Makefile assignment: {name}")
            values[name] = raw
    return values


def safe_single_token(values: dict[str, str], name: str) -> str | None:
    value = values.get(name)
    if value is None:
        return None
    tokens = value.split()
    if len(tokens) != 1 or any(ch in tokens[0] for ch in "/\\$(){}"):
        raise UnixlibPreloadSourceError(f"unsafe or non-literal Makefile {name}: {value!r}")
    return tokens[0]


def archive_member_text(tar: tarfile.TarFile, member: tarfile.TarInfo, label: str) -> tuple[str, str]:
    if not member.isfile() or member.size <= 0 or member.size > MAX_TEXT_BYTES:
        raise UnixlibPreloadSourceError(f"invalid {label} member type/size: {member.name}")
    handle = tar.extractfile(member)
    if handle is None:
        raise UnixlibPreloadSourceError(f"cannot read {label}: {member.name}")
    raw = handle.read(MAX_TEXT_BYTES + 1)
    if len(raw) != member.size or len(raw) > MAX_TEXT_BYTES:
        raise UnixlibPreloadSourceError(f"{label} changed size or exceeded bound: {member.name}")
    try:
        text = raw.decode("utf-8", errors="strict")
    except UnicodeDecodeError as exc:
        raise UnixlibPreloadSourceError(f"{label} is not UTF-8: {member.name}") from exc
    return text, sha256_bytes(raw)


def collect_makefiles(archive: Path, source: dict) -> tuple[list[dict], dict[str, dict]]:
    root = source["upstream"]["archive_root"]
    manifest: list[dict] = []
    modules: dict[str, dict] = {}
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                pure = PurePosixPath(member.name)
                if not pure.parts or pure.parts[0] != root:
                    continue
                relative = PurePosixPath(*pure.parts[1:]).as_posix()
                if not MAKEFILE_RE.fullmatch(relative):
                    continue
                text, digest = archive_member_text(tar, member, "module Makefile")
                values = parse_makefile(text)
                module = safe_single_token(values, "MODULE")
                unixlib = safe_single_token(values, "UNIXLIB")
                importlib = safe_single_token(values, "IMPORTLIB")
                record = {
                    "path": relative,
                    "sha256": digest,
                    "size": member.size,
                    "values": values,
                    "module": module,
                    "unixlib": unixlib,
                    "importlib": importlib,
                    "directory": str(PurePosixPath(relative).parent),
                }
                manifest.append({"path": relative, "sha256": digest, "size": member.size})
                modules[relative] = record
    except (tarfile.TarError, OSError) as exc:
        raise UnixlibPreloadSourceError(f"cannot scan module Makefiles: {exc}") from exc
    if not manifest:
        raise UnixlibPreloadSourceError("locked Wine source produced no module Makefiles")
    manifest.sort(key=lambda item: item["path"])
    return manifest, modules


def derive_candidate_relations(modules: dict[str, dict]) -> list[dict]:
    """Derive the strict direct-consumer PE dependency-attach class."""
    providers: dict[str, dict] = {}
    for record in modules.values():
        if not record["importlib"] or not record["unixlib"] or not record["module"]:
            continue
        if record["importlib"] in providers:
            raise UnixlibPreloadSourceError(f"duplicate IMPORTLIB provider: {record['importlib']}")
        providers[record["importlib"]] = record

    relations: list[dict] = []
    for consumer in modules.values():
        if not consumer["unixlib"] or not consumer["module"]:
            continue
        imports = set(consumer["values"].get("IMPORTS", "").split())
        link_names: list[str] = []
        for token in consumer["values"].get("UNIX_LIBS", "").split():
            match = LINK_RE.fullmatch(token)
            if match:
                link_names.append(match.group(1))
        for link_name in sorted(set(link_names)):
            if link_name not in imports:
                continue
            provider = providers.get(link_name)
            if provider is None:
                continue
            relations.append({
                "relation_kind": DIRECT_RELATION_KIND,
                "link_name": link_name,
                "consumer_module": consumer["module"],
                "consumer_unixlib": consumer["unixlib"],
                "consumer_directory": consumer["directory"],
                "consumer_makefile": consumer["path"],
                "consumer_makefile_sha256": consumer["sha256"],
                "provider_module": provider["module"],
                "provider_unixlib": provider["unixlib"],
                "provider_directory": provider["directory"],
                "provider_makefile": provider["path"],
                "provider_makefile_sha256": provider["sha256"],
            })
    relations.sort(key=lambda item: (item["consumer_unixlib"], item["provider_unixlib"], item["link_name"]))
    return relations


def collect_source_files(archive: Path, source: dict, directories: set[str], authority_paths: set[str]) -> dict[str, dict]:
    root = source["upstream"]["archive_root"]
    found: dict[str, dict] = {}
    try:
        with tarfile.open(archive, "r:xz") as tar:
            for member in tar:
                pure = PurePosixPath(member.name)
                if not pure.parts or pure.parts[0] != root:
                    continue
                relative = PurePosixPath(*pure.parts[1:]).as_posix()
                parent = str(PurePosixPath(relative).parent)
                wanted = relative in authority_paths or (parent in directories and relative.endswith(".c"))
                if not wanted:
                    continue
                if relative in found:
                    raise UnixlibPreloadSourceError(f"duplicate relevant source member: {relative}")
                text, digest = archive_member_text(tar, member, "relevant source")
                found[relative] = {"text": text, "sha256": digest, "size": member.size}
    except (tarfile.TarError, OSError) as exc:
        raise UnixlibPreloadSourceError(f"cannot collect relevant source: {exc}") from exc
    missing = sorted(authority_paths - set(found))
    if missing:
        raise UnixlibPreloadSourceError(f"locked source lacks authority files: {missing}")
    return found


def attach_init_evidence(directory: str, sources: dict[str, dict]) -> dict | None:
    matches: list[dict] = []
    prefix = directory + "/"
    for path, source in sources.items():
        if not path.startswith(prefix) or not path.endswith(".c"):
            continue
        code = normalized_code(source["text"])
        marker = "case DLL_PROCESS_ATTACH:"
        start = 0
        while True:
            pos = code.find(marker, start)
            if pos < 0:
                break
            next_case = code.find("case DLL_", pos + len(marker))
            segment = code[pos: next_case if next_case >= 0 else len(code)]
            if "__wine_init_unix_call()" in segment:
                matches.append({"path": path, "sha256": source["sha256"]})
            start = pos + len(marker)
    unique = {(item["path"], item["sha256"]) for item in matches}
    if len(unique) > 1:
        raise UnixlibPreloadSourceError(f"ambiguous process-attach unix init sources for {directory}: {sorted(unique)}")
    if not unique:
        return None
    path, digest = next(iter(unique))
    return {"path": path, "sha256": digest, "process_attach_unix_init_verified": True}


def require_fragment(code: str, fragment: str, label: str) -> int:
    normalized = re.sub(r"\s+", " ", fragment).strip()
    count = code.count(normalized)
    if count != 1:
        raise UnixlibPreloadSourceError(f"{label} source fragment cardinality drifted: expected=1 actual={count}: {fragment!r}")
    return code.index(normalized)


def prove_loader_semantics(sources: dict[str, dict], contract: dict) -> dict:
    authority = contract["source_authority"]
    pe_path = authority["pe_loader_path"]
    unix_path = authority["unix_loader_path"]
    virtual_path = authority["virtual_memory_path"]
    winecrt_path = authority["winecrt_unix_path"]
    pe = normalized_code(sources[pe_path]["text"])
    unix = normalized_code(sources[unix_path]["text"])
    virtual = normalized_code(sources[virtual_path]["text"])
    winecrt = normalized_code(sources[winecrt_path]["text"])

    import_load = require_fragment(pe, "if (!import_dll( wm, &imports[i], load_path, &imp ))", "PE import")
    dependency_add = require_fragment(pe, "add_module_dependency_after( wm->ldr.DdagNode, imp->ldr.DdagNode, dep_after );", "PE dependency")
    if dependency_add <= import_load:
        raise UnixlibPreloadSourceError("PE dependency edge is not created after import load")
    dependency_attach = require_fragment(pe, "status = walk_node_dependencies( node, lpReserved, process_attach );", "dependency attach")
    consumer_attach = require_fragment(pe, "status = MODULE_InitDLL( wm, DLL_PROCESS_ATTACH, lpReserved );", "consumer attach")
    if consumer_attach <= dependency_attach:
        raise UnixlibPreloadSourceError("consumer attach does not follow recursive dependency attach")

    extension = require_fragment(unix, "strcpy( ext, \".so\" );", "builtin unixlib association")
    register = require_fragment(unix, "load_builtin_unixlib( *module, ptr );", "builtin unixlib registration")
    if register <= extension:
        raise UnixlibPreloadSourceError("builtin unixlib path is not registered after .so name derivation")

    require_fragment(winecrt, "return NtQueryVirtualMemory( GetCurrentProcess(), image_base(), MemoryWineUnixFuncs, &__wine_unixlib_handle, sizeof(__wine_unixlib_handle), NULL );", "winecrt unix init")
    case = require_fragment(virtual, "case MemoryWineUnixFuncs:", "MemoryWineUnixFuncs handler")
    bridge = require_fragment(virtual, "status = get_builtin_unix_funcs( module, info_class == MemoryWineUnixWow64Funcs, &funcs );", "builtin unix funcs bridge")
    require_fragment(virtual, "builtin->unix_handle = dlopen( builtin->unix_path, RTLD_NOW );", "builtin unixlib dlopen")
    if bridge <= case:
        raise UnixlibPreloadSourceError("MemoryWineUnixFuncs handler does not reach builtin unix funcs after case selection")

    return {
        "pe_loader_sha256": sources[pe_path]["sha256"],
        "unix_loader_sha256": sources[unix_path]["sha256"],
        "virtual_memory_sha256": sources[virtual_path]["sha256"],
        "winecrt_unix_sha256": sources[winecrt_path]["sha256"],
        "normal_import_dependency_recorded": True,
        "dependency_attach_precedes_consumer_attach": True,
        "builtin_unix_path_registered": True,
        "memory_query_reaches_builtin_unix_funcs": True,
        "builtin_unixlib_dlopen_verified": True,
    }


def _require_makefile_record(modules: dict[str, dict], path: str, label: str) -> dict:
    record = modules.get(path)
    if not isinstance(record, dict):
        raise UnixlibPreloadSourceError(f"{label} Makefile is missing from locked source: {path}")
    return record


def _require_token(values: dict[str, str], name: str, token: str, label: str) -> None:
    if token not in values.get(name, "").split():
        raise UnixlibPreloadSourceError(f"{label} lacks required {name} token: {token}")


def _function_body(code: str, signature_fragment: str, label: str) -> str:
    signature = re.sub(r"\s+", " ", signature_fragment).strip()
    if code.count(signature) != 1:
        raise UnixlibPreloadSourceError(f"{label} function signature cardinality drifted")
    start = code.index(signature)
    brace = code.find("{", start + len(signature))
    if brace < 0:
        raise UnixlibPreloadSourceError(f"{label} function body is missing")
    depth = 0
    for pos in range(brace, len(code)):
        if code[pos] == "{":
            depth += 1
        elif code[pos] == "}":
            depth -= 1
            if depth == 0:
                return code[brace + 1:pos]
    raise UnixlibPreloadSourceError(f"{label} function body is unterminated")


def prove_forwarder_activation_relation(authority: dict, modules: dict[str, dict], sources: dict[str, dict]) -> dict:
    consumer = _require_makefile_record(modules, authority["consumer_makefile"], "activation consumer")
    provider = _require_makefile_record(modules, authority["provider_makefile"], "activation provider")
    forwarder = _require_makefile_record(modules, authority["forwarder_makefile"], "activation forwarder")
    prerequisite = _require_makefile_record(modules, authority["prerequisite_makefile"], "activation prerequisite")

    expected_pairs = (
        (consumer.get("module"), authority["consumer_module"], "consumer MODULE"),
        (consumer.get("unixlib"), authority["consumer_unixlib"], "consumer UNIXLIB"),
        (provider.get("module"), authority["provider_module"], "provider MODULE"),
        (provider.get("unixlib"), authority["provider_unixlib"], "provider UNIXLIB"),
        (provider.get("importlib"), authority["provider_importlib"], "provider IMPORTLIB"),
        (forwarder.get("module"), authority["forwarder_module"], "forwarder MODULE"),
        (prerequisite.get("module"), authority["prerequisite_module"], "prerequisite MODULE"),
        (prerequisite.get("importlib"), authority["prerequisite_importlib"], "prerequisite IMPORTLIB"),
    )
    for actual, expected, label in expected_pairs:
        if actual != expected:
            raise UnixlibPreloadSourceError(f"{label} drifted: expected={expected!r} actual={actual!r}")

    _require_token(consumer["values"], "UNIX_LIBS", f"-l{authority['provider_importlib']}", "activation consumer")
    if authority["provider_importlib"] in consumer["values"].get("IMPORTS", "").split():
        raise UnixlibPreloadSourceError("forwarder activation relation unexpectedly became a direct consumer PE import")
    _require_token(forwarder["values"], "IMPORTS", authority["prerequisite_importlib"], "activation forwarder")
    _require_token(prerequisite["values"], "IMPORTS", authority["provider_importlib"], "activation prerequisite")

    spec_source = sources[authority["forwarder_spec"]]
    spec_lines = []
    target_prefix = authority["forwarder_target_prefix"]
    for raw in spec_source["text"].splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or " stub " in f" {line} ":
            continue
        if not line.startswith("@ "):
            continue
        parts = line.split()
        if len(parts) < 4:
            raise UnixlibPreloadSourceError(f"malformed forwarder export line: {line}")
        target = parts[-1]
        if "." not in target:
            raise UnixlibPreloadSourceError(f"non-stub forwarder export lacks target: {line}")
        if not target.startswith(target_prefix):
            raise UnixlibPreloadSourceError(f"forwarder export escapes expected target {target_prefix}: {line}")
        spec_lines.append(line)
    if not spec_lines:
        raise UnixlibPreloadSourceError("forwarder spec contains no non-stub forwarded exports")

    attach_source = sources[authority["forwarder_attach_source"]]
    attach_code = normalized_code(attach_source["text"])
    attach_body = _function_body(attach_code, "BOOL WINAPI DllMain(HINSTANCE hinst, DWORD reason, void *reserved)", "forwarder DllMain")
    attach_call = re.sub(r"\s+", " ", authority["forwarder_attach_call"]).strip()
    if attach_body.count("if (reason != DLL_PROCESS_ATTACH) return TRUE;") != 1:
        raise UnixlibPreloadSourceError("forwarder process-attach guard drifted")
    if attach_body.count(attach_call) != 1:
        raise UnixlibPreloadSourceError("forwarder process attach prerequisite call drifted")

    lazy_source = sources[authority["consumer_lazy_source"]]
    lazy_code = normalized_code(lazy_source["text"])
    lazy_init = re.sub(r"\s+", " ", authority["consumer_lazy_init_fragment"]).strip()
    lazy_once = re.sub(r"\s+", " ", authority["consumer_lazy_once_fragment"]).strip()
    init_body = _function_body(lazy_code, "static BOOL WINAPI wine_vk_init(INIT_ONCE *once, void *param, void **context)", "consumer lazy unix init")
    once_body = _function_body(lazy_code, "static BOOL wine_vk_init_once(void)", "consumer lazy InitOnce")
    if init_body.count(lazy_init) != 1:
        raise UnixlibPreloadSourceError("consumer lazy unix init source fragment drifted")
    if once_body.count(lazy_once) != 1:
        raise UnixlibPreloadSourceError("consumer lazy InitOnce source fragment drifted")
    consumer_attach = attach_init_evidence(consumer["directory"], sources)
    if consumer_attach is not None:
        raise UnixlibPreloadSourceError("forwarder activation consumer unexpectedly initializes Unixlib in process attach")

    provider_attach = attach_init_evidence(provider["directory"], sources)
    if provider_attach is None:
        raise UnixlibPreloadSourceError("forwarder activation provider lacks process-attach Unixlib init")

    return {
        "relation_kind": FORWARDER_RELATION_KIND,
        "link_name": authority["provider_importlib"],
        "consumer_module": consumer["module"],
        "consumer_unixlib": consumer["unixlib"],
        "consumer_directory": consumer["directory"],
        "consumer_makefile": consumer["path"],
        "consumer_makefile_sha256": consumer["sha256"],
        "provider_module": provider["module"],
        "provider_unixlib": provider["unixlib"],
        "provider_directory": provider["directory"],
        "provider_makefile": provider["path"],
        "provider_makefile_sha256": provider["sha256"],
        "provider_attach": provider_attach,
        "activation_chain": {
            "forwarder_module": forwarder["module"],
            "forwarder_makefile": forwarder["path"],
            "forwarder_makefile_sha256": forwarder["sha256"],
            "forwarder_spec": authority["forwarder_spec"],
            "forwarder_spec_sha256": spec_source["sha256"],
            "forwarded_export_count": len(spec_lines),
            "all_non_stub_exports_forward_to_consumer": True,
            "forwarder_attach_source": authority["forwarder_attach_source"],
            "forwarder_attach_source_sha256": attach_source["sha256"],
            "forwarder_process_attach_prerequisite_verified": True,
            "prerequisite_module": prerequisite["module"],
            "prerequisite_makefile": prerequisite["path"],
            "prerequisite_makefile_sha256": prerequisite["sha256"],
            "prerequisite_imports_provider": True,
            "consumer_lazy_source": authority["consumer_lazy_source"],
            "consumer_lazy_source_sha256": lazy_source["sha256"],
            "consumer_lazy_unix_init_verified": True,
            "consumer_lazy_once_verified": True
        },
        "preload_order": PRELOAD_ORDER
    }


def prove(archive: Path) -> dict:
    contract = load_contract()
    source = BUILD.validate_source(BUILD.load_source())
    if source["runtime_id"] != contract["runtime_id"]:
        raise UnixlibPreloadSourceError("source lock runtime identity drifted")
    if source["upstream"]["archive_sha256"] != contract["input"]["source_archive_sha256"]:
        raise UnixlibPreloadSourceError("source lock archive identity drifted")
    archive_proof = BUILD.validate_archive(source, archive)
    if archive_proof["archive_sha256"] != contract["input"]["source_archive_sha256"]:
        raise UnixlibPreloadSourceError("supplied archive does not match locked source")

    manifest, modules = collect_makefiles(archive, source)
    direct_candidates = derive_candidate_relations(modules)
    if not direct_candidates:
        raise UnixlibPreloadSourceError("locked source produced no candidate internal unixlib preload relations")

    activation_authorities = contract["source_authority"]["forwarder_activation_prerequisites"]
    directories = {item["consumer_directory"] for item in direct_candidates} | {item["provider_directory"] for item in direct_candidates}
    authority_paths = {
        contract["source_authority"]["pe_loader_path"],
        contract["source_authority"]["unix_loader_path"],
        contract["source_authority"]["virtual_memory_path"],
        contract["source_authority"]["winecrt_unix_path"]
    }
    for item in activation_authorities:
        for key in ("consumer_makefile", "provider_makefile", "forwarder_makefile", "prerequisite_makefile"):
            record = _require_makefile_record(modules, item[key], key)
            directories.add(record["directory"])
        authority_paths.update({item["forwarder_spec"], item["forwarder_attach_source"], item["consumer_lazy_source"]})

    sources = collect_source_files(archive, source, directories, authority_paths)
    semantics = prove_loader_semantics(sources, contract)

    relations: list[dict] = []
    for candidate in direct_candidates:
        consumer_attach = attach_init_evidence(candidate["consumer_directory"], sources)
        provider_attach = attach_init_evidence(candidate["provider_directory"], sources)
        if consumer_attach is None or provider_attach is None:
            continue
        relations.append({**candidate, "consumer_attach": consumer_attach, "provider_attach": provider_attach, "preload_order": PRELOAD_ORDER})

    for authority in activation_authorities:
        relations.append(prove_forwarder_activation_relation(authority, modules, sources))

    relations.sort(key=lambda item: (item["consumer_unixlib"], item["provider_unixlib"], item["link_name"], item["relation_kind"]))
    if not relations:
        raise UnixlibPreloadSourceError("no candidate unixlib relation satisfied source semantics")
    keys = [(item["consumer_unixlib"], item["provider_unixlib"]) for item in relations]
    if len(keys) != len(set(keys)):
        raise UnixlibPreloadSourceError("duplicate consumer/provider unixlib preload relation")

    core = {
        "runtime_id": source["runtime_id"],
        "source_archive_sha256": source["upstream"]["archive_sha256"],
        "source_archive_member_count": archive_proof["archive_member_count"],
        "module_makefile_count": len(manifest),
        "module_makefile_manifest_sha256": canonical_sha256(manifest),
        "loader_semantics": semantics,
        "relations": relations
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "source-derived-dependency-attach-unixlib-preloads-not-runtime-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "counts": {
            "candidate_relations": len(direct_candidates) + len(activation_authorities),
            "proven_relations": len(relations),
            "direct_dependency_attach_relations": sum(item["relation_kind"] == DIRECT_RELATION_KIND for item in relations),
            "forwarder_activation_prerequisite_relations": sum(item["relation_kind"] == FORWARDER_RELATION_KIND for item in relations)
        },
        "gates": {
            "source_archive_verified": True,
            "module_makefile_surface_bound": True,
            "normal_pe_import_dependency_semantics_verified": True,
            "dependency_attach_order_verified": True,
            "builtin_unix_path_registration_verified": True,
            "winecrt_memory_query_bridge_verified": True,
            "lazy_unixlib_dlopen_verified": True,
            "source_derived_unixlib_preload_relations_verified": True,
            "unixlib_preload_relations_runtime_verified": False,
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
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("check")
    prove_parser = sub.add_parser("prove")
    prove_parser.add_argument("--source-archive", type=Path, required=True)
    prove_parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility unixlib preload source contract: PASS")
        return 0
    result = prove(args.source_archive.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility source-derived unixlib preloads: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    print("evidence:", result["evidence_sha256"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (UnixlibPreloadSourceError, BUILD.CompatibilityRuntimeBuildError) as exc:
        print(f"windows-compat-runtime-unixlib-preload-source: {exc}", file=sys.stderr)
        raise SystemExit(2)
