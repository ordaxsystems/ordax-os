#!/usr/bin/env python3
"""Discover runtime dependencies of a staged Wine build without executing it.

The probe parses ELF program headers and DT_NEEDED directly in Python, resolves
SONAMEs against the staged tree first and the locked Alpine rootfs second, and
maps external rootfs files back to exact Alpine package name/version using the
installed package database. It never executes Wine or a Windows payload.
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

PT_LOAD = 1
PT_DYNAMIC = 2
DT_NULL = 0
DT_NEEDED = 1
DT_STRTAB = 5
DT_STRSZ = 10
ELF_MAGIC = b"\x7fELF"


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
    )
    if any(inspection.get(key) is not True for key in required_true):
        raise RuntimeDependencyError("runtime dependency discovery identity/binding boundary drifted")
    expected_false = (
        "host_readelf_allowed",
        "network_allowed",
        "stage_mutation_allowed",
        "rootfs_mutation_allowed",
        "unresolved_dependency_allowed",
        "ambiguous_external_owner_allowed",
    )
    if any(inspection.get(key) is not False for key in expected_false):
        raise RuntimeDependencyError("runtime dependency discovery fail-closed boundary drifted")
    promotion = value.get("promotion", {})
    if any(promotion.get(key) is not False for key in promotion):
        raise RuntimeDependencyError("discovery contract claims promotion or execution authority")
    return value


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical_sha256(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    return sha256_bytes(encoded)


def read_c_string(blob: bytes, offset: int, limit: int) -> str:
    if offset < 0 or offset >= limit or limit > len(blob):
        raise RuntimeDependencyError("ELF dynamic string offset is out of bounds")
    end = blob.find(b"\x00", offset, limit)
    if end < 0:
        raise RuntimeDependencyError("ELF dynamic string is not NUL terminated")
    try:
        value = blob[offset:end].decode("utf-8")
    except UnicodeDecodeError as exc:
        raise RuntimeDependencyError("ELF dynamic string is not UTF-8") from exc
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
    table_end = e_phoff + e_phentsize * e_phnum
    if e_phoff < 0 or table_end > len(data):
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

    identity = {
        "class": elf_class,
        "machine": machine,
        "endianness": endianness,
    }
    if dynamic is None:
        return {**identity, "dt_needed": []}

    dyn_off, dyn_len = dynamic
    if dyn_len % dyn_size != 0:
        raise RuntimeDependencyError(f"misaligned ELF dynamic section: {path}")
    needed_offsets: list[int] = []
    strtab_vaddr: int | None = None
    strsz: int | None = None
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
    if not needed_offsets:
        return {**identity, "dt_needed": []}
    if strtab_vaddr is None or strsz is None or strsz <= 0:
        raise RuntimeDependencyError(f"ELF DT_NEEDED without valid string table: {path}")

    strtab_file: int | None = None
    for vaddr, file_offset, file_size in loads:
        if vaddr <= strtab_vaddr < vaddr + file_size:
            strtab_file = file_offset + (strtab_vaddr - vaddr)
            break
    if strtab_file is None or strtab_file + strsz > len(data):
        raise RuntimeDependencyError(f"ELF dynamic string table is not file-backed: {path}")
    names = [read_c_string(data, strtab_file + item, strtab_file + strsz) for item in needed_offsets]
    return {**identity, "dt_needed": sorted(set(names))}


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
                raise RuntimeDependencyError(f"rooted symlink escapes dependency tree: {path}")
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
        if ".so" not in name and name not in {"ld-musl-x86_64.so.1", "ld-musl-i386.so.1"}:
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


def resolve_candidate(index: dict[str, list[dict]], soname: str, consumer: dict, scope: str) -> dict | None:
    identity = elf_identity(consumer)
    candidates = [
        item
        for item in index.get(soname, [])
        if (item["class"], item["machine"], item["endianness"]) == identity
    ]
    if not candidates:
        return None
    canonical_paths = sorted({item["canonical_path"] for item in candidates})
    if len(canonical_paths) != 1:
        details = sorted(f"{item['path']}->{item['canonical_path']}" for item in candidates)
        raise RuntimeDependencyError(
            f"ambiguous {scope} resolution for {soname} "
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
    if not isinstance(expected_digest, str) or len(expected_digest) != 64 or any(ch not in "0123456789abcdef" for ch in expected_digest):
        raise RuntimeDependencyError("full build proof staging manifest digest is invalid")
    try:
        manifest, total_regular_bytes = FULL_BUILD.staging_manifest(stage)
    except (FULL_BUILD.FullBuildProofError, OSError) as exc:
        raise RuntimeDependencyError(f"cannot verify staged tree against full build proof: {exc}") from exc
    actual_digest = FULL_BUILD.canonical_manifest_sha256(manifest)
    regular_files = sum(1 for item in manifest.values() if item.get("type") == "file")
    symlinks = sum(1 for item in manifest.values() if item.get("type") == "symlink")
    actual_metadata = {
        "entry_count": len(manifest),
        "regular_file_count": regular_files,
        "symlink_count": symlinks,
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


def discover(stage: Path, rootfs: Path, full_build_proof: dict) -> dict:
    contract = load_contract()
    if full_build_proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise RuntimeDependencyError("unexpected full build proof schema")
    gates = full_build_proof.get("gates", {})
    if gates.get("full_build_proof_passed") is not True or gates.get("staged_install_completed") is not True:
        raise RuntimeDependencyError("runtime dependency discovery requires a proven staged full build")
    if any(gates.get(key) is not False for key in ("runtime_dependency_inventory_complete", "binary_artifact_pinned", "activation_authorized", "execution_authorized", "windows_payload_executed", "wine_executed")):
        raise RuntimeDependencyError("full build proof crossed a forbidden promotion/execution boundary")
    if full_build_proof.get("runtime_id") != contract.get("runtime_id"):
        raise RuntimeDependencyError("runtime identity drifted")
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
        for soname in needed:
            staged = resolve_candidate(stage_index, soname, elf, "stage")
            if staged is not None:
                resolutions.append({
                    "soname": soname,
                    "scope": "stage-internal",
                    "path": staged["path"],
                    "canonical_path": staged["canonical_path"],
                })
                continue
            external_candidate = resolve_candidate(rootfs_index, soname, elf, "rootfs")
            if external_candidate is None:
                unresolved.append({
                    "consumer": relative,
                    "soname": soname,
                    "elf": {
                        "class": elf["class"],
                        "machine": elf["machine"],
                        "endianness": elf["endianness"],
                    },
                })
                continue
            package, version = require_single_apk_owner(external_candidate, owners)
            if package_versions.get(package) != version:
                raise RuntimeDependencyError(f"Alpine package version drifted for owner: {package}")
            external_path = external_candidate["path"]
            resolutions.append({
                "soname": soname,
                "scope": "rootfs-external",
                "path": external_path,
                "canonical_path": external_candidate["canonical_path"],
                "package": package,
                "version": version,
            })
            record = external.setdefault(package, {"version": version, "files": {}, "sonames": set()})
            if record["version"] != version:
                raise RuntimeDependencyError(f"external runtime package version conflict: {package}")
            record["files"][external_path] = soname
            record["sonames"].add(soname)
        elf_files[relative] = {
            "elf": {
                "class": elf["class"],
                "machine": elf["machine"],
                "endianness": elf["endianness"],
            },
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


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "discover"])
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility runtime dependency discovery contract: PASS")
        return 0
    if not all((args.stage_dir, args.rootfs, args.full_build_proof, args.out)):
        raise RuntimeDependencyError("discover requires --stage-dir, --rootfs, --full-build-proof and --out")
    try:
        proof = json.loads(args.full_build_proof.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise RuntimeDependencyError(f"cannot load full build proof: {exc}") from exc
    result = discover(args.stage_dir.resolve(), args.rootfs.resolve(), proof)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeDependencyError as exc:
        print(f"windows-compat-runtime-dependencies: {exc}", file=sys.stderr)
        raise SystemExit(2)
