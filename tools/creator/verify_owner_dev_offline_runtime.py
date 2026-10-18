#!/usr/bin/env python3
"""Release gate: require an offline Owner/Development graphical boot runtime.

The checked-out Surface owns RUNTIME_ID. A git checkout and kernel alone are
not enough to promise cold-boot Welcome with networking disconnected.
This verifier performs no network access, installation, or media writes.
"""
from __future__ import annotations

import argparse
from pathlib import Path
import re
import sys


class OfflineRuntimeError(ValueError):
    pass


REQUIRED_FILES = (
    "usr/bin/cage",
    "usr/bin/python3",
    "usr/bin/Xwayland",
    "usr/bin/seatd-launch",
    "sbin/udevd",
    "bin/udevadm",
    "bin/busybox",
    "usr/lib/girepository-1.0/Gtk-3.0.typelib",
    "usr/lib/girepository-1.0/WebKit2-4.1.typelib",
    "usr/lib/udev/rules.d/60-input-id.rules",
)


def verify(stage: Path) -> str:
    base = stage / "ORDAX" / "dev-base"
    surface = base / "workspace" / "ordax" / "system" / "surface" / "bin" / "ordax-surface"
    if not surface.is_file() or surface.is_symlink():
        raise OfflineRuntimeError("Owner Dev seed lacks canonical Surface entrypoint")
    source = surface.read_text(encoding="utf-8")
    matches = re.findall(r"^RUNTIME_ID=([a-z0-9][a-z0-9.-]*)$", source, re.MULTILINE)
    if len(matches) != 1:
        raise OfflineRuntimeError("Surface runtime identity is missing or ambiguous")
    runtime_id = matches[0]
    root = base / "state" / "ordax" / "runtime" / "native-surface" / runtime_id
    marker = root / "ready"
    if not marker.is_file() or marker.is_symlink() or marker.read_text(encoding="utf-8").strip() != runtime_id:
        raise OfflineRuntimeError(
            f"Owner Dev release has no verified offline graphical runtime: {runtime_id}; "
            "do not publish a USB requiring first-boot APK/network provisioning"
        )
    fs = root / "rootfs"
    for rel in REQUIRED_FILES:
        item = fs / rel
        if not item.is_file() or item.is_symlink() or item.stat().st_size == 0:
            raise OfflineRuntimeError(f"offline graphical runtime missing required file: {rel}")
    for rel in ("usr/bin/cage", "usr/bin/python3", "usr/bin/Xwayland", "usr/bin/seatd-launch",
                "sbin/udevd", "bin/udevadm", "bin/busybox"):
        if fs.joinpath(rel).stat().st_mode & 0o111 == 0:
            raise OfflineRuntimeError(f"offline graphical executable has no execute permission: {rel}")
    return runtime_id


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-root", required=True, type=Path)
    args = parser.parse_args()
    try:
        runtime_id = verify(args.stage_root)
    except (OfflineRuntimeError, OSError, UnicodeError) as exc:
        print(f"OWNER_DEV_OFFLINE_WELCOME_RELEASE_GATE=FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"OWNER_DEV_OFFLINE_WELCOME_RELEASE_GATE=PASS runtime_id={runtime_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
