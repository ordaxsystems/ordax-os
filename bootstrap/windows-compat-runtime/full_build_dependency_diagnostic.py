#!/usr/bin/env python3
"""Focused root-cause diagnostic for Wine full-build generated headers.

The diagnostic reuses the exact locked APK/rootfs/container chain from the full
build proof. It never builds the full runtime and never executes Wine or a
Windows payload. It distinguishes system MinGW header integrity from Wine's own
generated-header dependency graph.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
BUILD_PATH = HERE / "container_full_build_probe.py"


class DependencyDiagnosticError(RuntimeError):
    pass


def load_module(path: Path):
    spec = importlib.util.spec_from_file_location("ordax_windows_compat_container_build", path)
    if spec is None or spec.loader is None:
        raise DependencyDiagnosticError("cannot load locked-container build proof")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


BUILD = load_module(BUILD_PATH)
FULL = BUILD.FULL
CONTAINER = BUILD.CONTAINER


def run_checked(image: str, build_dir: Path, canonical_path: str, command: str, *, capture: bool = False):
    return BUILD.container_run(image, build_dir, canonical_path, command, capture=capture)


def preprocess_header(image: str, build_dir: Path, canonical_path: str, compiler: str, header: str) -> None:
    run_checked(
        image,
        build_dir,
        canonical_path,
        "printf '#include <" + header + ">\\n' | " + FULL.shell_quote(compiler) + " -E -x c - -o /dev/null",
    )


def command_rc(
    image: str,
    build_dir: Path,
    canonical_path: str,
    command: str,
    log_name: str,
    rc_name: str,
) -> tuple[int, str]:
    run_checked(
        image,
        build_dir,
        canonical_path,
        "cd /build/wine-output && set +e; "
        + command
        + " > " + FULL.shell_quote(log_name) + " 2>&1; rc=$?; printf '%s\\n' \"$rc\" > "
        + FULL.shell_quote(rc_name)
        + "; tail -n 160 " + FULL.shell_quote(log_name) + "; exit 0",
    )
    value = run_checked(
        image,
        build_dir,
        canonical_path,
        "cat /build/wine-output/" + FULL.shell_quote(rc_name),
        capture=True,
    ).stdout.strip()
    if not value.isdigit():
        raise DependencyDiagnosticError(f"invalid diagnostic return code for {command}: {value!r}")
    log_path = build_dir / "wine-output" / log_name
    log_tail = log_path.read_text(encoding="utf-8", errors="replace")[-12000:] if log_path.is_file() else ""
    return int(value), log_tail


def exists_in_container(image: str, build_dir: Path, canonical_path: str, path: str) -> bool:
    completed = run_checked(
        image,
        build_dir,
        canonical_path,
        "test -s " + FULL.shell_quote(path) + " && printf yes || printf no",
        capture=True,
    )
    value = completed.stdout.strip()
    if value not in {"yes", "no"}:
        raise DependencyDiagnosticError(f"invalid file-presence probe result for {path}: {value!r}")
    return value == "yes"


def perform(work_dir: Path) -> dict:
    BUILD.load_substrate()
    content_lock, version_lock, _, toolchain = FULL.load_inputs()

    content_work = work_dir / "content"
    discovery = FULL.DISCOVERY.reproduce_and_discover(content_work)
    FULL.verify_discovery(discovery, content_lock)
    rootfs = content_work / "resolver-rootfs"
    if not rootfs.is_dir():
        raise DependencyDiagnosticError("verified replay rootfs missing")

    native = toolchain["native"]
    mingw = toolchain["mingw"]
    canonical_path = toolchain["canonical_path"]

    build_dir = (work_dir / "diagnostic-build").resolve()
    build_dir.mkdir(parents=True, exist_ok=True)
    source_contract = FULL.DISCOVERY.PROBE.SOURCE.validate_source(FULL.DISCOVERY.PROBE.SOURCE.load_source())
    wine_archive = FULL.DISCOVERY.PROBE.SOURCE.download_exact(source_contract, work_dir / "wine-source-cache")
    source_root = build_dir / "wine-source"
    FULL.DISCOVERY.PROBE.safe_extract_foreign_source(
        wine_archive,
        source_root,
        source_contract["upstream"]["archive_root"],
    )
    archive_root = source_contract["upstream"]["archive_root"]
    host_source = source_root / archive_root
    wine_source = "/build/wine-source/" + archive_root
    output_dir = build_dir / "wine-output"
    output_dir.mkdir(parents=True, exist_ok=True)

    source_presence = {
        "dlls/jscript/jsdisp.h": (host_source / "dlls/jscript/jsdisp.h").is_file(),
        "dlls/jscript/jsdisp.idl": (host_source / "dlls/jscript/jsdisp.idl").is_file(),
        "include/unknwn.h": (host_source / "include/unknwn.h").is_file(),
        "include/unknwn.idl": (host_source / "include/unknwn.idl").is_file(),
    }

    image_tag = "ordax-wine-dependency-diag-" + content_lock["resolved_closure"]["canonical_json_sha256"][:16]
    image_id = CONTAINER.import_locked_rootfs(rootfs, image_tag)
    try:
        header_paths = {
            "x86_64_unknwn": "/usr/x86_64-w64-mingw32/include/unknwn.h",
            "i386_unknwn": "/usr/i686-w64-mingw32/include/unknwn.h",
            "x86_64_comcat": "/usr/x86_64-w64-mingw32/include/comcat.h",
            "i386_comcat": "/usr/i686-w64-mingw32/include/comcat.h",
        }
        header_realpaths: dict[str, str] = {}
        for key, path in header_paths.items():
            completed = run_checked(
                image_tag,
                build_dir,
                canonical_path,
                "test -f " + FULL.shell_quote(path) + " && readlink -f " + FULL.shell_quote(path),
                capture=True,
            )
            resolved = completed.stdout.strip()
            if not resolved.startswith("/usr/"):
                raise DependencyDiagnosticError(f"unexpected MinGW header realpath for {key}: {resolved!r}")
            header_realpaths[key] = resolved

        for compiler in (mingw["x86_64_cc"], mingw["i686_cc"]):
            preprocess_header(image_tag, build_dir, canonical_path, compiler, "unknwn.h")
            preprocess_header(image_tag, build_dir, canonical_path, compiler, "comcat.h")

        triplet = run_checked(
            image_tag,
            build_dir,
            canonical_path,
            FULL.shell_quote(native["cc"]) + " -dumpmachine",
            capture=True,
        ).stdout.strip()
        if triplet != native["triplet"] or triplet != version_lock["configure"]["native_compiler_triplet"]:
            raise DependencyDiagnosticError(f"native compiler triplet drifted: {triplet}")

        run_checked(
            image_tag,
            build_dir,
            canonical_path,
            "cd " + FULL.shell_quote(wine_source) + " && sed -i 's|OpenCL/opencl.h|CL/opencl.h|g' configure*",
        )
        configure_args = [
            f"{wine_source}/configure",
            f"--build={triplet}",
            f"--host={triplet}",
            *version_lock["configure"]["flags"],
        ]
        configure_env = " ".join([
            f"CC={FULL.shell_quote(native['cc'])}",
            f"CXX={FULL.shell_quote(native['cxx'])}",
            f"{mingw['x86_64_configure_variable']}={FULL.shell_quote(mingw['x86_64_cc'])}",
            f"{mingw['i686_configure_variable']}={FULL.shell_quote(mingw['i686_cc'])}",
            "CFLAGS='-O2 -Wno-error=format-security'",
            "CXXFLAGS='-O2 -Wno-error=format-security'",
            "CPPFLAGS='-O2 -Wno-error=format-security'",
        ])
        configure_command = " ".join(FULL.shell_quote(item) for item in configure_args)
        run_checked(
            image_tag,
            build_dir,
            canonical_path,
            f"cd /build/wine-output && {configure_env} {configure_command} > configure.log 2>&1 || "
            "{ rc=$?; tail -n 250 configure.log >&2; exit $rc; }",
        )

        target = "dlls/mshtml/i386-windows/htmlform.o"
        dry_run = run_checked(
            image_tag,
            build_dir,
            canonical_path,
            "cd /build/wine-output && make -n " + FULL.shell_quote(target),
            capture=True,
        ).stdout
        initial_rc, initial_log = command_rc(
            image_tag,
            build_dir,
            canonical_path,
            "make -j1 " + FULL.shell_quote(target),
            "htmlform-initial.log",
            "htmlform-initial.rc",
        )

        generated_after_initial = {
            "dlls/jscript/jsdisp.h": exists_in_container(
                image_tag, build_dir, canonical_path, "/build/wine-output/dlls/jscript/jsdisp.h"
            ),
            "include/unknwn.h": exists_in_container(
                image_tag, build_dir, canonical_path, "/build/wine-output/include/unknwn.h"
            ),
        }

        generator_rc, generator_log = command_rc(
            image_tag,
            build_dir,
            canonical_path,
            "make -j1 dlls/jscript/jsdisp.h include/unknwn.h",
            "generated-headers.log",
            "generated-headers.rc",
        )
        generated_after_explicit = {
            "dlls/jscript/jsdisp.h": exists_in_container(
                image_tag, build_dir, canonical_path, "/build/wine-output/dlls/jscript/jsdisp.h"
            ),
            "include/unknwn.h": exists_in_container(
                image_tag, build_dir, canonical_path, "/build/wine-output/include/unknwn.h"
            ),
        }

        retry_rc, retry_log = command_rc(
            image_tag,
            build_dir,
            canonical_path,
            "make -j1 " + FULL.shell_quote(target),
            "htmlform-after-headers.log",
            "htmlform-after-headers.rc",
        )

        if initial_rc == 0:
            classification = "single-target-build-generates-required-headers"
        elif generator_rc != 0:
            classification = "generated-header-target-failure"
        elif retry_rc == 0:
            classification = "consumer-target-missing-generated-header-prerequisite"
        else:
            classification = "consumer-compile-failure-persists-after-generated-headers"

        return {
            "$schema": "prototype-ordax.windows-compat-full-build-dependency-diagnostic/2",
            "status": "root-cause-diagnostic-complete-no-runtime-built",
            "runtime_id": content_lock["runtime_id"],
            "source_archive_sha256": source_contract["upstream"]["archive_sha256"],
            "resolved_closure_sha256": content_lock["resolved_closure"]["canonical_json_sha256"],
            "ephemeral_image_id": image_id,
            "source_presence": source_presence,
            "mingw_header_realpaths": header_realpaths,
            "mingw_unknwn_preprocess_passed": True,
            "mingw_comcat_preprocess_passed": True,
            "dry_run_mentions_jsdisp": "dlls/jscript/jsdisp.h" in dry_run,
            "dry_run_mentions_unknwn": "include/unknwn.h" in dry_run,
            "initial_htmlform_rc": initial_rc,
            "initial_htmlform_log_tail": initial_log[-4000:],
            "generated_after_initial": generated_after_initial,
            "explicit_generator_rc": generator_rc,
            "explicit_generator_log_tail": generator_log[-4000:],
            "generated_after_explicit": generated_after_explicit,
            "retry_htmlform_rc": retry_rc,
            "retry_htmlform_log_tail": retry_log[-4000:],
            "classification": classification,
            "diagnostic_complete": True,
            "full_build_performed": False,
            "wine_executed": False,
            "windows_payload_executed": False,
            "activation_authorized": False,
            "execution_authorized": False,
        }
    finally:
        CONTAINER.remove_image(image_tag)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    proof = perform(args.work_dir.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(proof, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        DependencyDiagnosticError,
        BUILD.ContainerFullBuildError,
        CONTAINER.LockedRootfsContainerError,
        FULL.FullBuildProofError,
        FULL.CONTENT_VALIDATOR.ApkContentLockError,
        FULL.DISCOVERY.ContentDiscoveryError,
        FULL.DISCOVERY.VALIDATOR.BuildVersionLockError,
        FULL.DISCOVERY.PROBE.ConfigureProofError,
    ) as exc:
        print(f"windows-compat-full-build-dependency-diagnostic: {exc}", file=sys.stderr)
        raise SystemExit(2)
