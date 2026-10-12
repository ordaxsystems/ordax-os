#!/usr/bin/env python3
"""Disposable QEMU proof for an independent Buildroot OrdaX userspace.

Direct kernel boot is a narrow smoke test, NOT signed portable-v2 equivalence.
Never accepts host block devices or writes USB media.
"""
from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tarfile
import tempfile
import threading

from build import contracts, digest, BaseError, ROOT


def regular(path: Path, label: str) -> Path:
    if str(path).startswith("/dev/"):
        raise BaseError(f"{label} must be a regular file, never a block device")
    if path.is_symlink() or not path.is_file():
        raise BaseError(f"{label} must be a regular file")
    return path.resolve()


def qemu(kernel: Path, initrd: Path, base: Path, state: Path, label: str, log_dir: Path, http_port: int) -> dict:
    argv = [
        "qemu-system-x86_64", "-machine", "pc", "-m", "384M", "-smp", "1",
        "-nographic", "-monitor", "none", "-no-reboot", "-serial", "stdio",
        "-kernel", str(kernel), "-initrd", str(initrd),
        "-append", f"console=ttyS0 loglevel=4 rdinit=/sbin/ordax-independent-probe-init ordax.proof_http_port={http_port}",
        # IDE emulation requires a writable block backend. QEMU snapshot=on
        # redirects guest writes to disposable COW while leaving base bytes intact.
        # The guest EROFS mount is independently verified read-only by PID1.
        "-drive", f"file={base},if=ide,format=raw,snapshot=on",
        "-drive", f"file={state},if=ide,format=raw",
        "-netdev", "user,id=n0", "-device", "e1000,netdev=n0",
    ]
    log_dir.mkdir(parents=True, exist_ok=True)
    serial_file = log_dir / f"{label}.serial.log"
    try:
        complete = subprocess.run(argv, check=False, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, timeout=120)
    except subprocess.TimeoutExpired as exc:
        serial_file.write_bytes(exc.stdout or b"")
        raise BaseError(f"QEMU {label} boot timeout; serial log: {serial_file}") from exc
    log = complete.stdout.decode("utf-8", "replace")
    serial_file.write_text(log, encoding="utf-8")
    serial_hash = digest(serial_file)
    expected = (["ORDAX_INDEPENDENT_RECOVERY=erofs", "ORDAX_INDEPENDENT_PROMOTABLE=NO"]
                if label == "corrupt-base" else
                ["ORDAX_INDEPENDENT_EROFS=READ_ONLY", "ORDAX_INDEPENDENT_NETWORK=DHCP",
                 "ORDAX_INDEPENDENT_SERVICE_PRIMITIVES=PASS", "ORDAX_INDEPENDENT_IPROUTE2=PASS",
                 "ORDAX_INDEPENDENT_STATE_SECURITY=PASS",
                 "ORDAX_INDEPENDENT_OVERLAY=PASS",
                 f"ORDAX_INDEPENDENT_OVERLAY_STATE={'CREATED' if label == 'first' else 'RETAINED'}",
                 "ORDAX_INDEPENDENT_NETWORK_ROUTE_DNS_CONFIG=PASS",
                 "ORDAX_INDEPENDENT_NETWORK_DNS_RESOLUTION=PASS",
                 "ORDAX_INDEPENDENT_NETWORK_HTTP=PASS",
                 "ORDAX_INDEPENDENT_GUARDIAN_RESTART_FAIL_CLOSED=PASS",
                 "ORDAX_INDEPENDENT_GUARDIAN_TERMINATION=PASS",
                 f"ORDAX_INDEPENDENT_STATE={'CREATED' if label == 'first' else 'RETAINED'}",
                 "ORDAX_INDEPENDENT_BOOT=PASS"])
    missing = [marker for marker in expected if marker not in log]
    if complete.returncode != 0 or missing:
        raise BaseError(f"QEMU {label} failed: code={complete.returncode}, "
                        f"missing={missing}, serial-log={serial_file}, serial-tail={log[-3500:]!r}")
    if label == "corrupt-base" and "ORDAX_INDEPENDENT_BOOT=PASS" in log:
        raise BaseError("corrupted base unexpectedly booted successfully")
    return {"mode": label, "exit_code": complete.returncode, "markers": expected,
            "serial_log_sha256": serial_hash, "serial_log": serial_file.name,
            "serial_tail": log[-800:]}


