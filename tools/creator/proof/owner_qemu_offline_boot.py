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
import socket
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
MARKER_HEALTH = "cold-boot Surface acknowledged healthy state"
MARKER_VIRTIO_WEBKIT = "ordax-surface: owner virtio_gpu selected WebKit non-DMA-BUF transport"
STABLE_SECONDS = 15
BAD_SURFACE = (
    "cold-boot Surface did not become healthy",
    "Surface exited with status",
    "supervisor exceeded crash budget",
    "ordax-surface: native Cage/OrdaX WebKit host exited",
)
RECOVERY = ("entering local recovery shell", "ordax-dev-bootstrap: entering local recovery shell")
WEBKIT_EVENT_PREFIX = "ORDAX_OWNER_WEBKIT_EVENT="
WEBKIT_LOAD_ORDER = (
    "surface-page-load-started",
    "surface-page-load-committed",
    "surface-page-load-finished",
)
WEBKIT_FATAL_MARKERS = (
    WEBKIT_EVENT_PREFIX + "surface-page-load-failed",
    WEBKIT_EVENT_PREFIX + "surface-web-process-terminated",
)


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


def qemu_command(
    image: Path, kernel: Path, initramfs: Path, serial: Path,
    qmp_socket: Path | None = None,
) -> list[str]:
    return [
        "qemu-system-x86_64", "-machine", "q35", "-accel", "tcg,thread=multi",
        "-m", "3072", "-smp", "2",
        "-kernel", str(kernel), "-initrd", str(initramfs),
        "-append", (
            "console=ttyS0,115200n8 rdinit=/init ordax.mode=normal "
            "ordax.distribution_profile=owner-development "
            "ordax.owner_qemu_graphics_probe=1"
        ),
        "-drive", f"if=none,id=ownerusb,format=raw,file={image}",
        "-device", "qemu-xhci,id=owner-xhci",
        "-device", "usb-storage,bus=owner-xhci.0,drive=ownerusb,removable=on,bootindex=1",
        "-device", "usb-kbd,bus=owner-xhci.0",
        "-device", "usb-mouse,bus=owner-xhci.0",
        "-device", "virtio-vga",
        "-net", "none", "-display", "none", "-monitor", "none",
        "-serial", f"file:{serial}", "-no-reboot",
        *(
            ["-qmp", f"unix:{qmp_socket},server=on,wait=off"]
            if qmp_socket is not None else []
        ),
    ]


def webkit_page_loaded(text: str) -> bool:
    """Require ordered callbacks from the actual privileged native WebKit view.

    A healthy process heartbeat cannot substitute for a page load. The separate
    QMP framebuffer gate still proves rendering; these callbacks alone do not.
    """
    stage = 0
    for line in text.splitlines():
        if not line.startswith(WEBKIT_EVENT_PREFIX):
            continue
        event = line[len(WEBKIT_EVENT_PREFIX):].strip()
        if event == WEBKIT_LOAD_ORDER[stage]:
            stage += 1
            if stage == len(WEBKIT_LOAD_ORDER):
                return True
    return False


def observed(text: str, source: str) -> dict[str, bool]:
    return {
        "dev_base_started": MARKER_BASE in text,
        "exact_local_checkout": f"Checkout local verificado: {source}" in text,
        "offline_surface_handoff": MARKER_OFFLINE in text,
        "native_surface_heartbeat": MARKER_HEALTH in text,
        "privileged_webkit_page_loaded": webkit_page_loaded(text),
        "virtual_drm_transport_selected": MARKER_VIRTIO_WEBKIT in text,
        "webkit_process_not_failed": not any(item in text for item in WEBKIT_FATAL_MARKERS),
        "recovery_not_entered": not any(item in text for item in RECOVERY),
        "no_surface_restart_or_failure": not any(item in text for item in BAD_SURFACE),
    }



