#!/usr/bin/env python3
"""Diagnose PE compiler process behavior in the exact locked Wine build rootfs.

This proof never runs Wine or generated PE files. It reconstructs the exact
locked Alpine/APK environment, verifies compiler identity, compiles trivial PE
objects directly and through make at serial/parallel fan-out, and records every
result before the workflow gates on the diagnosis.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
from pathlib import Path
import stat

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
FULL_BUILD_PATH = HERE / "full_build_probe.py"


class DiagnosticError(RuntimeError):
    pass


def load_module(name: str, path: Path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise DiagnosticError(f"cannot load module: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FULL = load_module("ordax_windows_compat_full_build_for_diagnostic", FULL_BUILD_PATH)


def pe_identity(path: Path) -> dict:
    data = path.read_bytes()
    if len(data) < 0x40 or data[:2] != b"MZ":
        raise DiagnosticError(f"generated output is not DOS/PE shaped: {path}")
    pe_offset = int.from_bytes(data[0x3C:0x40], "little")
    if pe_offset < 0x40 or pe_offset + 6 > len(data) or data[pe_offset:pe_offset + 4] != b"PE\0\0":
        raise DiagnosticError(f"generated output lacks bounded PE signature: {path}")
    machine = int.from_bytes(data[pe_offset + 4:pe_offset + 6], "little")
    return {
        "size_bytes": len(data),
        "sha256": FULL.DISCOVERY.sha256_file(path),
        "pe_offset": pe_offset,
        "machine": f"0x{machine:04x}",
    }


def compiler_file_identity(rootfs: Path, absolute_path: str) -> dict:
    path = rootfs / absolute_path.lstrip("/")
    if not (path.exists() or path.is_symlink()):
        raise DiagnosticError(f"compiler path missing: {absolute_path}")
    lst = path.lstat()
    result = {
        "path": absolute_path,
        "mode": oct(stat.S_IMODE(lst.st_mode)),
        "is_symlink": path.is_symlink(),
    }
    resolved = path.resolve(strict=True)
    try:
        relative = resolved.relative_to(rootfs)
    except ValueError as exc:
        raise DiagnosticError(f"compiler resolves outside locked rootfs: {absolute_path}") from exc
    result["resolved_path"] = "/" + relative.as_posix()
    result["resolved_size_bytes"] = resolved.stat().st_size
    result["resolved_sha256"] = FULL.DISCOVERY.sha256_file(resolved)
    if path.is_symlink():
        result["symlink_target"] = os.readlink(path)
    return result


def attempt(rootfs: Path, command: str) -> dict:
    try:
        completed = FULL.DISCOVERY.PROBE.proot(rootfs, command, capture=True)
        return {
            "passed": True,
            "stdout_tail": completed.stdout[-2000:],
            "stderr_tail": completed.stderr[-2000:],
        }
    except FULL.DISCOVERY.PROBE.ConfigureProofError as exc:
        return {"passed": False, "error": str(exc)[-5000:]}


def run_diagnostic(work_dir: Path) -> dict:
    content_lock, _, _, toolchain = FULL.load_inputs()
    content_work = work_dir / "content"
    discovery = FULL.DISCOVERY.reproduce_and_discover(content_work)
    FULL.verify_discovery(discovery, content_lock)
    rootfs = content_work / "resolver-rootfs"
    if not rootfs.is_dir():
        raise DiagnosticError("locked replay rootfs missing")

    canonical_path = toolchain["canonical_path"]
    mingw = toolchain["mingw"]
    x64 = mingw["x86_64_cc"]
    x86 = mingw["i686_cc"]
    compiler_identity = {
        "x86_64": compiler_file_identity(rootfs, x64),
        "i386": compiler_file_identity(rootfs, x86),
    }

    preflight = rootfs / "build/compiler-process-diagnostic"
    preflight.mkdir(parents=True, exist_ok=True)
    (preflight / "probe.c").write_text("int main(void) { return 0; }\n", encoding="ascii")
    makefile = (
        "X64=/usr/bin/x86_64-w64-mingw32-gcc\n"
        "X86=/usr/bin/i686-w64-mingw32-gcc\n"
        "serial-x64.exe: probe.c\n\t$(X64) probe.c -o $@\n"
        "serial-x86.exe: probe.c\n\t$(X86) probe.c -o $@\n"
        "parallel-a.exe: probe.c\n\t$(X64) probe.c -o $@\n"
        "parallel-b.exe: probe.c\n\t$(X64) probe.c -o $@\n"
    )
    (preflight / "Makefile").write_text(makefile, encoding="ascii")

    base = f"PATH={FULL.shell_quote(canonical_path)} cd /build/compiler-process-diagnostic && "
    direct_x64 = attempt(rootfs, f"PATH={FULL.shell_quote(canonical_path)} {FULL.shell_quote(x64)} /build/compiler-process-diagnostic/probe.c -o /build/compiler-process-diagnostic/direct-x64.exe")
    direct_x86 = attempt(rootfs, f"PATH={FULL.shell_quote(canonical_path)} {FULL.shell_quote(x86)} /build/compiler-process-diagnostic/probe.c -o /build/compiler-process-diagnostic/direct-x86.exe")
    make_serial_x64 = attempt(rootfs, base + "PATH=" + FULL.shell_quote(canonical_path) + " make -j1 serial-x64.exe")
    make_serial_x86 = attempt(rootfs, base + "PATH=" + FULL.shell_quote(canonical_path) + " make -j1 serial-x86.exe")
    make_parallel_x64 = attempt(rootfs, base + "PATH=" + FULL.shell_quote(canonical_path) + " make -j2 parallel-a.exe parallel-b.exe")

    cases = {
        "direct_x86_64": direct_x64,
        "direct_i386": direct_x86,
        "make_serial_x86_64": make_serial_x64,
        "make_serial_i386": make_serial_x86,
        "make_parallel_x86_64": make_parallel_x64,
    }
    outputs = {}
    expected = {
        "direct-x64.exe": "0x8664",
        "direct-x86.exe": "0x014c",
        "serial-x64.exe": "0x8664",
        "serial-x86.exe": "0x014c",
        "parallel-a.exe": "0x8664",
        "parallel-b.exe": "0x8664",
    }
    for name, machine in expected.items():
        path = preflight / name
        if path.is_file():
            identity = pe_identity(path)
            identity["expected_machine"] = machine
            identity["machine_matches"] = identity["machine"] == machine
            outputs[name] = identity

    all_cases_passed = all(case["passed"] for case in cases.values())
    all_outputs_valid = len(outputs) == len(expected) and all(item["machine_matches"] for item in outputs.values())
    return {
        "$schema": "prototype-ordax.windows-compat-proot-compiler-diagnostic/1",
        "runtime_id": content_lock["runtime_id"],
        "purpose": "distinguish-wine-build-failure-from-proot-process-execution-semantics",
        "compiler_identity": compiler_identity,
        "cases": cases,
        "generated_pe_outputs": outputs,
        "all_cases_passed": all_cases_passed,
        "all_outputs_valid": all_outputs_valid,
        "windows_payload_executed": False,
        "wine_executed": False,
        "activation_authorized": False,
        "execution_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    proof = run_diagnostic(args.work_dir.resolve())
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(proof, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(proof, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (
        DiagnosticError,
        FULL.FullBuildProofError,
        FULL.CONTENT_VALIDATOR.ApkContentLockError,
        FULL.DISCOVERY.ContentDiscoveryError,
        FULL.DISCOVERY.VALIDATOR.BuildVersionLockError,
        FULL.DISCOVERY.PROBE.ConfigureProofError,
    ) as exc:
        print(f"windows-compat-proot-compiler-diagnostic: {exc}", file=__import__("sys").stderr)
        raise SystemExit(2)
