#!/usr/bin/env python3
"""Distribution-neutral firmware coverage policy for OrdaX base profiles.

The policy reads firmware= declarations from the selected canonical kernel
modules and verifies that the target root contains at least one usable firmware
alternative for every module that requires firmware. Firmware acquisition stays
with the base builder; this module owns only coverage and evidence.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re

FIRMWARE_FIELD_RE = re.compile(rb"(?:^|\x00)firmware=([^\x00]+)")


class FirmwareSelectionError(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def module_firmware_declarations(rootfs: Path) -> dict[Path, set[str]]:
    modules_root = rootfs / "lib" / "modules"
    if not modules_root.is_dir():
        raise FirmwareSelectionError("kernel modules directory is missing")
    release_dirs = [path for path in modules_root.iterdir() if path.is_dir()]
    if len(release_dirs) != 1:
        raise FirmwareSelectionError(
            f"expected one installed kernel release, found {len(release_dirs)}"
        )

    module_files = sorted(release_dirs[0].rglob("*.ko"))
    if not module_files:
        raise FirmwareSelectionError("selected kernel modules are missing")

    declarations: dict[Path, set[str]] = {}
    for module in module_files:
        names: set[str] = set()
        data = module.read_bytes()
        for match in FIRMWARE_FIELD_RE.finditer(data):
            try:
                name = match.group(1).decode("ascii")
            except UnicodeDecodeError as exc:
                raise FirmwareSelectionError(
                    f"invalid firmware declaration in {module.name}"
                ) from exc
            relative = Path(name)
            if not name or relative.is_absolute() or ".." in relative.parts:
                raise FirmwareSelectionError(
                    f"unsafe firmware declaration in {module.name}: {name}"
                )
            names.add(relative.as_posix())
        declarations[module] = names
    return declarations


def resolve_firmware_source(firmware_root: Path, name: str) -> Path | None:
    exact = firmware_root / name
    candidates = (exact, Path(str(exact) + ".zst"))
    source = next(
        (candidate for candidate in candidates if candidate.exists() or candidate.is_symlink()),
        None,
    )
    if source is None:
        return None

    current = source
    seen: set[Path] = set()
    for _ in range(64):
        try:
            current.relative_to(firmware_root)
        except ValueError as exc:
            raise FirmwareSelectionError(
                f"firmware symlink escaped /lib/firmware: {name}"
            ) from exc

        if not current.is_symlink():
            return current if current.is_file() else None
        if current in seen:
            raise FirmwareSelectionError(f"firmware symlink loop: {name}")
        seen.add(current)

        value = os.readlink(current)
        if os.path.isabs(value):
            current = firmware_root / value.lstrip("/")
        else:
            current = current.parent / value
        current = Path(os.path.normpath(current))
        try:
            current.relative_to(firmware_root)
        except ValueError as exc:
            raise FirmwareSelectionError(
                f"firmware symlink escaped /lib/firmware: {name}"
            ) from exc
        if not current.exists() and not current.is_symlink():
            compressed = Path(str(current) + ".zst")
            if compressed.exists() or compressed.is_symlink():
                current = compressed
            else:
                return None
    raise FirmwareSelectionError(f"firmware symlink depth exceeded: {name}")


def available_firmware_names(
    rootfs: Path,
    *,
    log_prefix: str = "ORDAX_DEV_BASE",
) -> set[str]:
    firmware_root = rootfs / "lib" / "firmware"
    if not firmware_root.is_dir():
        raise FirmwareSelectionError("firmware directory is missing")

    declarations = module_firmware_declarations(rootfs)
    declared_names = set().union(*declarations.values()) if declarations else set()
    requiring = {module: names for module, names in declarations.items() if names}
    if not requiring:
        raise FirmwareSelectionError("selected Wi-Fi modules declared no firmware")

    selected: set[str] = set()
    unavailable_alternatives = 0
    uncovered: list[tuple[Path, set[str]]] = []

    for module, names in requiring.items():
        available = {
            name
            for name in names
            if resolve_firmware_source(firmware_root, name) is not None
        }
        unavailable_alternatives += len(names - available)
        if not available:
            uncovered.append((module, names))
            continue
        selected.update(available)

    print(f"{log_prefix}_FIRMWARE_DECLARED={len(declared_names)}", flush=True)
    print(f"{log_prefix}_FIRMWARE_MODULES_REQUIRING={len(requiring)}", flush=True)
    print(
        f"{log_prefix}_FIRMWARE_AVAILABLE="
        f"{len(selected)} unavailable_alternatives={unavailable_alternatives}",
        flush=True,
    )

    if uncovered:
        details = []
        for module, names in uncovered[:6]:
            preview = ", ".join(sorted(names)[:6])
            details.append(f"{module.name}: {preview}")
        raise FirmwareSelectionError(
            "firmware coverage missing for "
            f"{len(uncovered)} module(s): {'; '.join(details)}"
        )
    if not selected:
        raise FirmwareSelectionError("no declared firmware is available in the selected base")
    return selected


def coverage_receipt(rootfs: Path, *, log_prefix: str) -> dict:
    rootfs = rootfs.resolve()
    selected = sorted(available_firmware_names(rootfs, log_prefix=log_prefix))
    firmware_root = rootfs / "lib/firmware"
    files = []
    for name in selected:
        source = resolve_firmware_source(firmware_root, name)
        if source is None:
            raise FirmwareSelectionError(f"selected firmware disappeared during receipt: {name}")
        files.append({
            "name": name,
            "source": "/" + source.relative_to(rootfs).as_posix(),
            "sha256": sha256_file(source),
            "size": source.stat().st_size,
        })
    return {
        "$schema": "prototype-ordax.firmware-coverage/1",
        "status": "kernel-declarations-covered",
        "selected_firmware_count": len(files),
        "files": files,
        "firmware_downloaded_by_policy": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=("check",))
    parser.add_argument("--rootfs", type=Path, required=True)
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--log-prefix", default="ORDAX_FIRMWARE")
    args = parser.parse_args()
    try:
        result = coverage_receipt(args.rootfs, log_prefix=args.log_prefix)
        if args.receipt is not None:
            receipt = args.receipt.resolve()
            receipt.parent.mkdir(parents=True, exist_ok=True)
            receipt.write_text(json.dumps(result, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    except (FirmwareSelectionError, OSError, ValueError) as exc:
        print(f"ordax-firmware-policy: ERROR: {exc}", file=__import__("sys").stderr)
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