def analyze_ppm(path: Path) -> dict[str, int | float]:
    """Read actual QEMU P6 framebuffer pixels, rejecting blank or text-only VGA."""
    data = path.read_bytes()
    if len(data) > 48 * 1024 * 1024:
        raise ProofError("QEMU framebuffer exceeds bounded evidence size")
    # QEMU's P6 screendump has a simple fixed ASCII header (no comments).
    match = re.match(rb"\AP6\s+([0-9]+)\s+([0-9]+)\s+([0-9]+)\r?\n", data)
    if match is None:
        raise ProofError("QEMU did not produce a binary PPM P6 framebuffer")
    width, height, depth = (int(s) for s in match.groups())
    if (depth != 255 or not 320 <= width <= 4096 or
            not 200 <= height <= 2160 or
            len(data) - match.end() != width * height * 3):
        raise ProofError("QEMU PPM dimensions/depth/bytes are inconsistent")
    pixels = memoryview(data)[match.end():]
    sample_stride = max(1, (width * height) // 60000)
    distinct: set[tuple[int, int, int]] = set()
    lit = 0
    count = 0
    for pixel in range(0, width * height, sample_stride):
        offset = pixel * 3
        red, green, blue = pixels[offset], pixels[offset + 1], pixels[offset + 2]
        distinct.add((red >> 3, green >> 3, blue >> 3))
        count += 1
        if max(red, green, blue) > 35:
            lit += 1
    lit_fraction = lit / count
    # Native GUI has a color composition. A black frame or plain tty glyph
    # raster cannot qualify as an observed graphical surface.
    if lit_fraction < 0.09 or len(distinct) < 24:
        raise ProofError(
            "QEMU graphical framebuffer is blank or console-like; "
            f"lit_fraction={lit_fraction:.3f}, quantized_colors={len(distinct)}"
        )
    return {
        "width": width, "height": height,
        "lit_fraction": round(lit_fraction, 5),
        "quantized_colors": len(distinct),
        "pixel_count": width * height,
    }


def capture_qmp_framebuffer(socket_path: Path, image_path: Path) -> dict[str, int | float]:
    if image_path.exists() or image_path.is_symlink():
        raise ProofError("QEMU framebuffer evidence destination already exists")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
        connection.settimeout(8)
        connection.connect(str(socket_path))
        with connection.makefile("rwb", buffering=0) as channel:
            greeting = json.loads(channel.readline())
            if "QMP" not in greeting:
                raise ProofError("QEMU QMP greeting is invalid")
            def request(command: str, arguments: dict | None = None) -> None:
                payload: dict = {"execute": command}
                if arguments is not None:
                    payload["arguments"] = arguments
                channel.write(json.dumps(payload).encode("utf-8") + b"\r\n")
                for _ in range(32):
                    line = channel.readline()
                    if not line:
                        raise ProofError("QMP disconnected before reply")
                    reply = json.loads(line)
                    if "error" in reply:
                        raise ProofError(f"QMP {command} refused graphical proof: {reply['error']!r}")
                    if "return" in reply:
                        return
                raise ProofError(f"QMP {command} reply was not observed")
            request("qmp_capabilities")
            request("screendump", {"filename": str(image_path)})
    if image_path.is_symlink() or not image_path.is_file():
        raise ProofError("QEMU screenshot was not created as a regular file")
    return analyze_ppm(image_path)

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--raw", type=Path, required=True)
    parser.add_argument("--media-proof", type=Path, required=True)
    parser.add_argument("--kernel", type=Path, required=True)
    parser.add_argument("--initramfs", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--framebuffer-out", type=Path, required=True)
    parser.add_argument("--serial-out", type=Path, required=True)
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
        if (args.framebuffer_out.exists() or args.framebuffer_out.is_symlink()
                or args.framebuffer_out.parent != args.output.parent):
            raise ProofError("framebuffer destination must be new and beside the proof receipt")
        if (args.serial_out.exists() or args.serial_out.is_symlink()
                or args.serial_out.parent != args.output.parent):
            raise ProofError("serial evidence destination must be new and beside the proof receipt")
        with tempfile.TemporaryDirectory(prefix="ordax-owner-qemu-") as temporary:
            root = Path(temporary)
            disk, serial, qmp_socket = (
                root / "usb.raw", root / "serial.log", root / "monitor.sock"
            )
            subprocess.run(
                ["cp", "--sparse=always", "--reflink=auto", "--", str(args.raw), str(disk)],
                check=True, timeout=80,
            )
            if digest(disk) != raw_sha:
                raise ProofError("QEMU guest disk copy does not match verified Owner seed")
            command = qemu_command(
                disk, regular(args.kernel, "kernel"), regular(args.initramfs, "initramfs"),
                serial, qmp_socket
            )
            guest = subprocess.Popen(
                command, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE
            )
            try:
                deadline = time.monotonic() + args.timeout_seconds
                checks: dict[str, bool] = {}
                healthy_since: float | None = None
                while time.monotonic() < deadline:
                    text = serial.read_text(encoding="utf-8", errors="replace") if serial.exists() else ""
                    checks = observed(text, args.source_commit)
                    if (not checks["recovery_not_entered"] or not checks["no_surface_restart_or_failure"]
                            or not checks["webkit_process_not_failed"]):
                        # The guest is disposable and the tail is limited; emit
                        # the genuine kernel/initramfs/UI cause before removal.
                        raise ProofError(
                            "Owner USB entered recovery or Surface failed during offline QEMU boot; "
                            f"checks={checks}; serial-tail={text[-3500:]!r}"
                        )
                    if all(checks.values()):
                        if healthy_since is None:
                            healthy_since = time.monotonic()
                        if time.monotonic() - healthy_since >= STABLE_SECONDS:
                            break
                    else:
                        healthy_since = None
                    if guest.poll() is not None:
                        detail = text[-3500:]
                        errors = guest.stderr.read(1500).decode("utf-8", "replace") if guest.stderr else ""
                        raise ProofError(
                            "QEMU exited before offline Surface handoff; "
                            f"returncode={guest.returncode}; serial-tail={detail!r}; qemu-stderr={errors!r}"
                        )
                    time.sleep(1)
                if not checks or not all(checks.values()) or healthy_since is None or time.monotonic() - healthy_since < STABLE_SECONDS:
                    detail = serial.read_text(encoding="utf-8", errors="replace")[-3500:] if serial.exists() else ""
                    raise ProofError(f"Owner USB offline rendered-health check timed out; checks={checks}; serial-tail={detail!r}")
                framebuffer = capture_qmp_framebuffer(qmp_socket, args.framebuffer_out)
                report = {
                    "$schema": SCHEMA, "status": "pass",
                    "source_commit": args.source_commit,
                    "raw_sha256": raw_sha, "checks": checks,
                    "healthy_observation_seconds": STABLE_SECONDS,
                    "qemu_framebuffer": framebuffer,
                    "graphical_framebuffer_varied_proven": True,
                    "network_device_attached": False,
                    "physical_device_touched": False,
                    "physical_write_authorized": False,
                    "qemu_boot_scope": "direct-kernel-owner-initramfs-to-real-surface-heartbeat",
                    "welcome_screen_rendered_proven": False,
                    "notebook_boot_proven": False,
                }
                args.output.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
                print("ORDAX_OWNER_QEMU_OFFLINE_HANDOFF=PASS")
                return 0
            finally:
                # Preserve real guest serial diagnostics on BOTH outcomes.
                # No synthetic markers, disks, credentials or runtime state.
                if serial.is_file() and not args.serial_out.exists():
                    with serial.open("rb") as guest_serial, args.serial_out.open("xb") as evidence:
                        evidence.write(guest_serial.read(128 * 1024))
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
