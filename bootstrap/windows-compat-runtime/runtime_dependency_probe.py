#!/usr/bin/env python3
"""Discover staged Wine runtime dependencies without executing Wine.

The probe parses ELF metadata directly, models explicit Wine preload state plus
musl loader search semantics for DT_RPATH/DT_RUNPATH and the locked system
search path, resolves rooted symlinks, and maps external files to exact Alpine
package owners. It never executes Wine or a Windows payload.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import struct
import sys

HERE = Path(__file__).resolve().parent
CONTRACT = HERE / "runtime-dependency-discovery.json"
FULL_BUILD_PROBE_PATH = HERE / "full_build_probe.py"
PRELOAD_RUNTIME_PATH = HERE / "runtime_unixlib_preload_runtime_guard.py"

PT_LOAD = 1
PT_DYNAMIC = 2
DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5
DT_STRSZ = 10
DT_RPATH = 15
DT_RUNPATH = 29
ELF_MAGIC = b"\x7fELF"
MUSL_FALLBACK_SEARCH_PATH = "/lib:/usr/local/lib:/usr/lib"
MUSL_ARCH = {
    (64, 62): "x86_64",
    (32, 3): "i386",
}
BOOTSTRAP_SEARCH_SOURCE = "wine-bootstrap-preloaded-shortname"


class RuntimeDependencyError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeDependencyError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FULL_BUILD = load_module("ordax_windows_compat_full_build_for_runtime_dependencies", FULL_BUILD_PROBE_PATH)
PRELOAD_RUNTIME = load_module("ordax_windows_compat_unixlib_preload_runtime", PRELOAD_RUNTIME_PATH)


def _validate_bootstrap_contract(value: dict) -> None:
    inspection = value.get("inspection", {})
    if inspection.get("wine_bootstrap_shortname_reuse_required") is not True:
        raise RuntimeDependencyError("runtime dependency contract does not require Wine bootstrap shortname reuse")
    bootstrap = value.get("loader_bootstrap")
    if not isinstance(bootstrap, dict) or bootstrap.get("model") != "wine-explicit-ntdll-dlopen-before-main":
        raise RuntimeDependencyError("runtime dependency Wine bootstrap model drifted")
    authority = bootstrap.get("source_authority")
    if not isinstance(authority, dict):
        raise RuntimeDependencyError("runtime dependency Wine bootstrap source authority is missing")
    if authority.get("source_lock") != "source.json" or authority.get("wine_version") != "11.0":
        raise RuntimeDependencyError("runtime dependency Wine bootstrap source authority drifted")
    if authority.get("source_path") != "tools/wine/wine.c":
        raise RuntimeDependencyError("runtime dependency Wine bootstrap source path drifted")
    records = bootstrap.get("preloaded_shortnames")
    if not isinstance(records, list) or not records:
        raise RuntimeDependencyError("runtime dependency Wine bootstrap shortname set is missing")
    seen: set[tuple[str, int, int, str]] = set()
    for record in records:
        if not isinstance(record, dict):
            raise RuntimeDependencyError("invalid Wine bootstrap shortname record")
        soname = record.get("soname")
        path = record.get("path")
        identity = record.get("elf")
        if not isinstance(soname, str) or not soname or "/" in soname or "\\" in soname:
            raise RuntimeDependencyError("invalid Wine bootstrap SONAME")
        if not isinstance(path, str) or not path:
            raise RuntimeDependencyError("invalid Wine bootstrap staged path")
        pure = PurePosixPath(path)
        if pure.is_absolute() or ".." in pure.parts or pure.name != soname:
            raise RuntimeDependencyError("unsafe Wine bootstrap staged path")
        if not isinstance(identity, dict):
            raise RuntimeDependencyError("Wine bootstrap ELF identity is missing")
        elf_class = identity.get("class")
        machine = identity.get("machine")
        endianness = identity.get("endianness")
        if elf_class not in (32, 64) or not isinstance(machine, int) or endianness not in ("little", "big"):
            raise RuntimeDependencyError("invalid Wine bootstrap ELF identity")
        key = (soname, elf_class, machine, endianness)
        if key in seen:
            raise RuntimeDependencyError("duplicate Wine bootstrap shortname identity")
        seen.add(key)


def load_contract() -> dict:
    try:
        value = json.loads(CONTRACT.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeDependencyError(f"cannot load runtime dependency contract: {exc}") from exc
    if value.get("$schema") != "prototype-ordax.windows-compat-runtime-dependency-discovery/1":
        raise RuntimeDependencyError("unexpected runtime dependency contract schema")
    if value.get("status") != "discovery-only-not-promotable":
        raise RuntimeDependencyError("runtime dependency discovery status drifted")
    inspection = value.get("inspection", {})
    required_true = (
        "stage_manifest_binding_required",
        "elf_identity_match_required",
        "rooted_symlink_resolution_required",
        "elf_loader_search_path_required",
        "musl_system_path_required",
        "wine_bootstrap_shortname_reuse_required",
    )
    if any(inspection.get(key) is not True for key in required_true):
        raise RuntimeDependencyError("runtime dependency discovery identity/loader boundary drifted")
    expected_false = (
        "host_readelf_allowed",
        "network_allowed",
        "stage_mutation_allowed",
        "rootfs_mutation_allowed",
        "ambient_ld_library_path_allowed",
        "unresolved_dependency_allowed",
        "ambiguous_external_owner_allowed",
    )
    if any(inspection.get(key) is not False for key in expected_false):
        raise RuntimeDependencyError("runtime dependency discovery fail-closed boundary drifted")
    _validate_bootstrap_contract(value)
    promotion = value.get("promotion", {})
    if any(promotion.get(key) is not False for key in promotion):
        raise RuntimeDependencyError("discovery contract claims promotion or execution authority")
    return value


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return sha256_bytes(encoded)


def read_dynamic_string(blob: bytes, offset: int, limit: int, label: str) -> str:
    if offset < 0 or offset >= limit or limit > len(blob):
        raise RuntimeDependencyError(f"ELF {label} string offset is out of bounds")
    end = blob.find(b"\x00", offset, limit)
    if end < 0:
        raise RuntimeDependencyError(f"ELF {label} string is not NUL terminated")
    try:
        return blob[offset:end].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeDependencyError(f"ELF {label} string is not UTF-8") from exc


def read_c_string(blob: bytes, offset: int, limit: int) -> str:
    value = read_dynamic_string(blob, offset, limit, "DT_NEEDED")
    if not value or "/" in value or "\\" in value or value in {".", ".."}:
        raise RuntimeDependencyError(f"unsafe DT_NEEDED value: {value!r}")
    return value


def parse_elf_dynamic(path: Path) -> dict | None:
    data = path.read_bytes()
    if len(data) < 16 or data[:4] != ELF_MAGIC:
        return None
    elf_class_raw = data[4]
    data_encoding = data[5]
    if elf_class_raw not in (1, 2) or data_encoding not in (1, 2):
        raise RuntimeDependencyError(f"unsupported ELF identity: {path}")
    endian = "<" if data_encoding == 1 else ">"
    elf_class = 64 if elf_class_raw == 2 else 32
    endianness = "little" if data_encoding == 1 else "big"
    if len(data) < 20:
        raise RuntimeDependencyError(f"truncated ELF header: {path}")
    machine = struct.unpack_from(endian + "H", data, 18)[0]
    if elf_class_raw == 2:
        if len(data) < 64:
            raise RuntimeDependencyError(f"truncated ELF64 header: {path}")
        e_phoff = struct.unpack_from(endian + "Q", data, 32)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 54)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 56)[0]
        ph_fmt = endian + "IIQQQQQQ"
        dyn_fmt = endian + "QQ"
    else:
        if len(data) < 52:
            raise RuntimeDependencyError(f"truncated ELF32 header: {path}")
        e_phoff = struct.unpack_from(endian + "I", data, 28)[0]
        e_phentsize = struct.unpack_from(endian + "H", data, 42)[0]
        e_phnum = struct.unpack_from(endian + "H", data, 44)[0]
        ph_fmt = endian + "IIIIIIII"
        dyn_fmt = endian + "II"
    ph_size = struct.calcsize(ph_fmt)
    dyn_size = struct.calcsize(dyn_fmt)
    if e_phentsize < ph_size or e_phnum > 4096:
        raise RuntimeDependencyError(f"invalid ELF program-header table: {path}")
    if e_phoff + e_phentsize * e_phnum > len(data):
        raise RuntimeDependencyError(f"ELF program-header table out of bounds: {path}")

    loads: list[tuple[int, int, int]] = []
    dynamic: tuple[int, int] | None = None
    for index in range(e_phnum):
        offset = e_phoff + index * e_phentsize
        fields = struct.unpack_from(ph_fmt, data, offset)
        if elf_class_raw == 2:
            p_type, _, p_offset, p_vaddr, _, p_filesz, _, _ = fields
        else:
            p_type, p_offset, p_vaddr, _, p_filesz, _, _, _ = fields
        if p_offset + p_filesz > len(data):
            raise RuntimeDependencyError(f"ELF segment out of bounds: {path}")
        if p_type == PT_LOAD:
            loads.append((p_vaddr, p_offset, p_filesz))
        elif p_type == PT_DYNAMIC:
            dynamic = (p_offset, p_filesz)

    identity = {"class": elf_class, "machine": machine, "endianness": endianness}
    if dynamic is None:
        return {**identity, "dt_needed": [], "rpath": None, "runpath": None}

    dyn_off, dyn_len = dynamic
    if dyn_len % dyn_size != 0:
        raise RuntimeDependencyError(f"misaligned ELF dynamic section: {path}")
    needed_offsets: list[int] = []
    strtab_vaddr: int | None = None
    strsz: int | None = None
    rpath_offset: int | None = None
    runpath_offset: int | None = None
    for offset in range(dyn_off, dyn_off + dyn_len, dyn_size):
        tag, value = struct.unpack_from(dyn_fmt, data, offset)
        if tag == DT_NULL:
            break
        if tag == DT_NEEDED:
            needed_offsets.append(value)
        elif tag == DT_STRTAB:
            strtab_vaddr = value
        elif tag == DT_STRSZ:
            strsz = value
        elif tag == DT_RPATH:
            rpath_offset = value
        elif tag == DT_RUNPATH:
            runpath_offset = value

    if not needed_offsets and rpath_offset is None and runpath_offset is None:
        return {**identity, "dt_needed": [], "rpath": None, "runpath": None}
    if strtab_vaddr is None or strsz is None or strsz <= 0:
        raise RuntimeDependencyError(f"ELF dynamic strings without valid string table: {path}")

    strtab_file: int | None = None
    for vaddr, file_offset, file_size in loads:
        if vaddr <= strtab_vaddr < vaddr + file_size:
            strtab_file = file_offset + (strtab_vaddr - vaddr)
            break
    if strtab_file is None or strtab_file + strsz > len(data):
        raise RuntimeDependencyError(f"ELF dynamic string table is not file-backed: {path}")

    needed = [read_c_string(data, strtab_file + item, strtab_file + strsz) for item in needed_offsets]
    rpath = None if rpath_offset is None else read_dynamic_string(
        data, strtab_file + rpath_offset, strtab_file + strsz, "DT_RPATH"
    )
    runpath = None if runpath_offset is None else read_dynamic_string(
        data, strtab_file + runpath_offset, strtab_file + strsz, "DT_RUNPATH"
    )
    return {
        **identity,
        "dt_needed": sorted(set(needed)),
        "rpath": rpath,
        "runpath": runpath,
    }


def parse_dt_needed(path: Path) -> list[str] | None:
    info = parse_elf_dynamic(path)
    return None if info is None else info["dt_needed"]


def safe_relative(root: Path, path: Path) -> str:
    relative = path.relative_to(root).as_posix()
    pure = PurePosixPath(relative)
    if pure.is_absolute() or ".." in pure.parts:
        raise RuntimeDependencyError(f"unsafe relative path: {path}")
    return relative


def normalize_rooted_relative(path: PurePosixPath) -> PurePosixPath:
    parts: list[str] = []
    for part in path.parts:
        if part in {"", ".", "/"}:
            continue
        if part == "..":
            if not parts:
                raise RuntimeDependencyError(f"rooted path escapes dependency tree: {path}")
            parts.pop()
            continue
        parts.append(part)
    return PurePosixPath(*parts)


def resolve_rooted_path(root: Path, path: Path) -> str:
    root = root.resolve()
    try:
        relative = normalize_rooted_relative(PurePosixPath(path.relative_to(root).as_posix()))
    except ValueError as exc:
        raise RuntimeDependencyError(f"path is outside dependency tree: {path}") from exc
    for _ in range(41):
        parts = list(relative.parts)
        prefix: list[str] = []
        changed = False
        for index, part in enumerate(parts):
            prefix.append(part)
            candidate = root.joinpath(*prefix)
            if not candidate.is_symlink():
                continue
            target = PurePosixPath(candidate.readlink().as_posix())
            tail = PurePosixPath(*parts[index + 1 :])
            if target.is_absolute():
                target = PurePosixPath(*target.parts[1:])
                combined = target / tail
            else:
                combined = PurePosixPath(*prefix[:-1]) / target / tail
            relative = normalize_rooted_relative(combined)
            changed = True
            break
        if changed:
            continue
        final = root.joinpath(*relative.parts)
        if not final.is_file():
            raise RuntimeDependencyError(f"dependency candidate does not resolve to a regular file: {path}")
        return relative.as_posix()
    raise RuntimeDependencyError(f"too many symlink hops while resolving dependency candidate: {path}")


def elf_identity(info: dict) -> tuple[int, int, str]:
    return (info["class"], info["machine"], info["endianness"])


def build_soname_index(root: Path) -> dict[str, list[dict]]:
    index: dict[str, list[dict]] = {}
    root = root.resolve()
    for path in sorted(root.rglob("*")):
        if not (path.is_file() or path.is_symlink()):
            continue
        name = path.name
        if ".so" not in name and not name.startswith("ld-musl-"):
            continue
        relative = safe_relative(root, path)
        canonical = resolve_rooted_path(root, path)
        info = parse_elf_dynamic(root / canonical)
        if info is None:
            continue
        index.setdefault(name, []).append({
            "path": relative,
            "canonical_path": canonical,
            "class": info["class"],
            "machine": info["machine"],
            "endianness": info["endianness"],
        })
    return index


def parse_apk_installed(rootfs: Path) -> tuple[dict[str, str], dict[str, tuple[str, str]]]:
    database = rootfs / "lib/apk/db/installed"
    try:
        lines = database.read_text(encoding="utf-8", errors="strict").splitlines()
    except OSError as exc:
        raise RuntimeDependencyError(f"cannot read Alpine installed database: {exc}") from exc
    versions: dict[str, str] = {}
    owners: dict[str, tuple[str, str]] = {}
    package = version = current_dir = None

    def flush_identity() -> None:
        if package and version:
            existing = versions.get(package)
            if existing is not None and existing != version:
                raise RuntimeDependencyError(f"duplicate Alpine package identity: {package}")
            versions[package] = version

    for line in lines + [""]:
        if line == "":
            flush_identity()
            package = version = current_dir = None
            continue
        prefix, sep, value = line.partition(":")
        if not sep:
            continue
        if prefix == "P":
            package = value
        elif prefix == "V":
            version = value
        elif prefix == "F":
            current_dir = value.strip("/")
        elif prefix == "R" and package and version and current_dir is not None:
            candidate = (PurePosixPath(current_dir) / value).as_posix().lstrip("/")
            if ".." in PurePosixPath(candidate).parts:
                raise RuntimeDependencyError("unsafe file path in Alpine installed database")
            owner = owners.get(candidate)
            identity = (package, version)
            if owner is not None and owner != identity:
                raise RuntimeDependencyError(f"ambiguous Alpine file owner: {candidate}")
            owners[candidate] = identity
    if not versions or not owners:
        raise RuntimeDependencyError("Alpine installed database produced no package ownership data")
    return versions, owners


def split_path_list(value: str, label: str) -> list[str]:
    values: list[str] = []
    for line in value.splitlines():
        for item in line.split(":"):
            item = item.strip()
            if not item:
                raise RuntimeDependencyError(f"empty entry in {label} is not allowed")
            values.append(item)
    if not values:
        raise RuntimeDependencyError(f"{label} produced no search directories")
    return values


def expand_loader_directory(value: str, consumer_relative: str, label: str) -> str:
    parent = PurePosixPath("/" + consumer_relative).parent.as_posix()
    expanded = value.replace("${ORIGIN}", parent).replace("$ORIGIN", parent)
    if "$" in expanded:
        raise RuntimeDependencyError(f"unsupported loader token in {label}: {value!r}")
    path = PurePosixPath(expanded)
    if not path.is_absolute():
        raise RuntimeDependencyError(f"relative loader search directory is not allowed in {label}: {value!r}")
    rooted = normalize_rooted_relative(path)
    if not rooted.parts:
        raise RuntimeDependencyError(f"root loader search directory is not allowed in {label}")
    return rooted.as_posix()


def musl_arch_name(elf: dict) -> str:
    key = (elf["class"], elf["machine"])
    arch = MUSL_ARCH.get(key)
    if arch is None:
        raise RuntimeDependencyError(
            f"unsupported musl loader identity ELF{elf['class']}/machine={elf['machine']}"
        )
    return arch


def musl_system_search_directories(rootfs: Path, elf: dict) -> list[dict]:
    arch = musl_arch_name(elf)
    config = rootfs / f"etc/ld-musl-{arch}.path"
    if config.exists():
        try:
            raw = config.read_text(encoding="utf-8", errors="strict")
        except OSError as exc:
            raise RuntimeDependencyError(f"cannot read musl system search path: {exc}") from exc
        source = f"/etc/ld-musl-{arch}.path"
    else:
        raw = MUSL_FALLBACK_SEARCH_PATH
        source = "musl-built-in-fallback"
    return [
        {"directory": expand_loader_directory(item, "usr/bin/placeholder", source), "source": source}
        for item in split_path_list(raw, source)
    ]


def loader_search_directories(consumer_relative: str, elf: dict, rootfs: Path) -> list[dict]:
    result: list[dict] = []
    dynamic_value = elf.get("runpath") if elf.get("runpath") is not None else elf.get("rpath")
    dynamic_label = "DT_RUNPATH" if elf.get("runpath") is not None else "DT_RPATH"
    if dynamic_value is not None:
        for item in split_path_list(dynamic_value, dynamic_label):
            result.append({
                "directory": expand_loader_directory(item, consumer_relative, dynamic_label),
                "source": dynamic_label,
            })
    result.extend(musl_system_search_directories(rootfs, elf))
    deduped: list[dict] = []
    seen: set[str] = set()
    for item in result:
        if item["directory"] in seen:
            continue
        seen.add(item["directory"])
        deduped.append(item)
    return deduped


def candidates_in_directory(
    index: dict[str, list[dict]], soname: str, consumer: dict, directory: str, scope: str
) -> dict | None:
    identity = elf_identity(consumer)
    candidates = [
        item
        for item in index.get(soname, [])
        if PurePosixPath(item["path"]).parent.as_posix() == directory
        and (item["class"], item["machine"], item["endianness"]) == identity
    ]
    if not candidates:
        return None
    canonical_paths = sorted({item["canonical_path"] for item in candidates})
    if len(canonical_paths) != 1:
        details = sorted(f"{item['path']}->{item['canonical_path']}" for item in candidates)
        raise RuntimeDependencyError(
            f"ambiguous {scope} resolution for {soname} in /{directory} "
            f"ELF{identity[0]}/machine={identity[1]}/{identity[2]}: {details}"
        )
    paths = sorted({item["path"] for item in candidates})
    return {
        "path": paths[0],
        "candidate_paths": paths,
        "canonical_path": canonical_paths[0],
        "class": identity[0],
        "machine": identity[1],
        "endianness": identity[2],
    }


def resolve_bootstrap_shortname(stage: Path, soname: str, consumer: dict, contract: dict | None = None) -> dict | None:
    contract = contract or load_contract()
    identity = elf_identity(consumer)
    records = []
    for record in contract["loader_bootstrap"]["preloaded_shortnames"]:
        expected = record["elf"]
        if record["soname"] == soname and (
            expected["class"], expected["machine"], expected["endianness"]
        ) == identity:
            records.append(record)
    if not records:
        return None
    if len(records) != 1:
        raise RuntimeDependencyError(f"ambiguous Wine bootstrap shortname declaration: {soname} {identity}")
    record = records[0]
    relative = PurePosixPath(record["path"])
    candidate = stage.joinpath(*relative.parts)
    if not (candidate.exists() or candidate.is_symlink()):
        raise RuntimeDependencyError(f"Wine bootstrap shortname target is missing: {record['path']}")
    try:
        canonical = resolve_rooted_path(stage, candidate)
        info = parse_elf_dynamic(stage / canonical)
    except (RuntimeDependencyError, OSError) as exc:
        raise RuntimeDependencyError(f"invalid Wine bootstrap shortname target {record['path']}: {exc}") from exc
    if info is None:
        raise RuntimeDependencyError(f"Wine bootstrap shortname target is not ELF: {record['path']}")
    actual = elf_identity(info)
    if actual != identity:
        raise RuntimeDependencyError(
            f"Wine bootstrap shortname ELF identity mismatch for {soname}: expected={identity} actual={actual}"
        )
    return {
        "path": record["path"],
        "candidate_paths": [record["path"]],
        "canonical_path": canonical,
        "class": identity[0],
        "machine": identity[1],
        "endianness": identity[2],
        "scope": "stage-internal",
        "resolution_kind": "bootstrap-shortname-reuse",
        "search_directory": None,
        "search_source": BOOTSTRAP_SEARCH_SOURCE,
        "search_position": None,
    }


def resolve_dependency_attach_preload(
    stage: Path,
    consumer_relative: str,
    soname: str,
    consumer: dict,
    preload_source_proof: dict,
) -> dict | None:
    try:
        return PRELOAD_RUNTIME.resolve_preloaded_unixlib(
            stage,
            consumer_relative,
            soname,
            consumer,
            preload_source_proof,
            parse_elf=parse_elf_dynamic,
            elf_identity=elf_identity,
            resolve_rooted_path=resolve_rooted_path,
        )
    except PRELOAD_RUNTIME.UnixlibPreloadRuntimeError as exc:
        raise RuntimeDependencyError(str(exc)) from exc


def resolve_loader_dependency(
    stage_index: dict[str, list[dict]],
    rootfs_index: dict[str, list[dict]],
    soname: str,
    consumer: dict,
    consumer_relative: str,
    rootfs: Path,
    *,
    stage: Path | None = None,
    contract: dict | None = None,
    preload_source_proof: dict | None = None,
) -> tuple[dict | None, list[dict]]:
    search = loader_search_directories(consumer_relative, consumer, rootfs)
    if stage is not None:
        bootstrap = resolve_bootstrap_shortname(stage, soname, consumer, contract)
        if bootstrap is not None:
            return bootstrap, search
        if preload_source_proof is not None:
            preload = resolve_dependency_attach_preload(stage, consumer_relative, soname, consumer, preload_source_proof)
            if preload is not None:
                return preload, search
    for position, item in enumerate(search):
        directory = item["directory"]
        staged = candidates_in_directory(stage_index, soname, consumer, directory, "stage")
        external = candidates_in_directory(rootfs_index, soname, consumer, directory, "rootfs")
        if staged is not None and external is not None:
            raise RuntimeDependencyError(
                f"cross-scope loader collision for {soname} at /{directory}: "
                f"stage={staged['candidate_paths']} rootfs={external['candidate_paths']}"
            )
        selected = staged if staged is not None else external
        if selected is not None:
            return {
                **selected,
                "scope": "stage-internal" if staged is not None else "rootfs-external",
                "resolution_kind": "loader-pathname",
                "search_directory": "/" + directory,
                "search_source": item["source"],
                "search_position": position,
            }, search
    return None, search


def require_single_apk_owner(candidate: dict, owners: dict[str, tuple[str, str]]) -> tuple[str, str]:
    paths = sorted(set(candidate["candidate_paths"] + [candidate["canonical_path"]]))
    identities: set[tuple[str, str]] = set()
    for path in paths:
        owner = owners.get(path)
        if owner is None:
            raise RuntimeDependencyError(f"resolved external dependency has no Alpine owner: {path}")
        identities.add(owner)
    if len(identities) != 1:
        raise RuntimeDependencyError(f"resolved external dependency crosses Alpine owners: {paths}")
    return next(iter(identities))


def verify_stage_binding(stage: Path, full_build_proof: dict) -> str:
    staging = full_build_proof.get("staging")
    if not isinstance(staging, dict):
        raise RuntimeDependencyError("full build proof staging metadata is missing")
    expected_digest = staging.get("canonical_manifest_sha256")
    if not isinstance(expected_digest, str) or len(expected_digest) != 64 or any(
        ch not in "0123456789abcdef" for ch in expected_digest
    ):
        raise RuntimeDependencyError("full build proof staging manifest digest is invalid")
    try:
        manifest, total_regular_bytes = FULL_BUILD.staging_manifest(stage)
    except (FULL_BUILD.FullBuildProofError, OSError) as exc:
        raise RuntimeDependencyError(f"cannot verify staged tree against full build proof: {exc}") from exc
    actual_digest = FULL_BUILD.canonical_manifest_sha256(manifest)
    actual_metadata = {
        "entry_count": len(manifest),
        "regular_file_count": sum(1 for item in manifest.values() if item.get("type") == "file"),
        "symlink_count": sum(1 for item in manifest.values() if item.get("type") == "symlink"),
        "total_regular_bytes": total_regular_bytes,
        "canonical_manifest_sha256": actual_digest,
    }
    expected_metadata = {
        "entry_count": staging.get("entry_count"),
        "regular_file_count": staging.get("regular_file_count"),
        "symlink_count": staging.get("symlink_count"),
        "total_regular_bytes": staging.get("total_regular_bytes"),
        "canonical_manifest_sha256": expected_digest,
    }
    if actual_metadata != expected_metadata:
        raise RuntimeDependencyError(
            "staged tree does not match full build proof metadata: "
            f"expected={expected_metadata} actual={actual_metadata}"
        )
    return actual_digest


def discover(stage: Path, rootfs: Path, full_build_proof: dict, preload_source_proof: dict) -> dict:
    contract = load_contract()
    if full_build_proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise RuntimeDependencyError("unexpected full build proof schema")
    gates = full_build_proof.get("gates", {})
    if gates.get("full_build_proof_passed") is not True or gates.get("staged_install_completed") is not True:
        raise RuntimeDependencyError("runtime dependency discovery requires a proven staged full build")
    forbidden = (
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "windows_payload_executed",
        "wine_executed",
    )
    if any(gates.get(key) is not False for key in forbidden):
        raise RuntimeDependencyError("full build proof crossed a forbidden promotion/execution boundary")
    if full_build_proof.get("runtime_id") != contract.get("runtime_id"):
        raise RuntimeDependencyError("runtime identity drifted")
    try:
        PRELOAD_RUNTIME.validate_source_proof(preload_source_proof, contract["runtime_id"])
    except PRELOAD_RUNTIME.UnixlibPreloadRuntimeError as exc:
        raise RuntimeDependencyError(str(exc)) from exc
    if not stage.is_dir() or not rootfs.is_dir():
        raise RuntimeDependencyError("staged tree or locked rootfs is missing")

    stage_manifest_sha256 = verify_stage_binding(stage, full_build_proof)
    stage_index = build_soname_index(stage)
    rootfs_index = build_soname_index(rootfs)
    package_versions, owners = parse_apk_installed(rootfs)
    elf_files: dict[str, dict] = {}
    external: dict[str, dict] = {}
    unresolved: list[dict] = []

    for path in sorted(stage.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        elf = parse_elf_dynamic(path)
        if elf is None:
            continue
        needed = elf["dt_needed"]
        relative = safe_relative(stage, path)
        resolutions = []
        loader_search = loader_search_directories(relative, elf, rootfs) if needed else []
        for soname in needed:
            candidate, search = resolve_loader_dependency(
                stage_index,
                rootfs_index,
                soname,
                elf,
                relative,
                rootfs,
                stage=stage,
                contract=contract,
                preload_source_proof=preload_source_proof,
            )
            if candidate is None:
                unresolved.append({
                    "consumer": relative,
                    "soname": soname,
                    "elf": {
                        "class": elf["class"],
                        "machine": elf["machine"],
                        "endianness": elf["endianness"],
                    },
                    "loader_search": search,
                })
                continue
            resolution = {
                "soname": soname,
                "scope": candidate["scope"],
                "path": candidate["path"],
                "canonical_path": candidate["canonical_path"],
                "resolution_kind": candidate["resolution_kind"],
                "search_directory": candidate["search_directory"],
                "search_source": candidate["search_source"],
                "search_position": candidate["search_position"],
            }
            if candidate["resolution_kind"] == "source-proven-dependency-attach-preload":
                resolution["unixlib_preload_source_evidence_sha256"] = candidate[
                    "unixlib_preload_source_evidence_sha256"
                ]
                resolution["preload_relation"] = candidate["preload_relation"]
            if candidate["scope"] == "rootfs-external":
                package, version = require_single_apk_owner(candidate, owners)
                if package_versions.get(package) != version:
                    raise RuntimeDependencyError(f"Alpine package version drifted for owner: {package}")
                resolution["package"] = package
                resolution["version"] = version
                record = external.setdefault(package, {"version": version, "files": {}, "sonames": set()})
                if record["version"] != version:
                    raise RuntimeDependencyError(f"external runtime package version conflict: {package}")
                record["files"][candidate["path"]] = soname
                record["sonames"].add(soname)
            resolutions.append(resolution)
        elf_files[relative] = {
            "elf": {
                "class": elf["class"],
                "machine": elf["machine"],
                "endianness": elf["endianness"],
            },
            "rpath": elf["rpath"],
            "runpath": elf["runpath"],
            "loader_search": loader_search,
            "dt_needed": needed,
            "resolutions": resolutions,
        }

    if unresolved:
        raise RuntimeDependencyError(f"unresolved staged ELF dependencies: {unresolved[:20]}")
    if not elf_files:
        raise RuntimeDependencyError("staged Wine tree contained no ELF files")
    if not external:
        raise RuntimeDependencyError("staged Wine tree produced no external runtime dependencies")

    external_json = {
        name: {
            "version": value["version"],
            "files": dict(sorted(value["files"].items())),
            "sonames": sorted(value["sonames"]),
        }
        for name, value in sorted(external.items())
    }
    inventory_core = {
        "runtime_id": full_build_proof["runtime_id"],
        "staging_manifest_sha256": stage_manifest_sha256,
        "elf_files": elf_files,
        "external_packages": external_json,
    }
    return {
        "$schema": "prototype-ordax.windows-compat-runtime-dependency-proof/1",
        "status": "runtime-dependencies-discovered-not-content-pinned-not-executable",
        **inventory_core,
        "inventory_sha256": canonical_sha256(inventory_core),
        "counts": {
            "elf_files": len(elf_files),
            "external_packages": len(external_json),
            "external_sonames": len({soname for item in external_json.values() for soname in item["sonames"]}),
        },
        "gates": {
            "full_build_proof_verified": True,
            "loader_resolution_verified": True,
            "staging_dependency_inventory_complete": True,
            "runtime_dependency_inventory_complete": False,
            "runtime_package_content_hashes_pinned": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "wine_executed": False,
            "windows_payload_executed": False,
        },
    }


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeDependencyError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise RuntimeDependencyError(f"{label} must be an object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "discover"])
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--unixlib-preload-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility runtime dependency discovery contract: PASS")
        return 0
    if not all((args.stage_dir, args.rootfs, args.full_build_proof, args.unixlib_preload_source_proof, args.out)):
        raise RuntimeDependencyError(
            "discover requires --stage-dir, --rootfs, --full-build-proof, --unixlib-preload-source-proof and --out"
        )
    result = discover(
        args.stage_dir.resolve(),
        args.rootfs.resolve(),
        load_json(args.full_build_proof, "full build proof"),
        load_json(args.unixlib_preload_source_proof, "unixlib preload source proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (RuntimeDependencyError, PRELOAD_RUNTIME.UnixlibPreloadRuntimeError) as exc:
        print(f"windows-compat-runtime-dependencies: {exc}", file=sys.stderr)
        raise SystemExit(2)
