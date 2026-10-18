#!/usr/bin/env python3
"""Real, network-isolated QEMU boot of the exact disposable Owner USB seed.

This checks the Owner initramfs -> preseeded Git checkout -> Surface handoff.
It does not claim visible Welcome/physical GPU or notebook readiness. QEMU only
receives a temporary regular-file COPY of the Creator-verified USB image.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import time

SCHEMA = "prototype-ordax.owner-offline-qemu-handoff/1"
SHA = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")
MAX_SECONDS = 300
MARKER_BASE = "OrdaX Development Base"
MARKER_OFFLINE = "OrdaX: iniciando a Surface local sem internet..."
RECOVERY = ("entering local recovery shell", "ordax-dev-bootstrap: entering local recovery shell")


class ProofError(RuntimeError):
    pass


def regular(path: Path, description: str) -> Path:
    # Reject device paths even if a caller hands us a symlink alias.
    if path.is_symlink():
        raise ProofError(f"{description} is a symlink")
    resolved = path.resolve(strict=True)
    if str(resolved).startswith("/dev/"):
        raise ProofError(f"{description} must not be a physical device")
    info = resolved.stat()
    if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or not info.st_size:
        raise ProofError(f"{description} must be a nonempty single-link regular file")
    return resolved


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1048576), b""):
            h.update(chunk)
    return h.hexdigest()


def validate(raw: Path, media_proof: Path, kernel: Path, initramfs: Path, source: str) -> str:
    if COMMIT.fullmatch(source) is None:
        raise ProofError("Owner source commit must be exactly 40 lowercase hexadecimal characters")
    raw, media_proof = regular(raw, "USB RAW"), regular(media_proof, "Creator media proof")
    regular(kernel, "OrdaX kernel")
    regular(initramfs, "OrdaX initramfs")
    data = json.loads(media_proof.read_text(encoding="utf-8"))
    expected = data.get("image_sha256")
    if (data.get("$schema") != "prototype-ordax.creator-disposable-media-proof/1"
            or data.get("status") != "pass"
            or data.get("physical_write_authorized") is not False
            or not isinstance(expected, str) or SHA.fullmatch(expected) is None
            or data.get("image_bytes") != raw.stat().st_size
            or data.get("partition_table") != "gpt"
            or any(value is not True for value in data.get("checks", {}).values())
            or not data.get("checks")):
        raise ProofError("Creator media proof is incomplete or claims physical authority")
    if digest(raw) != expected:
        raise ProofError("Owner USB RAW differs from the passing Creator media proof")
    return expected


def qemu_command(image: Path, kernel: Path, initramfs: Path, serial: Path) -> list[str]:
    return [
        "qemu-system-x86_64", "-machine", "q35", "-accel", "tcg,thread=multi",
        "-m", "2048", "-smp", "2",
        "-kernel", str(kernel), "-initrd", str(initramfs),
        "-append", (
            "console=ttyS0,115200n8 rdinit=/init ordax.mode=normal "
            "ordax.distribution_profile=owner-development"
        ),
        "-drive", f"if=none,id=ownerusb,format=raw,file={image}",
        "-device", "qemu-xhci,id=owner-xhci",
        "-device", "usb-storage,bus=owner-xhci.0,drive=ownerusb,bootindex=1",
        "-device", "usb-kbd,bus=owner-xhci.0",
        "-device", "usb-mouse,bus=owner-xhci.0",
        "-device", "virtio-vga",
        "-net", "none", "-display", "none", "-monitor", "none",
        "-serial", f"file:{serial}", "-no-reboot",
    ]


def observed(text: str, source: str) -> dict[str, bool]:
    return {
        "dev_base_started": MARKER_BASE in text,
        "exact_local_checkout": f"Checkout local verificado: {source}" in text,
        "offline_surface_handoff": MARKER_OFFLINE in text,
        "recovery_not_entered": not any(item in text for item in RECOVERY),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--media-proof", type=Path, required=True)
    parser.add_argument("--kernel", type=Path, required=True)
    parser.add_argument("--initramfs", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--timeout-seconds", type=int, default=210)
    args = parser.parse_args()

    try:
        if not 30 <= args.timeout_seconds <= MAX_SECONDS:
            raise ProofError("QEMU timeout is outside the 30–300 second bound")
        if shutil.which("qemu-system-x86_64") is None:
            raise ProofError("QEMU system emulator is missing")
        if shutil.which("cp") is None:
            raise ProofError("sparse copy command is missing")
        raw_sha = validate(
            args.raw, args.media_proof, args.kernel, args.initramfs, args.source_commit
        )
        if args.output.exists() or args.output.is_symlink():
            raise ProofError("proof output exists; refusing overwrite")
        if not args.output.parent.is_dir() or args.output.parent.is_symlink():
            raise ProofError("proof output parent is unavailable or unsafe")
        with tempfile.TemporaryDirectory(prefix="ordax-owner-qemu-") as temporary:
            root = Path(temporary)
            disk, serial = root / "usb.raw", root / "serial.log"
            subprocess.run(
                ["cp", "--sparse=always", "--reflink=auto", "--", str(args.raw), str(disk)],
                check=True, timeout=80,
            )
            if digest(disk) != raw_sha:
                raise ProofError("QEMU guest disk copy does not match verified Owner seed")
            command = qemu_command(
                disk, regular(args.kernel, "kernel"), regular(args.initramfs, "initramfs"), serial
            )
            guest = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            try:
                deadline = time.monotonic() + args.timeout_seconds
                checks: dict[str, bool] = {}
                while time.monotonic() < deadline:
                    text = serial.read_text(encoding="utf-8", errors="replace") if serial.exists() else ""
                    checks = observed(text, args.source_commit)
                    if not checks["recovery_not_entered"]:
                        # The guest is disposable and the tail is limited; emit
                        # the genuine kernel/initramfs cause before removal.
                        raise ProofError(
                            "Owner USB entered recovery during offline QEMU boot; "
                            f"checks={checks}; serial-tail={text[-3500:]!r}"
                        )
                    if all(checks.values()):
                        break
                    if guest.poll() is not None:
                        detail = text[-3500:]
                        errors = guest.stderr.read(1500).decode("utf-8", "replace") if guest.stderr else ""
                        raise ProofError(
                            "QEMU exited before offline Surface handoff; "
                            f"returncode={guest.returncode}; serial-tail={detail!r}; qemu-stderr={errors!r}"
                        )
                    time.sleep(1)
                if not checks or not all(checks.values()):
                    detail = serial.read_text(encoding="utf-8", errors="replace")[-2500:] if serial.exists() else ""
                    raise ProofError(f"Owner USB offline handoff timed out; checks={checks}; serial-tail={detail!r}")
                report = {
                    "$schema": SCHEMA, "status": "pass",
                    "source_commit": args.source_commit,
                    "raw_sha256": raw_sha, "checks": checks,
                    "network_device_attached": False,
                    "physical_device_touched": False,
                    "physical_write_authorized": False,
                    "qemu_boot_scope": "direct-kernel-owner-initramfs-to-local-surface-handoff",
                    "welcome_screen_rendered_proven": False,
                    "notebook_boot_proven": False,
                }
                args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                print("ORDAX_OWNER_QEMU_OFFLINE_HANDOFF=PASS")
                return 0
            finally:
                if guest.poll() is None:
                    guest.terminate()
                    try:
                        guest.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        guest.kill()
                        guest.wait(timeout=5)
                if guest.stderr is not None:
                    guest.stderr.close()
    except (OSError, ProofError, ValueError, json.JSONDecodeError, subprocess.SubprocessError) as exc:
        print(f"ORDAX_OWNER_QEMU_OFFLINE_HANDOFF=FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
