#!/usr/bin/env python3
"""Disposable QEMU proof for an independent Buildroot OrdaX userspace.

Direct kernel boot is a narrow smoke test, NOT signed portable-v2 equivalence.
Never accepts host block devices or writes USB media.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time

from build import contracts, digest, BaseError, ROOT

# This is a proof-lab budget, not a product RAM requirement. The direct smoke
# intentionally unpacks a complete Buildroot rootfs into initramfs RAM while
# also attaching the authenticated EROFS candidate. Owner/Development carries
# firmware and developer acquisition tools, so it needs more temporary headroom
# than the minimal profile even though the official portable boot uses EROFS.
QEMU_MEMORY_MIB_BY_PROFILE = {
    "minimal": 384,
    "owner-development": 768,
}


def regular(path: Path, label: str) -> Path:
    if str(path).startswith("/dev/"):
        raise BaseError(f"{label} must be a regular file, never a block device")
    if path.is_symlink() or not path.is_file():
        raise BaseError(f"{label} must be a regular file")
    return path.resolve()


def qemu_memory_mib(profile: object) -> int:
    if not isinstance(profile, str) or profile not in QEMU_MEMORY_MIB_BY_PROFILE:
        raise BaseError("QEMU proof requires a supported Independent Base profile")
    return QEMU_MEMORY_MIB_BY_PROFILE[profile]


def parse_guest_metrics(log: str) -> dict:
    """Parse measurements emitted by the real guest probe; never infer health."""
    keys = ("MEM_TOTAL_KIB", "MEM_USED_KIB", "CPU_BUSY_PCT", "PROCESSES", "UPTIME_S")
    observed = {}
    for key in keys:
        values = re.findall(
            rf"^ORDAX_INDEPENDENT_METRIC_{key}=([0-9]+(?:\.[0-9]+)?)\r?$",
            log, flags=re.MULTILINE,
        )
        if len(values) != 1:
            raise BaseError(f"missing or ambiguous guest metric: {key}")
        try:
            observed[key.lower()] = (float(values[0]) if key == "UPTIME_S"
                                   else int(values[0]))
        except ValueError as exc:
            raise BaseError(f"invalid guest metric: {key}") from exc
    total, used = observed["mem_total_kib"], observed["mem_used_kib"]
    if not (0 < total and 0 <= used <= total
            and 0 <= observed["cpu_busy_pct"] <= 100
            and observed["processes"] > 0
            and observed["uptime_s"] > 0):
        raise BaseError("guest metrics outside physically valid bounds")
    return observed


def parse_surface_ip_proof(log: str) -> dict:
    """Require one successful execution of the exact Surface loopback mutation."""
    exits = re.findall(r"^ORDAX_INDEPENDENT_SURFACE_IP_REPLACE_EXIT=([0-9]+)\r?$", log, re.MULTILINE)
    addresses = re.findall(r"^ORDAX_INDEPENDENT_SURFACE_LOOPBACK=([^\r\n]+)\r?$", log, re.MULTILINE)
    passes = re.findall(r"^ORDAX_INDEPENDENT_SURFACE_IP_REPLACE=PASS\r?$", log, re.MULTILINE)
    if exits != ["0"]:
        raise BaseError("Surface iproute2 guest execution did not exit exactly once with code 0")
    if addresses != ["127.0.0.1/8"]:
        raise BaseError("Surface loopback address proof missing or ambiguous")
    if len(passes) != 1:
        raise BaseError("Surface iproute2 guest success marker missing or ambiguous")
    return {
        "command": "/sbin/ip address replace 127.0.0.1/8 dev lo",
        "exit_code": 0,
        "loopback_address": "127.0.0.1/8",
    }


def qemu(
    kernel: Path,
    initrd: Path,
    base: Path,
    state: Path,
    label: str,
    log_dir: Path,
    memory_mib: int,
) -> dict:
    argv = [
        "qemu-system-x86_64", "-machine", "pc", "-m", f"{memory_mib}M", "-smp", "1",
        "-nographic", "-monitor", "none", "-no-reboot", "-serial", "stdio",
        "-kernel", str(kernel), "-initrd", str(initrd),
        "-append", "console=ttyS0 loglevel=4 rdinit=/sbin/ordax-independent-probe-init",
        # IDE emulation requires a writable block backend. QEMU snapshot=on
        # redirects guest writes to disposable COW while leaving base bytes intact.
        # The guest EROFS mount is independently verified read-only by PID1.
        "-drive", f"file={base},if=ide,index=0,format=raw,snapshot=on",
        "-drive", f"file={state},if=ide,index=1,format=raw",
        "-netdev", "user,id=n0", "-device", "e1000,netdev=n0",
    ]
    log_dir.mkdir(parents=True, exist_ok=True)
    serial_file = log_dir / f"{label}.serial.log"
    started = time.monotonic()
    try:
        complete = subprocess.run(argv, check=False, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, timeout=120)
    except subprocess.TimeoutExpired as exc:
        serial_file.write_bytes(exc.stdout or b"")
        raise BaseError(f"QEMU {label} boot timeout; serial log: {serial_file}") from exc
    elapsed_seconds = round(time.monotonic() - started, 3)
    log = complete.stdout.decode("utf-8", "replace")
    serial_file.write_text(log, encoding="utf-8")
    serial_hash = digest(serial_file)
    expected = (["ORDAX_INDEPENDENT_RECOVERY=erofs", "ORDAX_INDEPENDENT_PROMOTABLE=NO"]
                if label == "corrupt-base" else
                ["ORDAX_INDEPENDENT_EROFS=READ_ONLY", "ORDAX_INDEPENDENT_NETWORK=DHCP",
                 f"ORDAX_INDEPENDENT_STATE={'CREATED' if label == 'first' else 'RETAINED'}",
                 "ORDAX_INDEPENDENT_SURFACE_IP_REPLACE_EXIT=0",
                 "ORDAX_INDEPENDENT_SURFACE_LOOPBACK=127.0.0.1/8",
                 "ORDAX_INDEPENDENT_SURFACE_IP_REPLACE=PASS",
                 "ORDAX_INDEPENDENT_BOOT=PASS"])
    missing = [marker for marker in expected if marker not in log]
    if complete.returncode != 0 or missing:
        raise BaseError(f"QEMU {label} failed: code={complete.returncode}, "
                        f"missing={missing}, serial-log={serial_file}, serial-tail={log[-3500:]!r}")
    if label == "corrupt-base" and "ORDAX_INDEPENDENT_BOOT=PASS" in log:
        raise BaseError("corrupted base unexpectedly booted successfully")
    metrics = None if label == "corrupt-base" else parse_guest_metrics(log)
    surface_ip = None if label == "corrupt-base" else parse_surface_ip_proof(log)
    return {"mode": label, "exit_code": complete.returncode, "markers": expected,
            "serial_log_sha256": serial_hash, "serial_log": serial_file.name,
            "serial_tail": log[-800:], "qemu_wall_seconds": elapsed_seconds,
            "qemu_memory_mib": memory_mib,
            "guest_resource_metrics": metrics, "surface_iproute2": surface_ip}


def prove(out: Path, kernel_dir: Path, result_path: Path) -> dict:
    source, kernel_contract, _, _ = contracts()
    out = out.resolve()
    report = json.loads((out / "provenance.json").read_text())
    profile = report.get("profile")
    memory_mib = qemu_memory_mib(profile)
    if report.get("physical_artifact_authorized") is not False:
        raise BaseError("promotable candidate forbidden in QEMU proof")
    if report.get("surface_iproute2_identity_verified") is not True:
        raise BaseError("QEMU proof requires authenticated Surface iproute2 identity")
    surface_iproute2 = report.get("surface_iproute2")
    if not isinstance(surface_iproute2, dict) or not re.fullmatch(r"[a-f0-9]{64}", str(surface_iproute2.get("sha256", ""))):
        raise BaseError("QEMU proof requires valid Surface iproute2 provenance")
    for name, checksum in report["artifacts"].items():
        if not re.fullmatch(r"[a-f0-9]{64}", checksum):
            raise BaseError("invalid base artifact digest")
        if digest(regular(out / name, name)) != checksum:
            raise BaseError(f"base artifact does not match provenance: {name}")
    version = kernel_contract["version"]
    kernel = regular(kernel_dir / f"vmlinuz-{version}", "OrdaX kernel")
    provenance = json.loads(regular(kernel_dir / "kernel-provenance.json", "kernel provenance").read_text())
    if provenance.get("$schema") != "prototype-ordax.kernel-provenance/1":
        raise BaseError("kernel provenance schema mismatch")
    if provenance.get("kernel_version") != version:
        raise BaseError("kernel source version mismatch")
    if provenance.get("source_contract_sha256") != digest(ROOT / "bootstrap/kernel/source.json"):
        raise BaseError("kernel source contract does not match current SSOT")
    if provenance.get("fragment_sha256") != digest(ROOT / "bootstrap/kernel/config/ordax.fragment"):
        raise BaseError("kernel config fragment does not match current SSOT")
    if provenance.get("artifacts", {}).get(kernel.name) != digest(kernel):
        raise BaseError("kernel bytes not authenticated by kernel builder provenance")
    result_path = result_path.resolve()
    if result_path.exists() or result_path.is_symlink():
        raise BaseError("proof result output must be new")
    if ROOT == result_path or ROOT in result_path.parents:
        raise BaseError("proof output must be outside repository")
    for name in ("qemu-system-x86_64", "mkfs.ext4", "debugfs"):
        if not shutil.which(name):
            raise BaseError(f"QEMU proof prerequisite missing: {name}")
    base = regular(out / "independent-base.erofs", "EROFS root")
    initrd = regular(out / "rootfs.cpio.gz", "Buildroot rootfs initramfs")
    base_before = digest(base)
    serial_dir = result_path.parent / (result_path.stem + "-serial")
    if serial_dir.exists() or serial_dir.is_symlink():
        raise BaseError("serial log output must be new")
    with tempfile.TemporaryDirectory(prefix="ordax-independent-qemu-") as d:
        work = Path(d)
        state = work / "state.ext4"
        with state.open("wb") as f:
            f.truncate(64 * 1024 * 1024)
        mkfs = subprocess.run(["mkfs.ext4", "-F", "-q", str(state)], capture_output=True)
        if mkfs.returncode:
            raise BaseError("cannot create disposable state image")
        receipts = [
            qemu(kernel, initrd, base, state, "first", serial_dir, memory_mib),
            qemu(kernel, initrd, base, state, "second", serial_dir, memory_mib),
        ]
        debugfs = subprocess.run(["debugfs", "-R", "cat /ordax-independent-marker", str(state)],
                                 text=True, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, check=False)
        if debugfs.returncode or debugfs.stdout.strip() != "PERSISTENT":
            raise BaseError("persistent marker missing from offline ext4 inspection")
        corrupt = work / "corrupt.erofs"
        shutil.copyfile(base, corrupt)
        with corrupt.open("r+b") as f:
            f.seek(1024)
            f.write(b"\x00" * 4096)
        if digest(corrupt) == base_before:
            raise BaseError("fault injection did not modify candidate")
        receipts.append(qemu(kernel, initrd, corrupt, state, "corrupt-base", serial_dir, memory_mib))
    if digest(base) != base_before:
        raise BaseError("original EROFS changed during QEMU proof")
    receipt = {
        "$schema": "prototype-ordax.independent-base-qemu-result/1",
        "status": "pass",
        "profile": profile,
        "qemu_memory_mib": memory_mib,
        "kernel_version": version,
        "kernel_sha256": digest(kernel),
        "base_sha256": base_before,
        "surface_iproute2_identity": surface_iproute2,
        "surface_iproute2_loopback_replace_proven": True,
        "image_sizes_bytes": {
            "independent_base_erofs": base.stat().st_size,
            "buildroot_initramfs_cpio_gz": initrd.stat().st_size,
            "kernel_vmlinuz": kernel.stat().st_size,
        },
        "boots": receipts,
        "serial_log_directory": serial_dir.name,
        "offline_ext4_marker_verified": True,
        "erofs_host_image_sha256_after": digest(base),
        "state_persistent": True,
        "erofs_immutable": True,
        "invalid_base_recovery_fail_closed": True,
        "network_qemu_user_nat_dhcp": True,
        "erofs_disposable_qemu_cow": True,
        "direct_kernel_boot_only": True,
        "official_portable_v2_equivalence": False,
        "physical_boot_proven": False,
        "stable_promotion_authorized": False,
    }
    result_path.parent.mkdir(parents=True, exist_ok=True)
    result_path.write_text(json.dumps(receipt, indent=2, sort_keys=True) + "\n")
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--kernel-dir", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = prove(args.out, args.kernel_dir, args.result)
        print("ORDAX_INDEPENDENT_QEMU_PROOF=PASS")
        print(json.dumps({"status": result["status"], "boot_count": len(result["boots"])}))
        return 0
    except (BaseError, OSError, ValueError, KeyError) as exc:
        print(f"ordax-independent-qemu: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
