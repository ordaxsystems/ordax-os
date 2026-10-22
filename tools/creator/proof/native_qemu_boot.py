#!/usr/bin/env python3
"""UEFI/QEMU proof for the OrdaX Native boot boundary.

The proof creates a new sparse regular-file disk, attaches it only through a
host loop device for formatting, and boots that same file under OVMF/QEMU TCG.
The LUKS passphrase is generated at runtime, its temporary file is destroyed
before VM launch, and the secret reaches the guest only as virtual PS/2
keystrokes. No production initramfs backdoor or key-file boot path is added.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import stat
import subprocess
import sys
import tempfile
import time
from typing import Any

SCHEMA = "prototype-ordax.native-qemu-boot-proof-result/1"
ESP_PROOF_SCHEMA = "prototype-ordax.native-esp-proof-result/1"
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")
COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
UUID_RE = re.compile(r"^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$")
POOL_TYPE_GUID = "ca7d7ccb-63ed-4c53-861c-1742536059cc"
ESP_BYTES = 1024 * 1024 * 1024
DISK_BYTES = 2304 * 1024 * 1024
SUBVOLUMES = (
    "ordax-state",
    "ordax-home",
    "ordax-apps",
    "ordax-containers",
    "ordax-snapshots",
)
SUCCESS_MARKER = "ORDAX_NATIVE_QEMU_HANDOFF=PASS"
PERSISTENCE_MARKER = "ORDAX_NATIVE_QEMU_PERSISTENCE=PASS"
NATIVE_READY_MARKER = "ORDAX_NATIVE_BOOT_STAGE=unlock-ready"
NATIVE_RESCUE_MARKER = "ORDAX_NATIVE_BOOT_STAGE=rescue"
NATIVE_START_MARKER = "ORDAX_NATIVE_BOOT_STAGE=init-ready"
NATIVE_UNLOCKED_MARKER = "ORDAX_NATIVE_BOOT_STAGE=pool-unlocked"
UNLOCK_READY_GRACE_SECONDS = 5.0
UNLOCK_RETRY_INTERVAL_SECONDS = 15.0
MAX_UNLOCK_INJECTIONS = 3  # Match cryptsetup --tries 3; never spam firmware/console.
ALPHABET = "abcdefghijkmnopqrstuvwxyz"


class ProofError(RuntimeError):
    pass


def run(argv: list[str], *, check: bool = True) -> subprocess.CompletedProcess[bytes]:
    try:
        result = subprocess.run(
            argv,
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        raise ProofError(f"cannot execute {' '.join(argv)}: {exc}") from exc
    if check and result.returncode != 0:
        raise ProofError(
            f"command failed ({result.returncode}): {' '.join(argv)}: "
            f"stdout={result.stdout.decode('utf-8', 'replace')!r} "
            f"stderr={result.stderr.decode('utf-8', 'replace')!r}"
        )
    return result


def capture(argv: list[str]) -> str:
    return run(argv).stdout.decode("utf-8", "replace").strip()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def regular(path: Path, label: str) -> None:
    try:
        info = path.lstat()
    except OSError as exc:
        raise ProofError(f"cannot stat {label}: {exc}") from exc
    if stat.S_ISLNK(info.st_mode) or not stat.S_ISREG(info.st_mode):
        raise ProofError(f"{label} must be a regular non-symlink file")
    if str(path).startswith("/dev/"):
        raise ProofError(f"{label} must never be a physical device path")


def load_json(path: Path, label: str) -> dict[str, Any]:
    regular(path, label)
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise ProofError(f"cannot load {label}: {exc}") from exc
    if not isinstance(value, dict):
        raise ProofError(f"{label} must be a JSON object")
    return value


def require_programs() -> None:
    names = (
        "sgdisk",
        "losetup",
        "mkfs.vfat",
        "cryptsetup",
        "mkfs.btrfs",
        "btrfs",
        "mount",
        "umount",
        "qemu-system-x86_64",
    )
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        raise ProofError("missing QEMU proof programs: " + ", ".join(missing))


def verify_inputs(args: argparse.Namespace) -> dict[str, Any]:
    if COMMIT_RE.fullmatch(args.source_commit) is None:
        raise ProofError("source commit must be exact 40-hex")
    if UUID_RE.fullmatch(args.pool_uuid) is None:
        raise ProofError("pool UUID is not canonical")

    for path, label in (
        (args.bootloader, "systemd-boot candidate"),
        (args.kernel, "kernel candidate"),
        (args.initramfs, "Native initramfs candidate"),
        (args.loader_conf, "Native loader.conf"),
    ):
        regular(path, label)

    esp = load_json(args.esp_proof, "Native ESP proof")
    if esp.get("$schema") != ESP_PROOF_SCHEMA or esp.get("status") != "pass":
        raise ProofError("Native ESP proof is not a passing proof")
    if esp.get("source_commit") != args.source_commit:
        raise ProofError("Native ESP proof source commit differs from QEMU source")
    if esp.get("pool_uuid") != args.pool_uuid:
        raise ProofError("Native ESP proof UUID differs from QEMU pool UUID")
    if (
        esp.get("physical_device_touched") is not False
        or esp.get("physical_write_authorized") is not False
        or esp.get("qemu_uefi_boot_proven") is not False
    ):
        raise ProofError("Native ESP proof crossed its evidence boundary")

    expected = esp.get("artifacts")
    if not isinstance(expected, dict):
        raise ProofError("Native ESP artifact hashes are missing")
    bindings = {
        "bootloader_sha256": args.bootloader,
        "kernel_sha256": args.kernel,
        "initramfs_sha256": args.initramfs,
    }
    for key, path in bindings.items():
        digest = expected.get(key)
        if not isinstance(digest, str) or SHA256_RE.fullmatch(digest) is None:
            raise ProofError(f"Native ESP proof has invalid artifact hash: {key}")
        if sha256_file(path) != digest:
            raise ProofError(f"QEMU artifact differs from Native ESP proof: {key}")

    if args.rendered_root.is_symlink() or not args.rendered_root.is_dir():
        raise ProofError("rendered Native entry root is unsafe")
    normal = args.rendered_root / "loader/entries/ordax-native.conf"
    recovery = args.rendered_root / "loader/entries/ordax-native-recovery.conf"
    for entry, mode in ((normal, "normal"), (recovery, "recovery")):
        regular(entry, f"rendered Native {mode} entry")
        text = entry.read_text(encoding="utf-8")
        if text.count(f"ordax.pool_uuid={args.pool_uuid}") != 1:
            raise ProofError(f"rendered Native {mode} entry does not bind exact UUID")
        if text.count(f"ordax.mode={mode}") != 1:
            raise ProofError(f"rendered Native {mode} mode is not exact")
        if text.count("ordax.product_mode=native-disk") != 1:
            raise ProofError(f"rendered Native {mode} product mode is not exact")
        lower = text.lower()
        for forbidden in ("passphrase", "password=", "key-file", "ordax.pool_key"):
            if forbidden in lower:
                raise ProofError("unlock secret material leaked into rendered boot entry")
    return esp


def find_ovmf() -> tuple[Path, Path]:
    pairs = (
        (Path("/usr/share/OVMF/OVMF_CODE.fd"), Path("/usr/share/OVMF/OVMF_VARS.fd")),
        (Path("/usr/share/OVMF/OVMF_CODE_4M.fd"), Path("/usr/share/OVMF/OVMF_VARS_4M.fd")),
    )
    for code, variables in pairs:
        try:
            resolved_code = code.resolve(strict=True)
            resolved_vars = variables.resolve(strict=True)
        except OSError:
            continue
        if resolved_code.is_file() and resolved_vars.is_file():
            return resolved_code, resolved_vars
    raise ProofError("non-Secure-Boot OVMF CODE/VARS pair not found")


def wait_block(path: Path, timeout: float = 8.0) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if path.is_block_device():
            return
        time.sleep(0.1)
    raise ProofError(f"loop partition did not appear: {path}")


def write_bootstrap_sentinel(pool_mount: Path) -> None:
    script = """#!/bin/sh
