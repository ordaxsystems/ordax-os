#!/usr/bin/env python3
"""Prove an Independent Owner rootfs against the real Dev Channel consumer.

This is a compatibility proof only. It deliberately cannot publish, promote,
or authorize a physical/Stable artifact.
"""

from __future__ import annotations

import argparse
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import re
import stat
import sys

ROOT = Path(__file__).resolve().parents[2]
DEV_CHANNEL = ROOT / "system/services/base-update/dev_channel.py"
SCHEMA = "prototype-ordax.independent-dev-channel-compatibility/1"
PROVENANCE_SCHEMA = "prototype-ordax.independent-base-provenance/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class CompatibilityError(RuntimeError):
    pass


def _load_dev_channel():
    spec = spec_from_file_location("ordax_dev_channel_compatibility", DEV_CHANNEL)
    if spec is None or spec.loader is None:
        raise CompatibilityError("Dev Channel consumer cannot be loaded")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


consumer = _load_dev_channel()


def digest(path: Path) -> str:
    result = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def read_provenance(path: Path) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise CompatibilityError("Independent Base provenance is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise CompatibilityError("Independent Base provenance is invalid JSON") from exc
    if not isinstance(value, dict):
        raise CompatibilityError("Independent Base provenance must be an object")
    return value


def prove(
    *,
    rootfs: Path,
    provenance_path: Path,
    expected_commit: str,
    receipt_path: Path,
) -> dict:
    if SHA40_RE.fullmatch(expected_commit) is None:
        raise CompatibilityError("expected source commit must be lowercase 40-hex")

    provenance = read_provenance(provenance_path)
    if provenance.get("$schema") != PROVENANCE_SCHEMA:
        raise CompatibilityError("Independent Base provenance schema is unsupported")
    if provenance.get("status") != "candidate-build-only":
        raise CompatibilityError("Independent Base is not a candidate-only build")
    if provenance.get("source_commit") != expected_commit:
        raise CompatibilityError("Independent Base source commit differs from proof commit")
    if provenance.get("profile") != "owner-development":
        raise CompatibilityError("Dev Channel compatibility proof requires owner-development profile")
    if provenance.get("physical_artifact_authorized") is not False:
        raise CompatibilityError("Independent Base unexpectedly authorizes physical media")
    if provenance.get("signed_release_equivalence_proven") is not False:
        raise CompatibilityError("Independent Base unexpectedly claims signed release equivalence")

    metadata = rootfs.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise CompatibilityError("Independent rootfs.tar is missing or unsafe")
    if metadata.st_size <= 0 or metadata.st_size > consumer.MAX_ROOTFS_BYTES:
        raise CompatibilityError("Independent rootfs.tar exceeds Dev Channel size policy")

    actual_hash = digest(rootfs)
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict):
        raise CompatibilityError("Independent Base artifact map is invalid")
    expected_hash = artifacts.get("rootfs.tar")
    if not isinstance(expected_hash, str) or SHA256_RE.fullmatch(expected_hash) is None:
        raise CompatibilityError("Independent Base rootfs.tar provenance hash is invalid")
    if actual_hash != expected_hash:
        raise CompatibilityError("Independent rootfs.tar differs from authenticated provenance")

    try:
        members = consumer._validate_rootfs_archive(rootfs)
    except consumer.DevBaseChannelError as exc:
        raise CompatibilityError(f"Dev Channel rejected Independent rootfs.tar: {exc}") from exc

    receipt = {
        "$schema": SCHEMA,
        "status": "compatible-not-authorized",
        "source_commit": expected_commit,
        "profile": "owner-development",
        "rootfs_sha256": actual_hash,
        "rootfs_size": metadata.st_size,
        "archive_members": len(members),
        "symlink_members": sum(member.issym() for member in members),
        "hardlink_members": sum(member.islnk() for member in members),
        "consumer": "system/services/base-update/dev_channel.py",
        "consumer_validator": "_validate_rootfs_archive",
        "dev_channel_compatible": True,
        "publish_authorized": False,
        "physical_artifact_authorized": False,
        "stable_channel_authorized": False,
        "signed_release_equivalence_proven": False,
    }
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(
        json.dumps(receipt, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return receipt


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--rootfs", type=Path, required=True)
    parser.add_argument("--provenance", type=Path, required=True)
    parser.add_argument("--expected-commit", required=True)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = prove(
            rootfs=args.rootfs,
            provenance_path=args.provenance,
            expected_commit=args.expected_commit,
            receipt_path=args.receipt,
        )
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0
    except (CompatibilityError, OSError) as exc:
        print(f"independent-dev-channel-compatibility: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
