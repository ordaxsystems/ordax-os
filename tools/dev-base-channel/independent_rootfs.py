#!/usr/bin/env python3
"""Shared Independent Owner rootfs validation for the Development Base channel."""

from __future__ import annotations

import argparse
import hashlib
from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import re
import shutil
import stat
import sys
import tarfile
import tempfile


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
    reuse_receipt: Path | None = None,
) -> dict:
    if SHA40_RE.fullmatch(expected_commit) is None:
        raise IndependentRootfsError("expected source commit must be lowercase 40-hex")

    provenance = read_json(provenance_path, "Independent Base provenance")
    if provenance.get("$schema") != PROVENANCE_SCHEMA:
        raise IndependentRootfsError("Independent Base provenance schema is unsupported")
    if provenance.get("status") != "candidate-build-only":
        raise IndependentRootfsError("Independent Base is not a candidate-only build")
    producer_commit = provenance.get("source_commit")
    if producer_commit != expected_commit:
        # A new HEAD may consume identical immutable Buildroot bytes. Accept
        # this only after the canonical cache verifier emits a per-HEAD receipt,
        # never by rewriting the original provenance or relaxing SHA checks.
        if reuse_receipt is None:
            raise IndependentRootfsError("Independent Base source commit differs from requested commit")
        report = read_json(reuse_receipt, "Owner base integration receipt")
        artifact_records = report.get("artifacts")
        if (report.get("$schema") != "prototype-ordax.portable-component-reuse/1"
                or report.get("status") != "verified"
                or report.get("component") != "independent-base-owner"
                or report.get("reused") is not True
                or report.get("provenance_rewritten") is not False
                or report.get("build_source_commit") != producer_commit
                or report.get("integration_source_commit") != expected_commit
                or not isinstance(artifact_records, dict)):
            raise IndependentRootfsError("Owner base reuse receipt does not bind both source commits")
        for name, expected_path in (
            ("provenance.json", provenance_path),
            ("rootfs.tar", rootfs),
        ):
            actual_record = artifact_records.get(name)
            if (not isinstance(actual_record, dict)
                    or actual_record.get("sha256") != digest(expected_path)
                    or actual_record.get("size") != expected_path.stat().st_size):
                raise IndependentRootfsError(f"Owner base reuse receipt rejects {name}")
        # Receipts are not credentials. Re-run the canonical cache checker
        # against the current checkout so a forged JSON receipt cannot
        # authorize a different rootfs or source revision.
        cache_path = ROOT / "tools/ci/portable_component_cache.py"
        spec = spec_from_file_location("ordax_owner_rootfs_cache_policy", cache_path)
        if spec is None or spec.loader is None:
            raise IndependentRootfsError("canonical Owner cache verifier unavailable")
        cache = module_from_spec(spec)
        spec.loader.exec_module(cache)
        try:
            verified = cache.verify_component(
                "independent-base-owner", provenance_path.parent,
                expected_commit, reuse_receipt, cache_hit=True,
            )
        except (cache.CacheError, OSError) as exc:
            raise IndependentRootfsError(
                f"Owner base integration receipt failed canonical verification: {exc}"
            ) from exc
        if (verified.get("build_source_commit") != producer_commit
                or verified.get("integration_source_commit") != expected_commit
                or verified.get("provenance_rewritten") is not False):
            raise IndependentRootfsError("Owner base reuse identity changed during verification")
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


def _require_real_directory(path: Path, label: str) -> None:
    try:
        metadata = path.lstat()
    except OSError as exc:
        raise IndependentRootfsError(f"{label} is missing or unsafe") from exc
    if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
        raise IndependentRootfsError(f"{label} is missing or unsafe")


def _verify_seed_tree(path: Path) -> None:
    try:
        consumer._verify_materialized_tree(path)
    except consumer.DevBaseChannelError as exc:
        raise IndependentRootfsError(
            f"materialized Independent rootfs is unsafe: {exc}"
        ) from exc

    for relative in consumer.REQUIRED_ROOTFS_PATHS:
        target = path / relative
        try:
            metadata = target.stat()
        except OSError as exc:
            raise IndependentRootfsError(
                f"materialized Independent rootfs is missing required file: {relative}"
            ) from exc
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_mode & 0o111 == 0:
            raise IndependentRootfsError(
                f"materialized Independent rootfs has unsafe required file: {relative}"
            )

    for relative in consumer.REQUIRED_ROOTFS_DIRS:
        target = path / relative
        try:
            metadata = target.lstat()
        except OSError as exc:
            raise IndependentRootfsError(
                f"materialized Independent rootfs is missing required directory: {relative}"
            ) from exc
        if stat.S_ISLNK(metadata.st_mode) or not stat.S_ISDIR(metadata.st_mode):
            raise IndependentRootfsError(
                f"materialized Independent rootfs has unsafe required directory: {relative}"
            )


def materialize(
    *,
    rootfs: Path,
    provenance_path: Path,
    expected_commit: str,
    destination: Path,
    reuse_receipt: Path | None = None,
) -> dict:
    """Atomically materialize an authenticated Owner rootfs with safe symlinks preserved."""
    validated = validate(
        rootfs=rootfs,
        provenance_path=provenance_path,
        expected_commit=expected_commit,
        reuse_receipt=reuse_receipt,
    )
    parent = destination.parent
    _require_real_directory(parent, "Independent rootfs destination parent")
    if destination.exists() or destination.is_symlink():
        raise IndependentRootfsError("Independent rootfs destination must not exist")

    temporary = Path(
        tempfile.mkdtemp(prefix=f".{destination.name}.", dir=str(parent))
    )
    published = False
    try:
        with tarfile.open(rootfs, "r:") as archive:
            archive.extractall(
                temporary,
                members=validated["members"],
                filter="data",
            )
        _verify_seed_tree(temporary)
        # mkdtemp creates the staging root as 0700. The installed rootfs
        # must be traversable by the unprivileged Creator build user, while
        # atomic publication and verified inner file modes remain unchanged.
        os.chmod(temporary, 0o755)
        os.replace(temporary, destination)
        published = True
        return {
            "destination": destination,
            "rootfs_sha256": validated["rootfs_sha256"],
            "rootfs_size": validated["rootfs_size"],
            "members": validated["members"],
            "provenance": validated["provenance"],
        }
    except (tarfile.TarError, OSError) as exc:
        raise IndependentRootfsError(
            f"Independent rootfs materialization failed: {exc}"
        ) from exc
    finally:
        if not published and temporary.exists():
            shutil.rmtree(temporary, ignore_errors=True)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)
    materialize_parser = subparsers.add_parser(
        "materialize",
        help="materialize an authenticated owner-development rootfs.tar",
    )
    materialize_parser.add_argument("--rootfs", required=True, type=Path)
    materialize_parser.add_argument("--provenance", required=True, type=Path)
    materialize_parser.add_argument("--expected-commit", required=True)
    materialize_parser.add_argument("--reuse-receipt", type=Path)
    materialize_parser.add_argument("--destination", required=True, type=Path)
    args = parser.parse_args()

    try:
        result = materialize(
            rootfs=args.rootfs,
            provenance_path=args.provenance,
            expected_commit=args.expected_commit,
            destination=args.destination,
            reuse_receipt=args.reuse_receipt,
        )
    except (IndependentRootfsError, OSError) as exc:
        print(f"independent-rootfs: ERROR: {exc}", file=sys.stderr)
        return 1

    print(f"INDEPENDENT_ROOTFS_MATERIALIZED={result['destination']}")
    print(f"INDEPENDENT_ROOTFS_SHA256={result['rootfs_sha256']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
