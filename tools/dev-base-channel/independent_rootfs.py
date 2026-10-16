#!/usr/bin/env python3
"""Shared Independent Owner rootfs validation for the Development Base channel."""

from __future__ import annotations

import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import re
import stat


ROOT = Path(__file__).resolve().parents[2]
DEV_CHANNEL = ROOT / "system/services/base-update/dev_channel.py"
PROVENANCE_SCHEMA = "prototype-ordax.independent-base-provenance/1"
SHA40_RE = re.compile(r"^[0-9a-f]{40}$")
SHA256_RE = re.compile(r"^[0-9a-f]{64}$")


class IndependentRootfsError(RuntimeError):
    pass


def _load_dev_channel():
    spec = spec_from_file_location("ordax_dev_channel_rootfs_policy", DEV_CHANNEL)
    if spec is None or spec.loader is None:
        raise IndependentRootfsError("Dev Channel consumer cannot be loaded")
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


def read_json(path: Path, label: str) -> dict:
    if path.is_symlink() or not path.is_file() or path.stat().st_size > 1024 * 1024:
        raise IndependentRootfsError(f"{label} is missing or unsafe")
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        raise IndependentRootfsError(f"{label} is invalid JSON") from exc
    if not isinstance(value, dict):
        raise IndependentRootfsError(f"{label} must be an object")
    return value


def validate(
    *,
    rootfs: Path,
    provenance_path: Path,
    expected_commit: str,
) -> dict:
    if SHA40_RE.fullmatch(expected_commit) is None:
        raise IndependentRootfsError("expected source commit must be lowercase 40-hex")

    provenance = read_json(provenance_path, "Independent Base provenance")
    if provenance.get("$schema") != PROVENANCE_SCHEMA:
        raise IndependentRootfsError("Independent Base provenance schema is unsupported")
    if provenance.get("status") != "candidate-build-only":
        raise IndependentRootfsError("Independent Base is not a candidate-only build")
    if provenance.get("source_commit") != expected_commit:
        raise IndependentRootfsError("Independent Base source commit differs from requested commit")
    if provenance.get("profile") != "owner-development":
        raise IndependentRootfsError("Development Base requires owner-development profile")
    if provenance.get("owner_development_capabilities_verified") is not True:
        raise IndependentRootfsError("Owner/Development capability proof is missing")
    if provenance.get("physical_artifact_authorized") is not False:
        raise IndependentRootfsError("Independent Base unexpectedly authorizes physical media")
    if provenance.get("signed_release_equivalence_proven") is not False:
        raise IndependentRootfsError(
            "Independent Base unexpectedly claims signed release equivalence"
        )

    metadata = rootfs.lstat()
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISREG(metadata.st_mode):
        raise IndependentRootfsError("Independent rootfs.tar is missing or unsafe")
    if metadata.st_size <= 0 or metadata.st_size > consumer.MAX_ROOTFS_BYTES:
        raise IndependentRootfsError("Independent rootfs.tar exceeds Dev Channel size policy")

    actual_hash = digest(rootfs)
    artifacts = provenance.get("artifacts")
    if not isinstance(artifacts, dict):
        raise IndependentRootfsError("Independent Base artifact map is invalid")
    expected_hash = artifacts.get("rootfs.tar")
    if not isinstance(expected_hash, str) or SHA256_RE.fullmatch(expected_hash) is None:
        raise IndependentRootfsError("Independent Base rootfs.tar provenance hash is invalid")
    if actual_hash != expected_hash:
        raise IndependentRootfsError(
            "Independent rootfs.tar differs from authenticated provenance"
        )

    try:
        members = consumer._validate_rootfs_archive(rootfs)
    except consumer.DevBaseChannelError as exc:
        raise IndependentRootfsError(
            f"Dev Channel rejected Independent rootfs.tar: {exc}"
        ) from exc

    return {
        "provenance": provenance,
        "rootfs_sha256": actual_hash,
        "rootfs_size": metadata.st_size,
        "members": members,
    }