def prove(out: Path, kernel_dir: Path, result_path: Path) -> dict:
    source, kernel_contract, _, _ = contracts()
    out = out.resolve()
    report = json.loads((out / "provenance.json").read_text())
    if report.get("physical_artifact_authorized") is not False:
        raise BaseError("promotable candidate forbidden in QEMU proof")
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
    # The canonical kernel owner already builds and attests the *same* module
    # package. Validate its ABI and archive integrity here without redefining
    # the device/firmware selection policy or claiming physical Wi-Fi.
    modules = regular(kernel_dir / f"kernel-modules-{version}.tar", "OrdaX kernel modules")
    if provenance.get("artifacts", {}).get(modules.name) != digest(modules):
        raise BaseError("canonical kernel module archive digest mismatch")
    with tarfile.open(modules, "r:") as handle:
        entries = handle.getmembers()
        root = f"lib/modules/{version}/"
        paths = [entry.name.removeprefix("./") for entry in entries]
        if not entries or any(
            name.startswith("/") or ".." in Path(name).parts or
            (name not in ("lib", "lib/modules", f"lib/modules/{version}") and not name.startswith(root))
            for name in paths
        ):
            raise BaseError("canonical kernel module archive escapes pinned release ABI")
        module_names = {Path(name).name for name, entry in zip(paths, entries)
                        if entry.isfile() and name.endswith(".ko")}
        if not module_names or module_names != set(provenance.get("observed_module_basenames", [])):
            raise BaseError("module archive does not match canonical kernel module inventory")
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
        # Real guest-to-host TCP flow through QEMU user NAT. The HTTP
        # responder is loopback-only on this disposable CI machine and
        # exists solely for the proof, not as a product network service.
        requests = []

        class ProofHttpHandler(BaseHTTPRequestHandler):
            def do_GET(self):
                if self.path != "/ordax-network-proof":
                    self.send_error(404)
                    return
                requests.append(self.path)
                payload = b"ORDAX_NETWORK_HTTP=PASS\n"
                self.send_response(200)
                self.send_header("Content-Type", "text/plain")
                self.send_header("Content-Length", str(len(payload)))
                self.end_headers()
                self.wfile.write(payload)

            def log_message(self, format, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), ProofHttpHandler) as server:
            server.timeout = 1
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                port = server.server_port
                receipts = [
                    qemu(kernel, initrd, base, state, "first", serial_dir, port),
                    qemu(kernel, initrd, base, state, "second", serial_dir, port),
                ]
                if len(requests) != 2:
                    raise BaseError("guest did not perform exactly one outbound HTTP request per healthy boot")
            finally:
                server.shutdown()
                thread.join()
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
        receipts.append(qemu(kernel, initrd, corrupt, state, "corrupt-base", serial_dir, port))
    if digest(base) != base_before:
        raise BaseError("original EROFS changed during QEMU proof")
    receipt = {
        "$schema": "prototype-ordax.independent-base-qemu-result/1",
        "status": "pass",
        "kernel_version": version,
        "kernel_sha256": digest(kernel),
        "kernel_modules_sha256": digest(modules),
        "phase3_kernel_module_abi_archive_authenticated": True,
        "base_sha256": base_before,
        "boots": receipts,
        "serial_log_directory": serial_dir.name,
        "offline_ext4_marker_verified": True,
        "erofs_host_image_sha256_after": digest(base),
        "state_persistent": True,
        "erofs_immutable": True,
        "invalid_base_recovery_fail_closed": True,
        "network_qemu_user_nat_dhcp": True,
        "phase3_guardian_supervisor_failure_qemu_verified": True,
        "phase3_guardian_termination_qemu_verified": True,
        "phase3_state_permissions_qemu_verified": True,
        "phase3_overlayfs_persistence_qemu_verified": True,
        "phase3_dhcp_ipv4_gateway_dns_qemu_verified": True,
        "phase3_guest_to_host_http_qemu_verified": True,
        "phase3_product_surface_health_qemu_verified": False,
        "phase3_service_primitives_qemu_verified": True,
        "phase3_native_iproute2_qemu_verified": True,
        "phase3_wifi_hardware_proven": False,
        "phase3_graphics_proven": False,
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