set -eu
fail() {
    /bin/busybox printf 'ORDAX_NATIVE_QEMU_HANDOFF=FAIL\n' > /dev/ttyS0
    exec /bin/busybox sleep 300
}
[ "${ORDAX_PRODUCT_MODE:-}" = "native-disk" ] || fail
[ "${ORDAX_STATE_DIR:-}" = "/var/lib/ordax" ] || fail
[ "${ORDAX_USER_HOME:-}" = "/var/home" ] || fail
/bin/busybox printf 'state\n' > /var/.ordax-qemu-state || fail
/bin/busybox printf 'home\n' > /home/.ordax-qemu-home || fail
/bin/busybox grep -qx home /var/home/.ordax-qemu-home || fail
/bin/busybox printf 'app\n' > /var/lib/ordax/apps/.ordax-qemu-app || fail
/bin/busybox printf 'container\n' > /var/lib/containers/.ordax-qemu-container || fail
/bin/busybox printf 'snapshot\n' > /.ordax-snapshots/.ordax-qemu-snapshot || fail
/bin/busybox printf 'ORDAX_NATIVE_QEMU_HANDOFF=PASS\n' > /dev/ttyS0
/bin/busybox printf 'ORDAX_NATIVE_QEMU_MODE=native-disk\n' > /dev/ttyS0
/bin/busybox printf 'ORDAX_NATIVE_QEMU_PERSISTENCE=PASS\n' > /dev/ttyS0
exec /bin/busybox sleep 300
"""
    path = pool_mount / "bootstrap/entrypoint"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(script, encoding="utf-8")
    path.chmod(0o755)

    recovery = pool_mount / "bootstrap/recovery/entrypoint"
    recovery.parent.mkdir(parents=True, exist_ok=True)
    recovery.write_text(
        "#!/bin/sh\n/bin/busybox printf 'ORDAX_NATIVE_QEMU_RECOVERY=PASS\\n' > /dev/ttyS0\nexec /bin/busybox sleep 300\n",
        encoding="utf-8",
    )
    recovery.chmod(0o755)


def stage_esp(
    mountpoint: Path,
    *,
    bootloader: Path,
    kernel: Path,
    initramfs: Path,
    loader_conf: Path,
    rendered_root: Path,
) -> None:
    targets = {
        "EFI/BOOT/BOOTX64.EFI": bootloader,
        "loader/loader.conf": loader_conf,
        "loader/entries/ordax-native.conf": rendered_root / "loader/entries/ordax-native.conf",
        "loader/entries/ordax-native-recovery.conf": rendered_root / "loader/entries/ordax-native-recovery.conf",
        "ordax/vmlinuz": kernel,
        "ordax/native-initrd.gz": initramfs,
    }
    for relative, source in targets.items():
        regular(source, f"ESP source {relative}")
        destination = mountpoint / relative
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(source, destination)


def connect_monitor(path: Path, timeout: float = 10.0) -> socket.socket:
    deadline = time.monotonic() + timeout
    last_error: OSError | None = None
    while time.monotonic() < deadline:
        client = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        client.settimeout(0.5)
        try:
            client.connect(str(path))
            try:
                client.recv(4096)
            except (socket.timeout, OSError):
                pass
            return client
        except OSError as exc:
            last_error = exc
            client.close()
            time.sleep(0.1)
    raise ProofError(f"QEMU monitor did not become ready: {last_error}")


def hmp(client: socket.socket, command: str) -> None:
    client.sendall((command + "\n").encode("ascii"))
    time.sleep(0.03)
    try:
        client.recv(4096)
    except (socket.timeout, OSError):
        pass


def type_passphrase(client: socket.socket, passphrase: str) -> None:
    for character in passphrase:
        if character not in ALPHABET:
            raise ProofError("generated passphrase contains unsupported virtual key")
        hmp(client, f"sendkey {character}")
    hmp(client, "sendkey ret")


def unlock_input_due(*, ready: bool, next_at: float | None, now: float,
                     attempts: int, unlocked: bool) -> bool:
    """Never send an unlock secret before a real Native guest readiness signal."""
    return (ready and next_at is not None and now >= next_at
            and 0 <= attempts < MAX_UNLOCK_INJECTIONS and not unlocked)


def qemu_version() -> str:
    first = capture(["qemu-system-x86_64", "--version"]).splitlines()
    return first[0] if first else "unknown"


def boot_qemu(
    disk: Path,
    code: Path,
    vars_template: Path,
    work: Path,
    passphrase: str,
) -> tuple[str, str, dict[str, bool]]:
    vars_copy = work / "OVMF_VARS.fd"
    shutil.copyfile(vars_template, vars_copy)
    serial = work / "serial.log"
    monitor = work / "monitor.sock"
    stderr = work / "qemu.stderr"
    command = [
        "qemu-system-x86_64",
        "-machine", "pc",
        "-accel", "tcg,thread=multi",
        "-m", "1024",
        "-smp", "2",
        "-drive", f"if=pflash,format=raw,readonly=on,file={code}",
        "-drive", f"if=pflash,format=raw,file={vars_copy}",
        "-drive", f"file={disk},format=raw,if=ide,index=0,media=disk",
        "-boot", "order=c,menu=off",
        "-display", "none",
        "-serial", f"file:{serial}",
        "-monitor", f"unix:{monitor},server=on,wait=off",
        "-net", "none",
        "-no-reboot",
    ]
    with stderr.open("wb") as error_stream:
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=error_stream,
        )

    client: socket.socket | None = None
    keyboard_injections = 0
    ready_at: float | None = None
    next_injection: float | None = None
    last_stage = "no-initramfs-signal"
    try:
        client = connect_monitor(monitor)
        started = time.monotonic()
        deadline = started + 120.0
        while time.monotonic() < deadline:
            text = serial.read_text(encoding="utf-8", errors="replace") if serial.exists() else ""
            if SUCCESS_MARKER in text and PERSISTENCE_MARKER in text:
                hmp(client, "quit")
                try:
                    process.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    process.terminate()
                    process.wait(timeout=5)
                checks = {
                    "ovmf_reached_native_pid1_handoff": True,
                    "interactive_unlock_via_virtual_keyboard": keyboard_injections > 0,
                    "persistent_subvolume_mounts_verified": PERSISTENCE_MARKER in text,
                    "qemu_network_disabled": "-net" in command and "none" in command,
                }
                return text, sha256_file(vars_copy), checks

            if NATIVE_RESCUE_MARKER in text:
                raise ProofError("Native initramfs reported rescue before verified handoff " 
                                 f"(last_stage=rescue, keyboard_injections={keyboard_injections})")
            if process.poll() is not None:
                break
            now = time.monotonic()
            if NATIVE_START_MARKER in text:
                last_stage = "init-ready"
            if NATIVE_READY_MARKER in text:
                last_stage = "unlock-ready"
                if ready_at is None:
                    ready_at = now
                    next_injection = now + UNLOCK_READY_GRACE_SECONDS
            if NATIVE_UNLOCKED_MARKER in text:
                last_stage = "pool-unlocked"
            if unlock_input_due(ready=ready_at is not None, next_at=next_injection,
                                now=now, attempts=keyboard_injections,
                                unlocked=NATIVE_UNLOCKED_MARKER in text):
                type_passphrase(client, passphrase)
                keyboard_injections += 1
                next_injection = now + UNLOCK_RETRY_INTERVAL_SECONDS
            time.sleep(0.25)

        process.poll()
        tail = stderr.read_text(encoding="utf-8", errors="replace")[-4000:] if stderr.exists() else ""
        raise ProofError(
            "QEMU did not reach the Native handoff marker "
            f"(exit={process.returncode}, last_stage={last_stage}, "
            f"keyboard_injections={keyboard_injections}, stderr_tail={tail!r})"
        )
    finally:
        if client is not None:
            try:
                client.close()
            except OSError:
                pass
        if process.poll() is None:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=5)


def prove(args: argparse.Namespace) -> dict[str, Any]:
    if os.name != "posix" or os.geteuid() != 0:
        raise ProofError("Native QEMU boot proof requires root on a POSIX CI host")
    require_programs()
    esp_proof = verify_inputs(args)
    code, vars_template = find_ovmf()

    work = Path(tempfile.mkdtemp(prefix="ordax-native-qemu-"))
    disk = work / "native-qemu.raw"
    key = work / "unlock.key"
    esp_mount = work / "esp"
    pool_mount = work / "pool"
    mapper = f"ordax_qemu_pool_{os.getpid()}"
    mapper_path = Path("/dev/mapper") / mapper
    loop = ""
    mapper_open = False
    esp_mounted = False
    pool_mounted = False
    passphrase = "".join(secrets.choice(ALPHABET) for _ in range(24))

    checks = {
        "native_esp_proof_bound": False,
        "regular_sparse_disk_only": False,
        "gpt_native_layout": False,
        "luks_uuid_matches_rendered_entries": False,
        "btrfs_subvolumes_materialized": False,
        "ephemeral_key_destroyed_before_vm_boot": False,
        "ovmf_reached_native_pid1_handoff": False,
        "interactive_unlock_via_virtual_keyboard": False,
        "persistent_subvolume_mounts_verified": False,
        "qemu_network_disabled": False,
        "physical_target_device_untouched": True,
        "guest_disk_destroyed": False,
        "ovmf_vars_destroyed": False,
    }

    serial_text = ""
    ovmf_vars_hash = ""
    try:
        checks["native_esp_proof_bound"] = True
        with disk.open("wb") as handle:
            handle.truncate(DISK_BYTES)
        regular(disk, "disposable QEMU disk")
        checks["regular_sparse_disk_only"] = True

        run(["sgdisk", "--zap-all", str(disk)])
        run([
            "sgdisk",
            "--new=1:2048:+1G",
            "--typecode=1:c12a7328-f81f-11d2-ba4b-00a0c93ec93b",
            "--change-name=1:ORDAX-ESP",
            str(disk),
        ])
        run([
            "sgdisk",
            "--new=2:0:0",
            f"--typecode=2:{POOL_TYPE_GUID}",
            "--change-name=2:ORDAX-POOL",
            str(disk),
        ])
        run(["sgdisk", "--verify", str(disk)])

        loop = capture(["losetup", "--find", "--show", "--partscan", str(disk)])
        if not loop.startswith("/dev/loop"):
            raise ProofError("disposable disk did not map to a loop device")
        esp = Path(loop + "p1")
        pool = Path(loop + "p2")
        wait_block(esp)
        wait_block(pool)
        checks["gpt_native_layout"] = True

        run(["mkfs.vfat", "-F", "32", "-n", "ORDAX-ESP", str(esp)])
        key.write_bytes(passphrase.encode("ascii"))
        key.chmod(0o600)
        run([
            "cryptsetup", "luksFormat",
            "--type", "luks2",
            "--batch-mode",
            "--pbkdf", "pbkdf2",
            "--uuid", args.pool_uuid,
            "--key-file", str(key),
            str(pool),
        ])
        observed_uuid = capture(["cryptsetup", "luksUUID", str(pool)]).lower()
        if observed_uuid != args.pool_uuid:
            raise ProofError("QEMU LUKS2 partition UUID differs from rendered entries")
        checks["luks_uuid_matches_rendered_entries"] = True

        run([
            "cryptsetup", "open",
            "--type", "luks2",
            "--key-file", str(key),
            str(pool),
            mapper,
        ])
        mapper_open = True
        run(["mkfs.btrfs", "-f", "-L", "ORDAX-POOL", str(mapper_path)])

        pool_mount.mkdir()
        run(["mount", "-t", "btrfs", "-o", "rw,subvolid=5", str(mapper_path), str(pool_mount)])
        pool_mounted = True
        for name in SUBVOLUMES:
            run(["btrfs", "subvolume", "create", str(pool_mount / name)])
        listing = capture(["btrfs", "subvolume", "list", str(pool_mount)])
        for name in SUBVOLUMES:
            if re.search(rf"\bpath {re.escape(name)}$", listing, re.MULTILINE) is None:
                raise ProofError(f"QEMU disk lost Native Btrfs subvolume: {name}")

        marker = pool_mount / "bootstrap/config/product-mode"
        marker.parent.mkdir(parents=True, exist_ok=True)
        marker.write_text("native-disk\n", encoding="utf-8")
        write_bootstrap_sentinel(pool_mount)
        os.sync()
        checks["btrfs_subvolumes_materialized"] = True
        run(["umount", str(pool_mount)])
        pool_mounted = False
        run(["cryptsetup", "close", mapper])
        mapper_open = False

        esp_mount.mkdir()
        run(["mount", "-t", "vfat", "-o", "rw,umask=0022", str(esp), str(esp_mount)])
        esp_mounted = True
        stage_esp(
            esp_mount,
            bootloader=args.bootloader,
            kernel=args.kernel,
            initramfs=args.initramfs,
            loader_conf=args.loader_conf,
            rendered_root=args.rendered_root,
        )
        os.sync()
        run(["umount", str(esp_mount)])
        esp_mounted = False
        run(["losetup", "-d", loop])
        loop = ""

        key.unlink()
        checks["ephemeral_key_destroyed_before_vm_boot"] = not key.exists()
        if not checks["ephemeral_key_destroyed_before_vm_boot"]:
            raise ProofError("ephemeral unlock key survived until VM boot")

        serial_text, ovmf_vars_hash, qemu_checks = boot_qemu(
            disk, code, vars_template, work, passphrase
        )
        checks.update(qemu_checks)

        # The passphrase must never enter evidence output.
        if passphrase in serial_text:
            raise ProofError("unlock secret leaked into guest serial output")

        qemu_disk_sha = sha256_file(disk)
        disk.unlink()
        checks["guest_disk_destroyed"] = not disk.exists()
        vars_copy = work / "OVMF_VARS.fd"
        if vars_copy.exists():
            vars_copy.unlink()
        checks["ovmf_vars_destroyed"] = not vars_copy.exists()

        if not all(checks.values()):
            raise ProofError(f"Native QEMU checks incomplete: {checks}")

        result = {
            "$schema": SCHEMA,
            "status": "pass",
            "source_commit": args.source_commit,
            "pool_uuid": args.pool_uuid,
            "pool_uuid_is_secret": False,
            "physical_target_device_touched": False,
            "host_loop_devices_used": True,
            "physical_write_authorized": False,
            "qemu_uefi_boot_proven": True,
            "pid1_kernel_cmdline_path_proven": True,
            "bootstrap_handoff_path_proven": True,
            "production_stable_release_boot_proven": False,
            "physical_native_boot_proven": False,
            "qemu_required_for_end_users": False,
            "artifacts": dict(esp_proof["artifacts"]),
            "qemu": {
                "version": qemu_version(),
                "machine": "pc",
                "acceleration": "tcg",
                "network": "disabled",
                "disk_transport": "piix-ide",
            },
            "firmware": {
                "code_sha256": sha256_file(code),
                "vars_template_sha256": sha256_file(vars_template),
                "ephemeral_vars_sha256_before_destruction": ovmf_vars_hash,
            },
            "guest_disk": {
                "sha256_before_destruction": qemu_disk_sha,
                "retained": False,
            },
            "serial_markers": [
                SUCCESS_MARKER,
                "ORDAX_NATIVE_QEMU_MODE=native-disk",
                PERSISTENCE_MARKER,
            ],
            "checks": checks,
        }
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        return result
    finally:
        if pool_mounted:
            subprocess.run(["umount", "-l", str(pool_mount)], check=False)
        if esp_mounted:
            subprocess.run(["umount", "-l", str(esp_mount)], check=False)
        if mapper_open:
            subprocess.run(["cryptsetup", "close", mapper], check=False)
        if loop:
            subprocess.run(["losetup", "-d", loop], check=False)
        try:
            key.unlink()
        except FileNotFoundError:
            pass
        try:
            disk.unlink()
        except FileNotFoundError:
            pass
        shutil.rmtree(work, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--esp-proof", type=Path, required=True)
    parser.add_argument("--bootloader", type=Path, required=True)
    parser.add_argument("--kernel", type=Path, required=True)
    parser.add_argument("--initramfs", type=Path, required=True)
    parser.add_argument("--loader-conf", type=Path, required=True)
    parser.add_argument("--rendered-root", type=Path, required=True)
    parser.add_argument("--pool-uuid", required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    for field in (
        "esp_proof",
        "bootloader",
        "kernel",
        "initramfs",
        "loader_conf",
        "rendered_root",
        "out",
    ):
        setattr(args, field, getattr(args, field).resolve())
    try:
        result = prove(args)
        print(json.dumps(result, indent=2, sort_keys=True))
        print("NATIVE_QEMU_UEFI_BOOT_PROOF=PASS")
        print("NATIVE_QEMU_PRODUCTION_RELEASE_BOOT_PROVEN=NO")
        print("NATIVE_QEMU_PHYSICAL_WRITE_AUTHORIZED=NO")
        return 0
    except (ProofError, OSError, json.JSONDecodeError, KeyError) as exc:
        print(f"native-qemu-boot-proof: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
