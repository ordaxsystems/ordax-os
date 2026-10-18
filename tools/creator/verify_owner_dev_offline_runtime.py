#!/usr/bin/env python3
"""Owner/Development only: stage and verify the existing immutable Surface EROFS.

The graphical producer remains bootstrap/surface-runtime/build.py. This consumer
does not define APK packages, replace Stable trust, or grant physical writes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import sys

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "bootstrap/surface-runtime/source.json"
MEDIA = ROOT / "docs/contracts/physical-media.json"
RELATIVE_IMAGE = Path("state/ordax/runtime/native-surface/offline/native-surface-runtime.erofs")
RELATIVE_PIN = Path("etc/ordax/owner-surface-runtime.sha256")
RELATIVE_PROVENANCE = RELATIVE_IMAGE.parent / "surface-runtime-provenance.json"
GIB = 1024 ** 3
MAX_OWNER_SEED_BYTES = 6 * GIB
HASH = re.compile(r"[0-9a-f]{64}\Z")


class OfflineRuntimeError(ValueError):
    pass


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def load(path: Path) -> dict:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise OfflineRuntimeError(f"invalid object: {path}")
    return value


def source_contract() -> dict:
    source = load(SOURCE)
    if (source.get("$schema") != "prototype-ordax.surface-runtime-source/1"
            or source.get("status") != "candidate-not-promotable"
            or source.get("first_boot_offline_required") is not True
            or source.get("network_package_install_during_stable_boot_allowed") is not False
            or source.get("artifact", {}).get("physical_artifact_authorized") is not False):
        raise OfflineRuntimeError("canonical offline Surface builder contract is not safe")
    return source


def dev_base(stage: Path) -> Path:
    base = stage / "ORDAX" / "dev-base"
    surface = base / "workspace/ordax/system/surface/bin/ordax-surface"
    if not surface.is_file() or surface.is_symlink():
        raise OfflineRuntimeError("Owner Dev seed lacks canonical Surface entrypoint")
    # The preverified EROFS handoff must be understood by the running Surface.
    code = surface.read_text(encoding="utf-8")
    if "VERIFIED_RUNTIME_MODE" not in code or "verified-erofs-overlay" not in code:
        raise OfflineRuntimeError("Surface does not support verified offline EROFS")
    return base


def stage_runtime(stage: Path, producer: Path) -> None:
    source = source_contract()
    base = dev_base(stage)
    provenance = load(producer / "surface-runtime-provenance.json")
    image = producer / source["artifact"]["name"]
    if (provenance.get("$schema") != "prototype-ordax.surface-runtime-provenance/1"
            or provenance.get("status") != "candidate-not-promotable"
            or provenance.get("runtime_id") != source["runtime_id"]
            or provenance.get("physical_artifact_authorized") is not False
            or provenance.get("physical_boot_connected") is not False):
        raise OfflineRuntimeError("Surface producer provenance is not a verified candidate")
    expected = provenance.get("image", {}).get("sha256")
    if not isinstance(expected, str) or not HASH.fullmatch(expected):
        raise OfflineRuntimeError("Surface producer digest is invalid")
    if image.is_symlink() or not image.is_file() or image.stat().st_size != provenance["image"]["size"]:
        raise OfflineRuntimeError("Surface producer artifact missing or size mismatch")
    if sha256(image) != expected:
        raise OfflineRuntimeError("Surface producer artifact SHA-256 mismatch")

    target = base / RELATIVE_IMAGE
    pin = base / RELATIVE_PIN
    receipt = base / RELATIVE_PROVENANCE
    if target.exists() or target.is_symlink() or pin.exists() or pin.is_symlink():
        raise OfflineRuntimeError("Owner Dev offline runtime already staged; refusing overwrite")
    target.parent.mkdir(parents=True, exist_ok=True)
    pin.parent.mkdir(parents=True, exist_ok=True)
    partial = target.with_name(target.name + ".partial")
    try:
        with image.open("rb") as source_stream, partial.open("xb") as target_stream:
            shutil.copyfileobj(source_stream, target_stream, 1024 * 1024)
        if sha256(partial) != expected:
            raise OfflineRuntimeError("staged Surface EROFS SHA-256 mismatch")
        partial.replace(target)
        receipt.write_text(json.dumps(provenance, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        # The pathname is fixed by the bootstrap root; no source-defined paths
        # or untrusted metadata become shell arguments during boot.
        pin.write_text(
            f"{expected}  /ordax/dev-base/{RELATIVE_IMAGE.as_posix()}\n",
            encoding="ascii",
        )
        verify(stage)
    except Exception:
        partial.unlink(missing_ok=True)
        pin.unlink(missing_ok=True)
        receipt.unlink(missing_ok=True)
        target.unlink(missing_ok=True)
        raise


def verify(stage: Path) -> str:
    source = source_contract()
    base = dev_base(stage)
    image = base / RELATIVE_IMAGE
    pin = base / RELATIVE_PIN
    receipt = base / RELATIVE_PROVENANCE
    for path in (image, pin, receipt):
        if path.is_symlink() or not path.is_file():
            raise OfflineRuntimeError(f"no verified offline graphical runtime: missing {path.name}")
    provenance = load(receipt)
    expected = provenance.get("image", {}).get("sha256")
    if (not isinstance(expected, str) or not HASH.fullmatch(expected)
            or provenance.get("runtime_id") != source["runtime_id"]
            or provenance.get("physical_artifact_authorized") is not False
            or provenance.get("physical_boot_connected") is not False
            or provenance.get("image", {}).get("name") != source["artifact"]["name"]
            or provenance.get("image", {}).get("size") != image.stat().st_size):
        raise OfflineRuntimeError("Owner offline Surface receipt differs from canonical producer")
    expected_pin = f"{expected}  /ordax/dev-base/{RELATIVE_IMAGE.as_posix()}\n"
    if pin.read_text(encoding="ascii") != expected_pin or sha256(image) != expected:
        raise OfflineRuntimeError("Owner offline Surface EROFS pin/digest mismatch")
    return source["runtime_id"]


def geometry(stage: Path, destination: Path) -> int:
    verify(stage)
    media = load(MEDIA)
    if media.get("$schema") != "prototype-ordax.physical-media/1" or media.get("physical_write_allowed") is not False:
        raise OfflineRuntimeError("physical-media source contract is invalid")
    total = 0
    for partition in ("ORDAX", "ORDAX-ESP"):
        root = stage / partition
        if not root.is_dir() or root.is_symlink():
            raise OfflineRuntimeError(f"staged partition missing: {partition}")
        for parent, dirs, files in os.walk(root, followlinks=False):
            for name in dirs + files:
                item = Path(parent) / name
                if item.is_symlink():
                    raise OfflineRuntimeError(f"staged media contains symlink: {item}")
                if item.is_file():
                    total += item.stat().st_size
    # Keep at least 1 GiB extra for ext4 metadata, first-run state and
    # transaction staging; only Owner has this larger disposable geometry.
    required = total * 5 // 4 + GIB
    size = max(2 * GIB, ((required + GIB - 1) // GIB) * GIB)
    if size > MAX_OWNER_SEED_BYTES:
        raise OfflineRuntimeError(
            f"Owner USB seed needs {size} bytes; exceeds 6-GiB 8-GB-media bound"
        )
    if destination.exists() or destination.is_symlink():
        raise OfflineRuntimeError("Owner disposable geometry destination already exists")
    media["disposable_proof"]["image_bytes"] = size
    media["scope"] = "owner-development-offline-graphical-proof-derived-from-physical-media"
    destination.write_text(json.dumps(media, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return size


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stage-root", required=True, type=Path)
    parser.add_argument("--producer-out", type=Path)
    parser.add_argument("--geometry-out", type=Path)
    args = parser.parse_args()
    try:
        if args.producer_out and args.geometry_out:
            raise OfflineRuntimeError("choose staging or geometry, not both")
        if args.producer_out:
            stage_runtime(args.stage_root, args.producer_out)
        if args.geometry_out:
            size = geometry(args.stage_root, args.geometry_out)
            print(f"OWNER_DEV_SEED_BYTES={size}")
        runtime_id = verify(args.stage_root)
    except (OfflineRuntimeError, OSError, UnicodeError, ValueError, KeyError) as exc:
        print(f"OWNER_DEV_OFFLINE_WELCOME_RELEASE_GATE=FAIL: {exc}", file=sys.stderr)
        return 1
    print(f"OWNER_DEV_OFFLINE_WELCOME_RELEASE_GATE=PASS runtime_id={runtime_id}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
