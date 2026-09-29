#!/usr/bin/env python3
"""Build Wine 11.0 against fully locked OrdaX compatibility inputs.

This proof reconstructs the exact locked build environment and stages a Wine
build without executing Wine, a Windows payload, or mutating an OrdaX runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
DISCOVERY_PATH = HERE / "discover_apk_content.py"
CONTENT_VALIDATOR_PATH = HERE / "validate_apk_content_lock.py"
CONTENT_LOCK_PATH = HERE / "apk-content-lock.json"
VERSION_LOCK_PATH = HERE / "build-version-lock.json"
SOURCE_PATH = HERE / "source.json"
TOOLCHAIN_PATH = HERE / "full-build-toolchain.json"
ABSOLUTE_TOOL_RE = re.compile(r"^/usr/bin/[A-Za-z0-9+._-]+$")
SAFE_ENV_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")


class FullBuildProofError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise FullBuildProofError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


DISCOVERY = load_module("ordax_windows_compat_content_discovery_for_build", DISCOVERY_PATH)
CONTENT_VALIDATOR = load_module("ordax_windows_compat_content_lock_for_build", CONTENT_VALIDATOR_PATH)


def load_json(path: Path, label: str) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise FullBuildProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise FullBuildProofError(f"{label} must be an object")
    return value


def validate_toolchain(toolchain: dict, version_lock: dict, source: dict) -> dict:
    if toolchain.get("$schema") != "prototype-ordax.windows-compat-full-build-toolchain/1":
        raise FullBuildProofError("unexpected full build toolchain schema")
    if toolchain.get("status") != "explicit-native-and-pe-compiler-paths-from-full-build-root-causes":
        raise FullBuildProofError("full build toolchain status drifted")
    if toolchain.get("runtime_id") != version_lock.get("runtime_id") or toolchain.get("runtime_id") != source.get("runtime_id"):
        raise FullBuildProofError("full build toolchain runtime identity drifted")

    canonical_path = toolchain.get("canonical_path")
    if canonical_path != "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin":
        raise FullBuildProofError("canonical build PATH drifted")

    native = toolchain.get("native")
    expected_native = {
        "triplet": "x86_64-alpine-linux-musl",
        "cc": "/usr/bin/gcc",
        "cxx": "/usr/bin/g++",
        "gcc_package_version": "14.2.0-r6",
        "gxx_package_version": "14.2.0-r6",
    }
    if native != expected_native:
        raise FullBuildProofError("native compiler path identity drifted")
    if native["triplet"] != version_lock.get("configure", {}).get("native_compiler_triplet"):
        raise FullBuildProofError("native compiler triplet diverged from version lock")

    requested = version_lock.get("requested_build_packages")
    if not isinstance(requested, dict):
        raise FullBuildProofError("requested build package lock missing")
    if requested.get("gcc") not in (None, native["gcc_package_version"]):
        raise FullBuildProofError("gcc package version conflicts with version lock")
    closure = version_lock.get("resolved_closure")
    if not isinstance(closure, dict) or closure.get("package_count") != 342:
        raise FullBuildProofError("version lock closure identity missing")

    mingw = toolchain.get("mingw")
    expected_mingw = {
        "x86_64_configure_variable": "x86_64_CC",
        "x86_64_cc": "/usr/bin/x86_64-w64-mingw32-gcc",
        "i686_configure_variable": "i386_CC",
        "i686_cc": "/usr/bin/i686-w64-mingw32-gcc",
        "x86_64_package_version": "14.2.0-r1",
        "i686_package_version": "14.2.0-r1",
    }
    if mingw != expected_mingw:
        raise FullBuildProofError("MinGW compiler path identity drifted")
    for key in ("x86_64_configure_variable", "i686_configure_variable"):
        if not SAFE_ENV_NAME_RE.fullmatch(mingw[key]):
            raise FullBuildProofError("unsafe PE compiler configure variable")
    for key in ("x86_64_cc", "i686_cc"):
        if not ABSOLUTE_TOOL_RE.fullmatch(mingw[key]):
            raise FullBuildProofError("unsafe PE compiler path")
    if requested.get("mingw-w64-gcc") != mingw["x86_64_package_version"]:
        raise FullBuildProofError("x86_64 MinGW package version drifted")
    if requested.get("i686-mingw-w64-gcc") != mingw["i686_package_version"]:
        raise FullBuildProofError("i686 MinGW package version drifted")

    provenance = toolchain.get("root_cause_provenance")
    if not isinstance(provenance, list) or len(provenance) != 2:
        raise FullBuildProofError("full build root-cause provenance drifted")
    first, second = provenance
    if first.get("failed_workflow_run_id") != 36516480648 or first.get("failed_job_id") != 109239789349:
        raise FullBuildProofError("first full build root-cause provenance drifted")
    if first.get("forbidden_fix") != "do-not-create-a-fake-triplet-compiler-symlink":
        raise FullBuildProofError("first full build forbidden workaround policy drifted")
    if second.get("failed_workflow_run_id") != 36517018593 or second.get("failed_job_id") != 109241478785:
        raise FullBuildProofError("second full build root-cause provenance drifted")
    if second.get("forbidden_fix") != "do-not-add-compiler-symlinks-or-host-path-fallbacks":
        raise FullBuildProofError("second full build forbidden workaround policy drifted")
    if second.get("required_fix") != "bind-x86_64_CC-and-i386_CC-to-verified-absolute-rootfs-paths":
        raise FullBuildProofError("PE compiler root-cause fix drifted")

    expected_gates = {
        "compiler_paths_explicit": True,
        "pe_compiler_variables_explicit": True,
        "compiler_executability_must_be_proven": True,
        "compiler_packages_version_bound": True,
        "full_build_proof_passed": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }
    if toolchain.get("gates") != expected_gates:
        raise FullBuildProofError("full build toolchain overclaims readiness")
    return toolchain


def load_inputs() -> tuple[dict, dict, dict, dict]:
    content_lock = CONTENT_VALIDATOR.load_json(CONTENT_LOCK_PATH)
    version_lock = CONTENT_VALIDATOR.load_json(VERSION_LOCK_PATH)
    source = CONTENT_VALIDATOR.load_json(SOURCE_PATH)
    CONTENT_VALIDATOR.validate_lock(content_lock, version_lock, source)
    toolchain = validate_toolchain(load_json(TOOLCHAIN_PATH, "full build toolchain"), version_lock, source)
    gates = content_lock["gates"]
    if gates["apk_content_hashes_pinned"] is not True:
        raise FullBuildProofError("full build requires pinned APK content")
    if gates["full_build_proof_passed"] is not False:
        raise FullBuildProofError("full build source gate must start unproven")
    if gates["activation_authorized"] is not False or gates["execution_authorized"] is not False:
        raise FullBuildProofError("full build may not inherit activation or execution authority")
    return content_lock, version_lock, source, toolchain


def canonical_manifest_sha256(manifest: dict) -> str:
    encoded = json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def verify_discovery(proof: dict, content_lock: dict) -> None:
    if proof.get("status") != "content-discovered-offline-replayed-not-pinned-not-build-proven":
        raise FullBuildProofError("unexpected content discovery proof status")
    gates = proof.get("gates")
    if not isinstance(gates, dict):
        raise FullBuildProofError("content discovery gates missing")
    for required in ("version_lock_verified", "closure_reproduced", "apk_content_discovered", "offline_content_replay_passed"):
        if gates.get(required) is not True:
            raise FullBuildProofError(f"content discovery prerequisite failed: {required}")
    if gates.get("apk_content_hashes_pinned") is not False or gates.get("full_build_proof_passed") is not False:
        raise FullBuildProofError("discovery proof overclaimed promotion")

    closure = content_lock["resolved_closure"]
    if proof.get("resolved_package_count") != closure["package_count"]:
        raise FullBuildProofError("discovery closure count drifted")
    if proof.get("resolved_closure_sha256") != closure["canonical_json_sha256"]:
        raise FullBuildProofError("discovery closure digest drifted")
    if proof.get("offline_replay_closure_sha256") != closure["canonical_json_sha256"]:
        raise FullBuildProofError("offline replay closure digest drifted")

    apk_set = content_lock["external_apk_set"]
    manifest = proof.get("external_apk_manifest")
    if not isinstance(manifest, dict):
        raise FullBuildProofError("external APK manifest missing")
    if proof.get("external_apk_package_count") != apk_set["package_count"] or len(manifest) != apk_set["package_count"]:
        raise FullBuildProofError("external APK package count drifted")
    total_size = sum(item.get("size_bytes", 0) for item in manifest.values() if isinstance(item, dict))
    if total_size != apk_set["total_size_bytes"]:
        raise FullBuildProofError("external APK byte size drifted")
    if canonical_manifest_sha256(manifest) != apk_set["canonical_manifest_sha256"]:
        raise FullBuildProofError("external APK content manifest drifted")


def shell_quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"


def controlled(command: str, canonical_path: str) -> str:
    return f"PATH={shell_quote(canonical_path)} {command}"


def staging_manifest(root: Path) -> tuple[dict[str, dict[str, object]], int]:
    if not root.is_dir():
        raise FullBuildProofError("Wine staged install tree is missing")
    manifest: dict[str, dict[str, object]] = {}
    total_regular_bytes = 0
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root).as_posix()
        if path.is_symlink():
            manifest[relative] = {"type": "symlink", "target": os.readlink(path)}
        elif path.is_dir():
            manifest[relative] = {"type": "directory"}
        elif path.is_file():
            size = path.stat().st_size
            total_regular_bytes += size
            manifest[relative] = {"type": "file", "size_bytes": size, "sha256": DISCOVERY.sha256_file(path)}
        else:
            raise FullBuildProofError(f"unsupported staged install object: {relative}")
    if not manifest:
        raise FullBuildProofError("Wine staged install tree is empty")
    return manifest, total_regular_bytes


def require_executable(rootfs: Path, absolute_path: str, canonical_path: str) -> str:
    if not ABSOLUTE_TOOL_RE.fullmatch(absolute_path):
        raise FullBuildProofError(f"unsafe compiler path: {absolute_path!r}")
    host_view = rootfs / absolute_path.lstrip("/")
    if not (host_view.exists() or host_view.is_symlink()):
        raise FullBuildProofError(f"compiler path is missing from locked rootfs: {absolute_path}")
    completed = DISCOVERY.PROBE.proot(
        rootfs,
        controlled(f"{shell_quote(absolute_path)} --version | head -n 1", canonical_path),
        capture=True,
    )
    version = completed.stdout.strip()
    if not version:
        raise FullBuildProofError(f"compiler failed executability proof: {absolute_path}")
    return version


def perform_full_build(work_dir: Path, jobs: int) -> dict:
    content_lock, version_lock, _, toolchain = load_inputs()
    if jobs < 1 or jobs > 8:
        raise FullBuildProofError("build jobs must be between 1 and 8")

    content_work = work_dir / "content"
    discovery_proof = DISCOVERY.reproduce_and_discover(content_work)
    verify_discovery(discovery_proof, content_lock)
    rootfs = content_work / "resolver-rootfs"
    if not rootfs.is_dir():
        raise FullBuildProofError("verified build rootfs is missing")

    installed = DISCOVERY.PROBE.installed_package_versions(rootfs)
    native = toolchain["native"]
    mingw = toolchain["mingw"]
    canonical_path = toolchain["canonical_path"]
    if installed.get("gcc") != native["gcc_package_version"]:
        raise FullBuildProofError("installed gcc package version drifted")
    if installed.get("g++") != native["gxx_package_version"]:
        raise FullBuildProofError("installed g++ package version drifted")
    if installed.get("mingw-w64-gcc") != mingw["x86_64_package_version"]:
        raise FullBuildProofError("installed x86_64 MinGW package version drifted")
    if installed.get("i686-mingw-w64-gcc") != mingw["i686_package_version"]:
        raise FullBuildProofError("installed i686 MinGW package version drifted")

    compiler_versions = {
        "cc": require_executable(rootfs, native["cc"], canonical_path),
        "cxx": require_executable(rootfs, native["cxx"], canonical_path),
        "x86_64_pe": require_executable(rootfs, mingw["x86_64_cc"], canonical_path),
        "i386_pe": require_executable(rootfs, mingw["i686_cc"], canonical_path),
    }

    source_contract = DISCOVERY.PROBE.SOURCE.validate_source(DISCOVERY.PROBE.SOURCE.load_source())
    wine_archive = DISCOVERY.PROBE.SOURCE.download_exact(source_contract, work_dir / "wine-source-cache")
    source_root = rootfs / "build/wine-source"
    DISCOVERY.PROBE.safe_extract_foreign_source(wine_archive, source_root, source_contract["upstream"]["archive_root"])
    wine_source = "/build/wine-source/" + source_contract["upstream"]["archive_root"]
    (rootfs / "build/wine-output").mkdir(parents=True, exist_ok=True)

    triplet = DISCOVERY.PROBE.proot(
        rootfs,
        controlled(f"{shell_quote(native['cc'])} -dumpmachine", canonical_path),
        capture=True,
    ).stdout.strip()
    if triplet != native["triplet"] or triplet != version_lock["configure"]["native_compiler_triplet"]:
        raise FullBuildProofError(f"native compiler triplet drifted: {triplet}")

    DISCOVERY.PROBE.proot(
        rootfs,
        controlled(f"cd {shell_quote(wine_source)} && sed -i 's|OpenCL/opencl.h|CL/opencl.h|g' configure*", canonical_path),
    )
    configure_args = [
        f"{wine_source}/configure",
        f"--build={triplet}",
        f"--host={triplet}",
        *version_lock["configure"]["flags"],
    ]
    configure_command = " ".join(shell_quote(item) for item in configure_args)
    configure_env = " ".join([
        f"PATH={shell_quote(canonical_path)}",
        f"CC={shell_quote(native['cc'])}",
        f"CXX={shell_quote(native['cxx'])}",
        f"{mingw['x86_64_configure_variable']}={shell_quote(mingw['x86_64_cc'])}",
        f"{mingw['i686_configure_variable']}={shell_quote(mingw['i686_cc'])}",
        "CFLAGS='-O2 -Wno-error=format-security'",
        "CXXFLAGS='-O2 -Wno-error=format-security'",
        "CPPFLAGS='-O2 -Wno-error=format-security'",
    ])
    DISCOVERY.PROBE.proot(
        rootfs,
        f"cd /build/wine-output && {configure_env} {configure_command} > configure.log 2>&1 || "
        "{ rc=$?; tail -n 250 configure.log >&2; exit $rc; }",
    )

    make_prefix = f"PATH={shell_quote(canonical_path)}"
    DISCOVERY.PROBE.proot(
        rootfs,
        f"cd /build/wine-output && {make_prefix} make tools/winedump/winedump > winedump-build.log 2>&1 || "
        "{ rc=$?; tail -n 250 winedump-build.log >&2; exit $rc; }",
    )
    DISCOVERY.PROBE.proot(
        rootfs,
        f"cd /build/wine-output && {make_prefix} make -j{jobs} > full-build.log 2>&1 || "
        "{ rc=$?; tail -n 300 full-build.log >&2; exit $rc; }",
    )

    stage = rootfs / "build/stage"
    stage.mkdir(parents=True, exist_ok=True)
    DISCOVERY.PROBE.proot(
        rootfs,
        f"cd /build/wine-output && {make_prefix} make DESTDIR=/build/stage install > staged-install.log 2>&1 || "
        "{ rc=$?; tail -n 250 staged-install.log >&2; exit $rc; }",
    )

    wine_entry = stage / "usr/bin/wine"
    wine_lib = stage / "usr/lib/wine"
    if not (wine_entry.exists() or wine_entry.is_symlink()):
        raise FullBuildProofError("staged Wine entrypoint is missing")
    if not wine_lib.is_dir():
        raise FullBuildProofError("staged Wine library tree is missing")

    stage_manifest, total_regular_bytes = staging_manifest(stage)
    stage_digest = canonical_manifest_sha256(stage_manifest)
    regular_files = sum(1 for item in stage_manifest.values() if item.get("type") == "file")
    symlinks = sum(1 for item in stage_manifest.values() if item.get("type") == "symlink")

    return {
        "$schema": "prototype-ordax.windows-compat-full-build-proof/1",
        "status": "full-build-proven-staged-not-runtime-pinned-not-executable",
        "runtime_id": content_lock["runtime_id"],
        "wine_version": content_lock["wine_version"],
        "source_archive_sha256": source_contract["upstream"]["archive_sha256"],
        "host_rootfs_sha256": content_lock["host_rootfs_sha256"],
        "apk_content_manifest_sha256": content_lock["external_apk_set"]["canonical_manifest_sha256"],
        "resolved_closure_sha256": content_lock["resolved_closure"]["canonical_json_sha256"],
        "build_jobs": jobs,
        "compiler": {
            "triplet": triplet,
            "canonical_path": canonical_path,
            "cc_path": native["cc"],
            "cxx_path": native["cxx"],
            "x86_64_pe_path": mingw["x86_64_cc"],
            "i386_pe_path": mingw["i686_cc"],
            "versions": compiler_versions,
        },
        "staging": {
            "entry_count": len(stage_manifest),
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
            "compiler_paths_explicit": True,
            "compiler_executability_proven": True,
            "pe_compiler_variables_explicit": True,
            "configure_completed": True,
            "full_build_proof_passed": True,
            "staged_install_completed": True,
            "runtime_dependency_inventory_complete": False,
            "binary_artifact_pinned": False,
            "activation_authorized": False,
            "execution_authorized": False,
            "windows_payload_executed": False,
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["check", "build"])
    parser.add_argument("--work-dir", type=Path)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--jobs", type=int, default=2)
    args = parser.parse_args()

    load_inputs()
    if args.command == "check":
        print("windows compatibility full build proof contract: PASS")
        return 0
    if args.work_dir is None or args.out is None:
        raise FullBuildProofError("--work-dir and --out are required for build")

    proof = perform_full_build(args.work_dir.resolve(), args.jobs)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(proof, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        FullBuildProofError,
        CONTENT_VALIDATOR.ApkContentLockError,
        DISCOVERY.ContentDiscoveryError,
        DISCOVERY.VALIDATOR.BuildVersionLockError,
        DISCOVERY.PROBE.ConfigureProofError,
    ) as exc:
        print(f"windows-compat-full-build-proof: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
