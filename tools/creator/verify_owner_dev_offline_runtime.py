#!/usr/bin/env python3
"""Owner/Development only: stage and verify the existing immutable Surface EROFS.

The graphical producer is the verified independent Buildroot Surface. This
consumer does not install packages, replace Stable trust or grant physical writes.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "bootstrap/independent-surface-runtime/source.json"
MEDIA = ROOT / "docs/contracts/physical-media.json"
RELATIVE_IMAGE = Path("state/ordax/runtime/native-surface/offline/native-surface-runtime.erofs")
RELATIVE_PIN = Path("etc/ordax/owner-surface-runtime.sha256")
RELATIVE_PROVENANCE = RELATIVE_IMAGE.parent / "surface-runtime-provenance.json"
RELATIVE_BINDING = RELATIVE_IMAGE.parent / "surface-runtime-consumer-binding.json"
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
    if (source.get("$schema") != "prototype-ordax.independent-surface-runtime-source/1"
            or source.get("status") != "experimental-not-promotable"
            or source.get("first_boot_offline_required") is not True
            or source.get("network_package_install_during_boot_allowed") is not False
            or source.get("package_manager_in_runtime_allowed") is not False
            or source.get("libc") != "musl"
            or source.get("buildroot_source_contract") != "bootstrap/independent-base/source.json"
            or source.get("artifact", {}).get("physical_artifact_authorized") is not False
            or source.get("artifact", {}).get("stable_promotion_authorized") is not False):
        raise OfflineRuntimeError("canonical Alpine-free Surface builder contract is not safe")
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



def _cache_module():
    """Use the single independent producer verifier; no second hash policy."""
    source = ROOT / "tools/ci/independent_surface_component_cache.py"
    spec = importlib.util.spec_from_file_location("ordax_owner_verified_surface_cache", source)
    if spec is None or spec.loader is None:
        raise OfflineRuntimeError("canonical Surface cache verifier unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _verified_reuse_binding(producer: Path, expected_commit: str) -> dict:
    if producer.is_symlink() or not producer.is_dir():
        raise OfflineRuntimeError("Surface cache producer path is unsafe")
    cache = _cache_module()
    try:
        with tempfile.TemporaryDirectory(prefix="ordax-owner-cache-") as directory:
            proof = cache.verify(
                producer, expected_commit, Path(directory) / "proof.json",
                cache_hit=True, consumer=True, root=ROOT,
            )
    except (cache.CacheError, OSError, ValueError, KeyError) as exc:
        raise OfflineRuntimeError(f"cross-commit Surface cache was not verified: {exc}") from exc
    if proof["consumer_verification"] is not True or proof["provenance_rewritten"] is not False:
        raise OfflineRuntimeError("cross-commit Surface provenance was altered")
    return {
        "$schema": "prototype-ordax.owner-surface-consumer-binding/1",
        "build_source_commit": proof["build_source_commit"],
        "integration_source_commit": proof["integration_source_commit"],
        "input_fingerprint": proof["input_fingerprint"],
        "execution_environment": proof["execution_environment"],
        "image_sha256": proof["artifacts"]["native-surface-runtime-buildroot.erofs"]["sha256"],
        "provenance_sha256": proof["artifacts"]["provenance.json"]["sha256"],
        "verified_consumer": True,
        "provenance_rewritten": False,
    }


def _verify_reuse_binding(base: Path, provenance: dict, expected_commit: str, image: Path) -> None:
    receipt = base / RELATIVE_BINDING
    build_commit = provenance.get("source_commit")
    if build_commit == expected_commit:
        if receipt.exists() or receipt.is_symlink():
            raise OfflineRuntimeError("unexpected Surface cross-commit binding")
        return
    if receipt.is_symlink() or not receipt.is_file():
        raise OfflineRuntimeError("cross-commit Surface is missing verified consumer binding")
    binding = load(receipt)
    if (binding.get("$schema") != "prototype-ordax.owner-surface-consumer-binding/1"
            or binding.get("build_source_commit") != build_commit
            or binding.get("integration_source_commit") != expected_commit
            or binding.get("verified_consumer") is not True
            or binding.get("provenance_rewritten") is not False
            or binding.get("image_sha256") != sha256(image)
            or binding.get("provenance_sha256") != sha256(base / RELATIVE_PROVENANCE)):
        raise OfflineRuntimeError("Surface consumer binding does not match immutable producer")
    cache = _cache_module()
    try:
        current_fingerprint = cache.fingerprint(
            ROOT, build_environment=binding.get("execution_environment", ""),
        )
    except (ValueError, OSError, cache.CacheError) as exc:
        raise OfflineRuntimeError(f"cannot validate Surface consumer inputs: {exc}") from exc
    if binding.get("input_fingerprint") != current_fingerprint:
        raise OfflineRuntimeError("Surface consumer source fingerprint changed")


def stage_runtime(stage: Path, producer: Path) -> None:
    source = source_contract()
    base = dev_base(stage)
    provenance = load(producer / "provenance.json")
    image = producer / source["artifact"]["name"]
    commit_file = base / "state/ordax/current-commit"
    if commit_file.is_symlink() or not commit_file.is_file():
        raise OfflineRuntimeError("Owner source identity marker is missing")
    expected_commit = commit_file.read_text(encoding="ascii").strip()
    if (not re.fullmatch(r"[0-9a-f]{40}", expected_commit)
            or provenance.get("$schema") != "prototype-ordax.independent-surface-runtime-provenance/1"
            or provenance.get("status") != "experimental-not-promotable"
            or not re.fullmatch(r"[0-9a-f]{40}", str(provenance.get("source_commit", "")))
            or provenance.get("libc") != "musl"
            or provenance.get("buildroot", {}).get("source_contract") != source["buildroot_source_contract"]
            or provenance.get("package_manager_present") is not False
            or provenance.get("alpine_present") is not False
            or provenance.get("runtime_inventory", {}).get("apk_runtime_absent") is not True
            or provenance.get("physical_artifact_authorized") is not False
            or provenance.get("stable_promotion_authorized") is not False):
        raise OfflineRuntimeError("Surface producer provenance is not a verified Alpine-free candidate")
    expected = provenance.get("image", {}).get("sha256")
    if not isinstance(expected, str) or not HASH.fullmatch(expected):
        raise OfflineRuntimeError("Surface producer digest is invalid")
    if image.is_symlink() or not image.is_file() or image.stat().st_size != provenance["image"]["size"]:
        raise OfflineRuntimeError("Surface producer artifact missing or size mismatch")
    if sha256(image) != expected:
        raise OfflineRuntimeError("Surface producer artifact SHA-256 mismatch")

    cross_commit_binding = (
        _verified_reuse_binding(producer, expected_commit)
        if provenance["source_commit"] != expected_commit else None
    )

    target = base / RELATIVE_IMAGE
    pin = base / RELATIVE_PIN
    receipt = base / RELATIVE_PROVENANCE
    binding_file = base / RELATIVE_BINDING
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
        # Preserve producer provenance byte-for-byte; the reuse binding pins its original digest.
        shutil.copyfile(producer / "provenance.json", receipt)
        if cross_commit_binding is not None:
            binding_file.write_text(
                json.dumps(cross_commit_binding, indent=2, sort_keys=True) + "\n", encoding="utf-8"
            )
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
        binding_file.unlink(missing_ok=True)
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
    commit_file = base / "state/ordax/current-commit"
    if commit_file.is_symlink() or not commit_file.is_file():
        raise OfflineRuntimeError("Owner source commit receipt is unavailable")
    expected_commit = commit_file.read_text(encoding="ascii").strip()
    if (not isinstance(expected, str) or not HASH.fullmatch(expected)
            or not re.fullmatch(r"[0-9a-f]{40}", expected_commit)
            or provenance.get("$schema") != "prototype-ordax.independent-surface-runtime-provenance/1"
            or provenance.get("status") != "experimental-not-promotable"
            or not re.fullmatch(r"[0-9a-f]{40}", str(provenance.get("source_commit", "")))
            or provenance.get("libc") != "musl"
            or provenance.get("buildroot", {}).get("source_contract") != source["buildroot_source_contract"]
            or provenance.get("package_manager_present") is not False
            or provenance.get("alpine_present") is not False
            or provenance.get("runtime_inventory", {}).get("apk_runtime_absent") is not True
            or provenance.get("physical_artifact_authorized") is not False
            or provenance.get("stable_promotion_authorized") is not False
            or provenance.get("image", {}).get("name") != source["artifact"]["name"]
            or provenance.get("image", {}).get("size") != image.stat().st_size):
        raise OfflineRuntimeError("Owner offline Surface receipt differs from Alpine-free producer")
    expected_pin = f"{expected}  /ordax/dev-base/{RELATIVE_IMAGE.as_posix()}\n"
    if pin.read_text(encoding="ascii") != expected_pin or sha256(image) != expected:
        raise OfflineRuntimeError("Owner offline Surface EROFS pin/digest mismatch")
    _verify_reuse_binding(base, provenance, expected_commit, image)
    # The full offline producer is fsck/label-verified in CI. Here the separate
    # Owner consumer additionally rejects non-EROFS objects before publication.
    with image.open("rb") as stream:
        stream.seek(1024)
        if stream.read(4) != bytes.fromhex("e2e1f5e0"):
            raise OfflineRuntimeError("Owner offline Surface image is not EROFS")
    return f"{source['build_profile']}@{expected_commit[:12]}"


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
