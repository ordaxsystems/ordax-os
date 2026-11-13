#!/usr/bin/env python3
"""Prove an Independent Owner rootfs against the real Dev Channel consumer.

This is a compatibility proof only. It deliberately cannot publish, promote,
or authorize a physical/Stable artifact.
"""

from __future__ import annotations

import argparse
from importlib.util import module_from_spec, spec_from_file_location
import json
from pathlib import Path
import sys


HERE = Path(__file__).resolve().parent
POLICY = HERE / "independent_rootfs.py"
SCHEMA = "prototype-ordax.independent-dev-channel-compatibility/1"


def _load_policy():
    spec = spec_from_file_location("ordax_independent_rootfs_compatibility", POLICY)
    if spec is None or spec.loader is None:
        raise RuntimeError("Independent rootfs policy cannot be loaded")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


policy = _load_policy()
consumer = policy.consumer
CompatibilityError = policy.IndependentRootfsError


def prove(
    *,
    rootfs: Path,
    provenance_path: Path,
    expected_commit: str,
    receipt_path: Path,
    reuse_receipt: Path | None = None,
) -> dict:
    validated = policy.validate(
        rootfs=rootfs,
        provenance_path=provenance_path,
        expected_commit=expected_commit,
        reuse_receipt=reuse_receipt,
    )
    members = validated["members"]
    receipt = {
        "$schema": SCHEMA,
        "status": "compatible-not-authorized",
        "source_commit": expected_commit,
        "build_source_commit": validated["provenance"]["source_commit"],
        "rootfs_reused": validated["provenance"]["source_commit"] != expected_commit,
        "profile": "owner-development",
        "rootfs_sha256": validated["rootfs_sha256"],
        "rootfs_size": validated["rootfs_size"],
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
    parser.add_argument("--reuse-receipt", type=Path)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = prove(
            rootfs=args.rootfs,
            provenance_path=args.provenance,
            expected_commit=args.expected_commit,
            receipt_path=args.receipt,
            reuse_receipt=args.reuse_receipt,
        )
        print(json.dumps(receipt, indent=2, sort_keys=True))
        return 0
    except (CompatibilityError, OSError) as exc:
        print(f"independent-dev-channel-compatibility: ERROR: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
