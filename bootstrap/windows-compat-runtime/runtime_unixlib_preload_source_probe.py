#!/usr/bin/env python3
"""Derive Wine builtin unixlib dependency-attach preload relations from locked source.

The proof is source-only. It derives consumer/provider unixlib relations from
Makefile.in metadata, requires a normal PE import plus the matching Unix link
flag, proves both modules initialize their unixlib during DLL_PROCESS_ATTACH,
and binds the Wine loader semantics that initialize PE dependencies before the
consumer and dlopen the registered unixlib lazily. It never executes Wine.
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
DYNAMIC_PATH = HERE / "runtime_dynamic_load_source_probe.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-unixlib-preload-source-proof/1"
MAX_TEXT_BYTES = 4 * 1024 * 1024
MAKEFILE_RE = re.compile(r"^dlls/[^/]+/Makefile\.in$")
ASSIGN_RE = re.compile(r"^\s*([A-Z][A-Z0-9_]*)\s*(\+?=)\s*(.*?)\s*$")
LINK_RE = re.compile(r"^-l([A-Za-z0-9_+.-]+)$")


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
DYNAMIC = load_module("ordax_unixlib_preload_dynamic", DYNAMIC_PATH)


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
        "winecrt_memory_query_bridge_required",
        "builtin_unix_path_registration_required",
        "lazy_unixlib_dlopen_required",
        "comments_must_not_satisfy_source_anchors",
        "line_numbers_are_not_authority",
    )
    if any(derivation.get(key) is not True for key in required):
        raise UnixlibPreloadSourceError("unixlib preload derivation guarantees drifted")
    authority = value.get("source_authority")
    expected_authority = {
        "pe_loader_path": "dlls/ntdll/loader.c",
        "unix_loader_path": "dlls/ntdll/unix/loader.c",
        "virtual_memory_path": "dlls/ntdll/unix/virtual.c",
        "winecrt_unix_path": "dlls/winecrt0/unix_lib.c",
    }
    if authority != expected_authority:
        raise UnixlibPreloadSourceError("unixlib preload source authority paths drifted")
    promotion = value.get("promotion", {})
    if not promotion or any(flag is not False for flag in promotion.values()):
        raise UnixlibPreloadSourceError("unixlib preload source contract claims promotion or execution")
    return value


def normalized_code(text: str) -> str:
    comments_removed, _ = DYNAMIC.lexical_views(text)
    return re.sub(r"\s+", " ", comments_removed).strip()


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
        link_names = []
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
        raise UnixlibPreloadSourceError(f"locked source lacks loader authority files: {missing}")
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

    query = require_fragment(
        winecrt,
        "return NtQueryVirtualMemory( GetCurrentProcess(), image_base(), MemoryWineUnixFuncs, &__wine_unixlib_handle, sizeof(__wine_unixlib_handle), NULL );",
        "winecrt unix init",
    )
    case = require_fragment(virtual, "case MemoryWineUnixFuncs:", "MemoryWineUnixFuncs handler")
    bridge = require_fragment(
        virtual,
        "status = get_builtin_unix_funcs( module, info_class == MemoryWineUnixWow64Funcs, &funcs );",
        "builtin unix funcs bridge",
    )
    dlopen = require_fragment(virtual, "builtin->unix_handle = dlopen( builtin->unix_path, RTLD_NOW );", "builtin unixlib dlopen")
    if bridge <= case or dlopen <= 0 or query < 0:
        raise UnixlibPreloadSourceError("Wine unixlib initialization bridge ordering drifted")

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
    candidates = derive_candidate_relations(modules)
    if not candidates:
        raise UnixlibPreloadSourceError("locked source produced no candidate internal unixlib preload relations")
    directories = {item["consumer_directory"] for item in candidates} | {item["provider_directory"] for item in candidates}
    authority_paths = set(contract["source_authority"].values())
    sources = collect_source_files(archive, source, directories, authority_paths)
    semantics = prove_loader_semantics(sources, contract)

    relations: list[dict] = []
    for candidate in candidates:
        consumer_attach = attach_init_evidence(candidate["consumer_directory"], sources)
        provider_attach = attach_init_evidence(candidate["provider_directory"], sources)
        if consumer_attach is None or provider_attach is None:
            continue
        relations.append({
            **candidate,
            "consumer_attach": consumer_attach,
            "provider_attach": provider_attach,
            "preload_order": "provider-pe-dependency-attach-before-consumer-unixlib-dlopen",
        })
    relations.sort(key=lambda item: (item["consumer_unixlib"], item["provider_unixlib"], item["link_name"]))
    if not relations:
        raise UnixlibPreloadSourceError("no candidate unixlib relation satisfied attach semantics")
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
        "relations": relations,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "source-derived-dependency-attach-unixlib-preloads-not-runtime-complete",
        **core,
        "evidence_sha256": canonical_sha256(core),
        "counts": {
            "candidate_relations": len(candidates),
            "proven_relations": len(relations),
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
            "windows_payload_executed": False,
        },
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
    except (
        UnixlibPreloadSourceError,
        BUILD.CompatibilityRuntimeBuildError,
        DYNAMIC.DynamicLoadDiscoveryError,
    ) as exc:
        print(f"windows-compat-runtime-unixlib-preload-source: {exc}", file=sys.stderr)
        raise SystemExit(2)
