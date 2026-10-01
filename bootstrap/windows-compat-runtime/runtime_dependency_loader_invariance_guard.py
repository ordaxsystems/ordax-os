#!/usr/bin/env python3
"""Prove staged direct dependency targets are invariant to loader state.

The proof models the locked Wine bootstrap shortname state, source-derived
builtin unixlib dependency-attach preloads, musl needed_by RPATH/RUNPATH search,
the locked musl system path and shortname reuse. Every required SONAME + ELF
identity must converge to one logical target, and every consumer must have an
authoritative resolution independent of unrelated prior module load order.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
PROBE_PATH = HERE / "runtime_dependency_probe.py"
FIRST_HIT_PATH = HERE / "runtime_dependency_first_hit_guard.py"
PRELOAD_PATH = HERE / "runtime_unixlib_preload_runtime_guard.py"
PROOF_SCHEMA = "prototype-ordax.windows-compat-runtime-loader-invariance-proof/1"


class LoaderInvarianceError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise LoaderInvarianceError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


PROBE = load_module("ordax_windows_compat_runtime_dependency_probe_for_invariance", PROBE_PATH)
FIRST = load_module("ordax_windows_compat_runtime_first_hit_for_invariance", FIRST_HIT_PATH)
PRELOAD = load_module("ordax_windows_compat_unixlib_preload_for_invariance", PRELOAD_PATH)


def load_contract() -> dict:
    contract = PROBE.load_contract()
    inspection = contract.get("inspection", {})
    for key in (
        "wine_bootstrap_shortname_reuse_required",
        "musl_needed_by_chain_invariance_required",
        "musl_shortname_reuse_invariance_required",
        "loader_invariance_proof_required",
    ):
        if inspection.get(key) is not True:
            raise LoaderInvarianceError(f"runtime dependency contract does not require {key}")
    if inspection.get("ambient_ld_library_path_allowed") is not False:
        raise LoaderInvarianceError("loader invariance requires ambient LD_LIBRARY_PATH to remain forbidden")
    return contract


def dynamic_search_directories(consumer_relative: str, elf: dict) -> list[dict]:
    value = elf.get("runpath") if elf.get("runpath") is not None else elf.get("rpath")
    if value is None:
        return []
    label = "DT_RUNPATH" if elf.get("runpath") is not None else "DT_RPATH"
    result = []
    seen: set[str] = set()
    for item in PROBE.split_path_list(value, label):
        directory = PROBE.expand_loader_directory(item, consumer_relative, label)
        if directory in seen:
            continue
        seen.add(directory)
        result.append({"directory": directory, "source": label, "consumer": consumer_relative})
    return result


def collect_staged_elfs(stage: Path) -> list[dict]:
    values = []
    for path in sorted(stage.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        elf = PROBE.parse_elf_dynamic(path)
        if elf is None:
            continue
        values.append({"path": PROBE.safe_relative(stage, path), "elf": elf})
    if not values:
        raise LoaderInvarianceError("staged Wine tree contained no ELF files")
    return values


def identity_key(elf: dict) -> str:
    return f"ELF{elf['class']}:machine={elf['machine']}:{elf['endianness']}"


def pair_key(elf: dict, soname: str) -> str:
    return identity_key(elf) + ":" + soname


def _add_target(targets: dict, hit: dict) -> None:
    key = (hit["scope"], hit["canonical_path"])
    record = targets.setdefault(key, {
        "scope": hit["scope"],
        "canonical_path": hit["canonical_path"],
        "candidate_paths": set(),
    })
    record["candidate_paths"].add(hit["path"])


def _preload_hit(stage: Path, consumer_path: str, soname: str, elf: dict, proof: dict) -> dict | None:
    try:
        return PRELOAD.resolve_preloaded_unixlib(
            stage,
            consumer_path,
            soname,
            elf,
            proof,
            parse_elf=PROBE.parse_elf_dynamic,
            elf_identity=PROBE.elf_identity,
            resolve_rooted_path=PROBE.resolve_rooted_path,
        )
    except PRELOAD.UnixlibPreloadRuntimeError as exc:
        raise LoaderInvarianceError(str(exc)) from exc


def verify(stage: Path, rootfs: Path, full_build_proof: dict, preload_source_proof: dict) -> dict:
    contract = load_contract()
    if full_build_proof.get("$schema") != contract["input"]["full_build_proof_schema"]:
        raise LoaderInvarianceError("unexpected full build proof schema")
    if full_build_proof.get("runtime_id") != contract.get("runtime_id"):
        raise LoaderInvarianceError("runtime identity drifted")
    try:
        preload_evidence = PRELOAD.validate_source_proof(preload_source_proof, contract["runtime_id"])
    except PRELOAD.UnixlibPreloadRuntimeError as exc:
        raise LoaderInvarianceError(str(exc)) from exc
    gates = full_build_proof.get("gates", {})
    if gates.get("full_build_proof_passed") is not True or gates.get("staged_install_completed") is not True:
        raise LoaderInvarianceError("loader invariance requires a proven staged full build")
    forbidden = (
        "runtime_dependency_inventory_complete",
        "binary_artifact_pinned",
        "activation_authorized",
        "execution_authorized",
        "windows_payload_executed",
        "wine_executed",
    )
    if any(gates.get(key) is not False for key in forbidden):
        raise LoaderInvarianceError("full build proof crossed a forbidden promotion/execution boundary")
    if not stage.is_dir() or not rootfs.is_dir():
        raise LoaderInvarianceError("staged tree or locked rootfs is missing")

    stage_manifest_sha256 = PROBE.verify_stage_binding(stage, full_build_proof)
    staged_elfs = collect_staged_elfs(stage)
    staged_by_path = {item["path"]: item["elf"] for item in staged_elfs}
    directories: dict[tuple[int, int, str], dict[str, set[str]]] = {}
    samples: dict[tuple[int, int, str], dict] = {}
    needed: dict[tuple[int, int, str, str], set[str]] = {}

    for item in staged_elfs:
        elf = item["elf"]
        identity = PROBE.elf_identity(elf)
        samples.setdefault(identity, elf)
        by_dir = directories.setdefault(identity, {})
        for entry in dynamic_search_directories(item["path"], elf):
            by_dir.setdefault(entry["directory"], set()).add(
                f"{entry['source']}:{entry['consumer']}"
            )
        for soname in elf["dt_needed"]:
            needed.setdefault((*identity, soname), set()).add(item["path"])

    for identity, elf in samples.items():
        by_dir = directories.setdefault(identity, {})
        for entry in PROBE.musl_system_search_directories(rootfs, elf):
            by_dir.setdefault(entry["directory"], set()).add(entry["source"])

    resolved: dict[str, dict] = {}
    total_pathnames = 0
    bootstrap_pairs = 0
    dependency_attach_preload_pairs = 0
    dependency_attach_preload_consumers = 0
    for (*identity_parts, soname), consumers in sorted(needed.items(), key=lambda item: item[0]):
        identity = tuple(identity_parts)
        expected = identity
        by_dir = directories.get(identity, {})
        targets: dict[tuple[str, str], dict] = {}
        checked_dirs = []
        try:
            bootstrap = PROBE.resolve_bootstrap_shortname(stage, soname, samples[identity], contract)
        except PROBE.RuntimeDependencyError as exc:
            raise LoaderInvarianceError(str(exc)) from exc
        if bootstrap is not None:
            bootstrap_pairs += 1
            _add_target(targets, bootstrap)

        pair_has_preload = False
        consumer_resolution_kinds: dict[str, str] = {}
        for consumer_path in sorted(consumers):
            consumer_elf = staged_by_path.get(consumer_path)
            if consumer_elf is None or PROBE.elf_identity(consumer_elf) != identity:
                raise LoaderInvarianceError(f"consumer ELF disappeared or changed identity: {consumer_path}")
            if bootstrap is not None:
                consumer_resolution_kinds[consumer_path] = "bootstrap-shortname-reuse"
                continue
            preload = _preload_hit(stage, consumer_path, soname, consumer_elf, preload_source_proof)
            if preload is not None:
                _add_target(targets, preload)
                pair_has_preload = True
                dependency_attach_preload_consumers += 1
                consumer_resolution_kinds[consumer_path] = preload["resolution_kind"]
                continue
            try:
                first_hit, _ = FIRST.resolve_first_pathname_hit(stage, rootfs, soname, consumer_elf, consumer_path)
            except FIRST.FirstHitGuardError as exc:
                raise LoaderInvarianceError(str(exc)) from exc
            if first_hit is None:
                raise LoaderInvarianceError(
                    f"consumer has no order-independent loader resolution for {soname}: {consumer_path}"
                )
            _add_target(targets, first_hit)
            consumer_resolution_kinds[consumer_path] = "loader-pathname"
        if pair_has_preload:
            dependency_attach_preload_pairs += 1

        for directory in sorted(by_dir):
            checked_dirs.append({
                "directory": "/" + directory,
                "sources": sorted(by_dir[directory]),
            })
            try:
                staged = FIRST.direct_loader_hit(stage, directory, soname)
                external = FIRST.direct_loader_hit(rootfs, directory, soname)
            except (FIRST.FirstHitGuardError, PROBE.RuntimeDependencyError, OSError) as exc:
                raise LoaderInvarianceError(
                    f"invalid pathname while proving loader invariance for {soname} in /{directory}: {exc}"
                ) from exc
            if staged is not None and external is not None:
                raise LoaderInvarianceError(
                    f"cross-scope pathname collision while proving loader invariance for {soname} in /{directory}"
                )
            hit = staged if staged is not None else external
            if hit is None:
                continue
            total_pathnames += 1
            if hit["elf"] is None:
                raise LoaderInvarianceError(
                    f"non-ELF pathname can be reached through staged needed_by search for {soname}: /{hit['path']}"
                )
            actual = PROBE.elf_identity(hit["elf"])
            if actual != expected:
                raise LoaderInvarianceError(
                    f"incompatible pathname can be reached through staged needed_by search for {soname}: "
                    f"expected={expected} actual={actual} path=/{hit['path']}"
                )
            scope = "stage-internal" if staged is not None else "rootfs-external"
            _add_target(targets, {**hit, "scope": scope})

        if not targets:
            raise LoaderInvarianceError(
                f"no reachable target while proving loader invariance for {soname} {identity}"
            )
        if len(targets) != 1:
            details = sorted(f"{scope}:/{path}" for scope, path in targets)
            raise LoaderInvarianceError(
                f"loader target depends on needed_by/shortname state for {soname} {identity}: {details}"
            )
        target = next(iter(targets.values()))
        target["candidate_paths"] = sorted(target["candidate_paths"])
        key = f"ELF{identity[0]}:machine={identity[1]}:{identity[2]}:{soname}"
        resolved[key] = {
            "soname": soname,
            "elf": {"class": identity[0], "machine": identity[1], "endianness": identity[2]},
            "consumers": sorted(consumers),
            "consumer_resolution_kinds": dict(sorted(consumer_resolution_kinds.items())),
            "directories_considered": checked_dirs,
            "bootstrap_preloaded": bootstrap is not None,
            "dependency_attach_preload_observed": pair_has_preload,
            "target": target,
        }

    if not resolved:
        raise LoaderInvarianceError("staged Wine tree produced no direct ELF dependencies")

    core = {
        "runtime_id": full_build_proof["runtime_id"],
        "staging_manifest_sha256": stage_manifest_sha256,
        "unixlib_preload_source_evidence_sha256": preload_evidence,
        "needed_targets": resolved,
    }
    return {
        "$schema": PROOF_SCHEMA,
        "status": "staged-loader-state-invariant-with-source-proven-preloads-not-runtime-promoted",
        **core,
        "validation_sha256": PROBE.canonical_sha256(core),
        "counts": {
            "staged_elf_files": len(staged_elfs),
            "needed_identity_soname_pairs": len(resolved),
            "reachable_candidate_pathnames": total_pathnames,
            "bootstrap_shortname_pairs": bootstrap_pairs,
            "dependency_attach_preload_pairs": dependency_attach_preload_pairs,
            "dependency_attach_preload_consumers": dependency_attach_preload_consumers,
        },
        "gates": {
            "full_build_proof_verified": True,
            "staging_manifest_verified": True,
            "source_derived_unixlib_preload_runtime_verified": True,
            "staged_needed_by_chain_invariance_verified": True,
            "staged_shortname_reuse_invariance_verified": True,
            "external_transitive_closure_verified": False,
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
        raise LoaderInvarianceError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise LoaderInvarianceError(f"{label} must be an object")
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
        print("windows compatibility runtime loader invariance guard: PASS")
        return 0
    if not all((args.stage_dir, args.rootfs, args.full_build_proof, args.unixlib_preload_source_proof, args.out)):
        raise LoaderInvarianceError(
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
    print("windows compatibility staged loader invariance: PASS")
    print(json.dumps(result["counts"], sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        LoaderInvarianceError,
        FIRST.FirstHitGuardError,
        PROBE.RuntimeDependencyError,
        PRELOAD.UnixlibPreloadRuntimeError,
    ) as exc:
        print(f"windows-compat-runtime-loader-invariance: {exc}", file=sys.stderr)
        raise SystemExit(2)
