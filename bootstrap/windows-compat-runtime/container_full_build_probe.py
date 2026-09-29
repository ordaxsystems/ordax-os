#!/usr/bin/env python3
"""Full Wine build proof in a container imported from the exact locked rootfs.

PRoot remains useful for deterministic APK resolution/replay but is not used to
execute make after its child-exec behavior was proven unsuitable. This proof
imports the already reconstructed locked rootfs into an ephemeral Docker image,
disables network, makes the image rootfs read-only, drops all capabilities and
binds only a caller-owned /build tree plus tmpfs /tmp.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
LEGACY_PROOF_PATH = HERE / "full_build_probe.py"
CONTAINER_PATH = HERE / "locked_rootfs_container.py"
HEADER_BARRIER_PATH = HERE / "generated_idl_header_barrier.py"
SUBSTRATE_PATH = HERE / "full-build-execution-substrate.json"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class ContainerFullBuildError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ContainerFullBuildError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FULL = load_module("ordax_windows_compat_full_build_contract", LEGACY_PROOF_PATH)
CONTAINER = load_module("ordax_windows_compat_locked_container", CONTAINER_PATH)
HEADER_BARRIER = load_module("ordax_windows_compat_generated_idl_header_barrier", HEADER_BARRIER_PATH)


def load_substrate() -> dict:
    try:
        value = json.loads(SUBSTRATE_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ContainerFullBuildError(f"cannot load execution substrate contract: {exc}") from exc
    expected_rejected = {
        "direct_x86_64_cross_compile": True,
        "direct_i386_cross_compile": True,
        "generated_x86_64_pe_machine": "0x8664",
        "generated_i386_pe_machine": "0x014c",
        "make_j1_x86_64_cross_compile": False,
        "make_j1_i386_cross_compile": False,
        "make_j2_x86_64_cross_compile": False,
        "failure_class": "child-exec-enoent-under-make",
    }
    if value.get("$schema") != "prototype-ordax.windows-compat-full-build-execution-substrate/1":
        raise ContainerFullBuildError("unexpected execution substrate schema")
    if value.get("status") != "container-from-locked-replay-rootfs-not-product-runtime":
        raise ContainerFullBuildError("execution substrate status drifted")
    rejected = value.get("rejected_substrate", {})
    if rejected.get("engine") != "proot" or rejected.get("diagnostic_workflow_run_id") != 36518314519:
        raise ContainerFullBuildError("PRoot rejection provenance drifted")
    if rejected.get("diagnostic_job_id") != 109245467237 or rejected.get("evidence") != expected_rejected:
        raise ContainerFullBuildError("PRoot diagnostic evidence drifted")
    if rejected.get("decision") != "not-acceptable-for-full-build-proof":
        raise ContainerFullBuildError("rejected substrate decision drifted")
    selected = value.get("selected_substrate")
    expected_selected = {
        "engine": "docker",
        "image_source": "imported-from-reconstructed-locked-rootfs",
        "external_base_image": False,
        "network": "none",
        "rootfs_read_only": True,
        "capabilities": "drop-all",
        "no_new_privileges": True,
        "writable_mounts": ["/build", "/tmp"],
        "build_user": "host-numeric-uid-gid",
        "image_is_product_artifact": False,
        "image_identity_is_runtime_identity": False,
    }
    if selected != expected_selected:
        raise ContainerFullBuildError("selected execution substrate drifted")
    expected_gates = {
        "locked_rootfs_reconstruction_required": True,
        "offline_apk_replay_required": True,
        "compiler_execution_reproven_inside_container": True,
        "network_access_during_build_forbidden": True,
        "wine_execution_forbidden": True,
        "windows_payload_execution_forbidden": True,
        "activation_authorized": False,
        "execution_authorized": False,
    }
    if value.get("gates") != expected_gates:
        raise ContainerFullBuildError("execution substrate gates drifted")
    return value


def container_run(image: str, build_dir: Path, canonical_path: str, command: str, *, capture: bool = False):
    controlled = f"PATH={FULL.shell_quote(canonical_path)} {command}"
    return CONTAINER.run_locked(image, build_dir, controlled, capture=capture)


def prove_compiler(image: str, build_dir: Path, canonical_path: str, path: str) -> str:
    completed = container_run(
        image,
        build_dir,
        canonical_path,
        f"{FULL.shell_quote(path)} --version | head -n 1",
        capture=True,
    )
    value = completed.stdout.strip()
    if not value:
        raise ContainerFullBuildError(f"compiler did not execute in locked container: {path}")
    return value


def perform_build(work_dir: Path, jobs: int) -> dict:
    substrate = load_substrate()
    content_lock, version_lock, _, toolchain = FULL.load_inputs()
    if substrate.get("runtime_id") != content_lock.get("runtime_id"):
        raise ContainerFullBuildError("execution substrate runtime identity drifted")
    if jobs < 1 or jobs > 8:
        raise ContainerFullBuildError("build jobs must be between 1 and 8")

    content_work = work_dir / "content"
    discovery = FULL.DISCOVERY.reproduce_and_discover(content_work)
    FULL.verify_discovery(discovery, content_lock)
    rootfs = content_work / "resolver-rootfs"
    if not rootfs.is_dir():
        raise ContainerFullBuildError("verified replay rootfs missing")

    installed = FULL.DISCOVERY.PROBE.installed_package_versions(rootfs)
    native = toolchain["native"]
    mingw = toolchain["mingw"]
    canonical_path = toolchain["canonical_path"]
    expected_versions = {
        "gcc": native["gcc_package_version"],
        "g++": native["gxx_package_version"],
        "mingw-w64-gcc": mingw["x86_64_package_version"],
        "i686-mingw-w64-gcc": mingw["i686_package_version"],
    }
    for package, version in expected_versions.items():
        if installed.get(package) != version:
            raise ContainerFullBuildError(f"installed compiler package drifted: {package}")

    build_dir = (work_dir / "container-build").resolve()
    build_dir.mkdir(parents=True, exist_ok=True)
    source_contract = FULL.DISCOVERY.PROBE.SOURCE.validate_source(FULL.DISCOVERY.PROBE.SOURCE.load_source())
    wine_archive = FULL.DISCOVERY.PROBE.SOURCE.download_exact(source_contract, work_dir / "wine-source-cache")
    source_root = build_dir / "wine-source"
    FULL.DISCOVERY.PROBE.safe_extract_foreign_source(
        wine_archive,
        source_root,
        source_contract["upstream"]["archive_root"],
    )
    wine_source = "/build/wine-source/" + source_contract["upstream"]["archive_root"]
    output_dir = build_dir / "wine-output"
    stage_dir = build_dir / "stage"
    output_dir.mkdir(parents=True, exist_ok=True)
    stage_dir.mkdir(parents=True, exist_ok=True)

    docker_version = CONTAINER.require_docker()
    image_tag = "ordax-wine-build-proof-" + content_lock["resolved_closure"]["canonical_json_sha256"][:16]
    image_id = CONTAINER.import_locked_rootfs(rootfs, image_tag)
    header_barrier = None
    try:
        compiler_versions = {
            "cc": prove_compiler(image_tag, build_dir, canonical_path, native["cc"]),
            "cxx": prove_compiler(image_tag, build_dir, canonical_path, native["cxx"]),
            "x86_64_pe": prove_compiler(image_tag, build_dir, canonical_path, mingw["x86_64_cc"]),
            "i386_pe": prove_compiler(image_tag, build_dir, canonical_path, mingw["i686_cc"]),
        }
        triplet = container_run(
            image_tag,
            build_dir,
            canonical_path,
            f"{FULL.shell_quote(native['cc'])} -dumpmachine",
            capture=True,
        ).stdout.strip()
        if triplet != native["triplet"] or triplet != version_lock["configure"]["native_compiler_triplet"]:
            raise ContainerFullBuildError(f"native compiler triplet drifted in container: {triplet}")

        container_run(
            image_tag,
            build_dir,
            canonical_path,
            f"cd {FULL.shell_quote(wine_source)} && sed -i 's|OpenCL/opencl.h|CL/opencl.h|g' configure*",
        )
        configure_args = [
            f"{wine_source}/configure",
            f"--build={triplet}",
            f"--host={triplet}",
            *version_lock["configure"]["flags"],
        ]
        configure_command = " ".join(FULL.shell_quote(item) for item in configure_args)
        configure_env = " ".join([
            f"CC={FULL.shell_quote(native['cc'])}",
            f"CXX={FULL.shell_quote(native['cxx'])}",
            f"{mingw['x86_64_configure_variable']}={FULL.shell_quote(mingw['x86_64_cc'])}",
            f"{mingw['i686_configure_variable']}={FULL.shell_quote(mingw['i686_cc'])}",
            "CFLAGS='-O2 -Wno-error=format-security'",
            "CXXFLAGS='-O2 -Wno-error=format-security'",
            "CPPFLAGS='-O2 -Wno-error=format-security'",
        ])
        container_run(
            image_tag,
            build_dir,
            canonical_path,
            f"cd /build/wine-output && {configure_env} {configure_command} > configure.log 2>&1 || "
            "{ rc=$?; tail -n 250 configure.log >&2; exit $rc; }",
        )

        # Wine's generated Makefile is the authority for this barrier. The plan
        # contains every safe relative .h target whose prerequisites include
        # .idl source, so no module/header workaround is hard-coded here.
        header_barrier = HEADER_BARRIER.plan(output_dir / "Makefile")
        HEADER_BARRIER.write_target_file(
            header_barrier,
            output_dir / "generated-idl-headers.targets",
        )
        container_run(
            image_tag,
            build_dir,
            canonical_path,
            f"cd /build/wine-output && "
            f"test \"$(wc -l < generated-idl-headers.targets)\" -eq {header_barrier['target_count']} && "
            f"make -j{jobs} $(cat generated-idl-headers.targets) > generated-idl-headers.log 2>&1 || "
            "{ rc=$?; if test -f generated-idl-headers.log; then tail -n 300 generated-idl-headers.log >&2; fi; exit $rc; }",
        )
        HEADER_BARRIER.verify_materialized(output_dir, header_barrier)

        container_run(
            image_tag,
            build_dir,
            canonical_path,
            "cd /build/wine-output && make tools/winedump/winedump > winedump-build.log 2>&1 || "
            "{ rc=$?; tail -n 250 winedump-build.log >&2; exit $rc; }",
        )
        container_run(
            image_tag,
            build_dir,
            canonical_path,
            f"cd /build/wine-output && make -j{jobs} > full-build.log 2>&1 || "
            "{ rc=$?; tail -n 300 full-build.log >&2; exit $rc; }",
        )
        container_run(
            image_tag,
            build_dir,
            canonical_path,
            "cd /build/wine-output && make DESTDIR=/build/stage install > staged-install.log 2>&1 || "
            "{ rc=$?; tail -n 250 staged-install.log >&2; exit $rc; }",
        )
    finally:
        CONTAINER.remove_image(image_tag)

    if header_barrier is None:
        raise ContainerFullBuildError("generated IDL header barrier was not planned")

    wine_entry = stage_dir / "usr/bin/wine"
    wine_lib = stage_dir / "usr/lib/wine"
    if not (wine_entry.exists() or wine_entry.is_symlink()):
        raise ContainerFullBuildError("staged Wine entrypoint missing")
    if not wine_lib.is_dir():
        raise ContainerFullBuildError("staged Wine library tree missing")

    manifest, total_regular_bytes = FULL.staging_manifest(stage_dir)
    stage_digest = FULL.canonical_manifest_sha256(manifest)
    if not SHA256_RE.fullmatch(stage_digest):
        raise ContainerFullBuildError("invalid staged manifest digest")
    regular_files = sum(1 for item in manifest.values() if item.get("type") == "file")
    symlinks = sum(1 for item in manifest.values() if item.get("type") == "symlink")

    return {
        "$schema": "prototype-ordax.windows-compat-full-build-proof/2",
        "status": "full-build-proven-in-locked-container-staged-not-runtime-pinned-not-executable",
        "runtime_id": content_lock["runtime_id"],
        "wine_version": content_lock["wine_version"],
        "source_archive_sha256": source_contract["upstream"]["archive_sha256"],
        "host_rootfs_sha256": content_lock["host_rootfs_sha256"],
        "apk_content_manifest_sha256": content_lock["external_apk_set"]["canonical_manifest_sha256"],
        "resolved_closure_sha256": content_lock["resolved_closure"]["canonical_json_sha256"],
        "build_jobs": jobs,
        "generated_idl_header_barrier": {
            "authority": header_barrier["authority"],
            "selection": header_barrier["selection"],
            "target_count": header_barrier["target_count"],
            "targets_sha256": header_barrier["targets_sha256"],
        },
        "execution_substrate": {
            "engine": "docker",
            "docker_server_version": docker_version,
            "image_source": "imported-from-reconstructed-locked-rootfs",
            "ephemeral_image_id": image_id,
            "network": "none",
            "rootfs_read_only": True,
            "capabilities": "drop-all",
            "no_new_privileges": True,
            "image_is_product_artifact": False,
        },
        "compiler": {
            "triplet": triplet,
            "cc_path": native["cc"],
            "cxx_path": native["cxx"],
            "x86_64_pe_path": mingw["x86_64_cc"],
            "i386_pe_path": mingw["i686_cc"],
            "versions": compiler_versions,
        },
        "staging": {
            "entry_count": len(manifest),
            "regular_file_count": regular_files,
            "symlink_count": symlinks,
            "total_regular_bytes": total_regular_bytes,
            "canonical_manifest_sha256": stage_digest,
        },
        "gates": {
            "source_lock_verified": True,
            "version_lock_verified": True,
            "apk_content_lock_verified": True,
            "offline_content_replay_passed": True,
            "proot_full_build_rejected_by_diagnostic": True,
            "locked_rootfs_container_imported": True,
            "container_network_disabled": True,
            "container_rootfs_read_only": True,
            "container_capabilities_dropped": True,
            "compiler_execution_reproven_inside_container": True,
            "configure_completed": True,
            "generated_idl_header_barrier_completed": True,
            "full_build_proof_passed": True,
            "staged_install_completed": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "windows_payload_executed": False,
            "wine_executed": False
        }
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "build"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()
    load_substrate()
    FULL.load_inputs()
    if args.command == "check":
        CONTAINER.require_docker()
        print("windows compatibility locked-container full build contract: PASS")
        return 0
    if args.work_dir is None or args.out is None:
        raise ContainerFullBuildError("--work-dir and --out are required for build")
    proof = perform_build(args.work_dir.resolve(), args.jobs)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(proof, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        ContainerFullBuildError,
        CONTAINER.LockedRootfsContainerError,
        HEADER_BARRIER.GeneratedIdlHeaderBarrierError,
        FULL.FullBuildProofError,
        FULL.CONTENT_VALIDATOR.ApkContentLockError,
        FULL.DISCOVERY.ContentDiscoveryError,
        FULL.DISCOVERY.VALIDATOR.BuildVersionLockError,
        FULL.DISCOVERY.PROBE.ConfigureProofError,
    ) as exc:
        print(f"windows-compat-container-full-build: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
