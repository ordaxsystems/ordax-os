#!/usr/bin/env python3
"""Fail closed on Wine preloads and musl first-pathname resolution.

Wine 11.0 explicitly loads architecture ntdll.so before __wine_main and may
also preload builtin Unix libraries through normal PE dependency attach. Both
shortname mechanisms require independent source authority plus exact staged ELF
bytes. All remaining DT_NEEDED edges retain strict first-existing-pathname
semantics: an incompatible, non-ELF, broken or escaping first pathname may never
be skipped for a later hit.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path, PurePosixPath
import sys

HERE = Path(__file__).resolve().parent
PROBE_PATH = HERE / "runtime_dependency_probe.py"
PRELOAD_PATH = HERE / "runtime_unixlib_preload_runtime_guard.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-first-hit-proof/1"


class FirstHitGuardError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise FirstHitGuardError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PROBE = load_module("ordax_windows_compat_runtime_dependency_probe_for_first_hit", PROBE_PATH)
PRELOAD = load_module("ordax_windows_compat_unixlib_preload_for_first_hit", PRELOAD_PATH)


def load_contract() -> dict:
    contract = PROBE.load_contract()
    inspection = contract.get("inspection", {})
    if inspection.get("first_pathname_hit_validation_required") is not True:
        raise FirstHitGuardError("runtime dependency contract does not require first-pathname-hit validation")
    if inspection.get("first_pathname_hit_proof_required") is not True:
        raise FirstHitGuardError("runtime dependency contract does not require durable first-hit proof")
    if inspection.get("wine_bootstrap_shortname_reuse_required") is not True:
        raise FirstHitGuardError("runtime dependency contract does not require Wine bootstrap shortname reuse")
    return contract


def _safe_relative_candidate(directory: str, soname: str) -> PurePosixPath:
    relative = PurePosixPath(directory) / soname
    if relative.is_absolute() or not relative.parts or ".." in relative.parts:
        raise FirstHitGuardError(f"unsafe loader candidate path: {relative}")
    return relative


def direct_loader_hit(root: Path, directory: str, soname: str) -> dict | None:
    root = root.resolve()
    relative = _safe_relative_candidate(directory, soname)
    candidate = root.joinpath(*relative.parts)
    if not (candidate.exists() or candidate.is_symlink()):
        return None
    try:
        canonical = PROBE.resolve_rooted_path(root, candidate)
        elf = PROBE.parse_elf_dynamic(root / canonical)
    except (PROBE.RuntimeDependencyError, OSError) as exc:
        raise FirstHitGuardError(f"invalid first loader pathname /{relative}: {exc}") from exc
    return {
        "path": relative.as_posix(),
        "canonical_path": canonical,
        "elf": elf,
    }


def resolve_first_pathname_hit(
    stage: Path,
    rootfs: Path,
    soname: str,
    consumer: dict,
    consumer_relative: str,
) -> tuple[dict | None, list[dict]]:
    search = PROBE.loader_search_directories(consumer_relative, consumer, rootfs)
    expected_identity = PROBE.elf_identity(consumer)
    for position, item in enumerate(search):
        directory = item["directory"]
        staged = direct_loader_hit(stage, directory, soname)
        external = direct_loader_hit(rootfs, directory, soname)
        if staged is not None and external is not None:
            raise FirstHitGuardError(
                f"cross-scope first pathname collision for {soname} at /{directory}: "
                f"stage={staged['path']} rootfs={external['path']}"
            )
        hit = staged if staged is not None else external
        if hit is None:
            continue
        if hit["elf"] is None:
            raise FirstHitGuardError(f"non-ELF first pathname hit for {soname} at /{hit['path']}")
        actual_identity = PROBE.elf_identity(hit["elf"])
        if actual_identity != expected_identity:
            raise FirstHitGuardError(
                f"incompatible ELF identity at first pathname hit for {soname}: "
                f"consumer=ELF{expected_identity[0]}/machine={expected_identity[1]}/{expected_identity[2]} "
                f"candidate=ELF{actual_identity[0]}/machine={actual_identity[1]}/{actual_identity[2]} "
                f"path=/{hit['path']}"
            )
        return {
            **hit,
            "scope": "stage-internal" if staged is not None else "rootfs-external",
            "search_directory": "/" + directory,
            "search_source": item["source"],
            "search_position": position,
        }, search
    return None, search


def resolve_dependency_attach_preload(
    stage: Path,
    consumer_relative: str,
    soname: str,
    consumer: dict,
    preload_source_proof: dict,
) -> dict | None:
    try:
        return PRELOAD.resolve_preloaded_unixlib(
            stage,
            consumer_relative,
            soname,
            consumer,
            preload_source_proof,
            parse_elf=PROBE.parse_elf_dynamic,
            elf_identity=PROBE.elf_identity,
            resolve_rooted_path=PROBE.resolve_rooted_path,
        )
    except PRELOAD.UnixlibPreloadRuntimeError as exc:
        raise FirstHitGuardError(str(exc)) from exc


def verify(stage: Path, rootfs: Path, full_build_proof: dict, preload_source_proof: dict) -> dict:
    contract = load_contract()
    if full_build_proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise FirstHitGuardError("unexpected full build proof schema")
    if full_build_proof.get("runtime_id") != contract.get("runtime_id"):
        raise FirstHitGuardError("runtime identity drifted")
    try:
        preload_evidence = PRELOAD.validate_source_proof(preload_source_proof, contract["runtime_id"])
    except PRELOAD.UnixlibPreloadRuntimeError as exc:
        raise FirstHitGuardError(str(exc)) from exc
    gates = full_build_proof.get("gates", {})
    if gates.get("full_build_proof_passed") is not True or gates.get("staged_install_completed") is not True:
        raise FirstHitGuardError("first-hit validation requires a proven staged full build")
    forbidden = (
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "windows_payload_executed",
        "wine_executed",
    )
    if any(gates.get(key) is not False for key in forbidden):
        raise FirstHitGuardError("full build proof crossed a forbidden promotion/execution boundary")
    if not stage.is_dir() or not rootfs.is_dir():
        raise FirstHitGuardError("staged tree or locked rootfs is missing")

    stage_manifest_sha256 = PROBE.verify_stage_binding(stage, full_build_proof)
    dependencies = stage_hits = rootfs_hits = bootstrap_shortname_hits = dependency_attach_preload_hits = 0
    for path in sorted(stage.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        elf = PROBE.parse_elf_dynamic(path)
        if elf is None:
            continue
        relative = PROBE.safe_relative(stage, path)
        for soname in elf["dt_needed"]:
            dependencies += 1
            try:
                bootstrap = PROBE.resolve_bootstrap_shortname(stage, soname, elf, contract)
            except PROBE.RuntimeDependencyError as exc:
                raise FirstHitGuardError(str(exc)) from exc
            if bootstrap is not None:
                stage_hits += 1
                bootstrap_shortname_hits += 1
                continue
            preload = resolve_dependency_attach_preload(stage, relative, soname, elf, preload_source_proof)
            if preload is not None:
                stage_hits += 1
                dependency_attach_preload_hits += 1
                continue
            hit, search = resolve_first_pathname_hit(stage, rootfs, soname, elf, relative)
            if hit is None:
                raise FirstHitGuardError(
                    f"no pathname hit for {soname} required by {relative}; search={search}"
                )
            if hit["scope"] == "stage-internal":
                stage_hits += 1
            else:
                rootfs_hits += 1
    if dependencies == 0:
        raise FirstHitGuardError("staged Wine tree produced no direct ELF dependencies")

    core = {
        "runtime_id": full_build_proof["runtime_id"],
        "staging_manifest_sha256": stage_manifest_sha256,
        "unixlib_preload_source_evidence_sha256": preload_evidence,
        "counts": {
            "dependencies_checked": dependencies,
            "stage_hits": stage_hits,
            "rootfs_hits": rootfs_hits,
            "bootstrap_shortname_hits": bootstrap_shortname_hits,
            "dependency_attach_preload_hits": dependency_attach_preload_hits,
        },
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "first-pathname-and-source-proven-preloads-verified-not-runtime-promoted",
        **core,
        "validation_sha256": PROBE.canonical_sha256(core),
        "gates": {
            "full_build_proof_verified": True,
            "staging_manifest_verified": True,
            "source_derived_unixlib_preload_runtime_verified": True,
            "first_pathname_hit_verified": True,
            "runtime_dependency_inventory_complete": False,
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
        raise FirstHitGuardError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise FirstHitGuardError(f"{label} must be an object")
    return value


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "verify"])
    parser.add_argument("--stage-dir", type=Path)
    parser.add_argument("--rootfs", type=Path)
    parser.add_argument("--full-build-proof", type=Path)
    parser.add_argument("--unixlib-preload-source-proof", type=Path)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    load_contract()
    if args.command == "check":
        print("windows compatibility runtime dependency first-hit guard: PASS")
        return 0
    if not all((args.stage_dir, args.rootfs, args.full_build_proof, args.unixlib_preload_source_proof, args.out)):
        raise FirstHitGuardError(
            "verify requires --stage-dir, --rootfs, --full-build-proof, --unixlib-preload-source-proof and --out"
        )
    result = verify(
        args.stage_dir.resolve(),
        args.rootfs.resolve(),
        load_json(args.full_build_proof, "full build proof"),
        load_json(args.unixlib_preload_source_proof, "unixlib preload source proof"),
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print("windows compatibility runtime dependency first-hit validation: PASS")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (FirstHitGuardError, PROBE.RuntimeDependencyError, PRELOAD.UnixlibPreloadRuntimeError) as exc:
        print(f"windows-compat-runtime-first-hit: {exc}", file=sys.stderr)
        raise SystemExit(2)
