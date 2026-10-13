#!/usr/bin/env python3
"""Verify kernel artifact digests against the pinned reference observation."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

SCHEMA = "prototype-ordax.kernel-build-environment/1"
REPORT_SCHEMA = "prototype-ordax.kernel-reproducibility-verification/1"
ROOT = Path(__file__).resolve().parents[2]
DEFAULT_SOURCE_CONTRACT = ROOT / "bootstrap/kernel/source.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def fail(message: str) -> "None":
    raise SystemExit(f"KERNEL_REPRODUCIBILITY=FAIL\nREASON={message}")


def current_artifact_names(kernel_source_contract: Path) -> tuple[str, list[str]]:
    """Compare current kernel bytes by the active source pin, not old evidence."""
    try:
        if kernel_source_contract.is_symlink() or not kernel_source_contract.is_file():
            fail("kernel source contract is missing or unsafe")
        source = json.loads(kernel_source_contract.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        fail(f"invalid canonical kernel source contract: {exc}")
    version = source.get("version")
    if (
        source.get("$schema") != "prototype-ordax.kernel-source/1"
        or not isinstance(version, str)
        or re.fullmatch(r"[0-9]+[.][0-9]+[.][0-9]+", version) is None
    ):
        fail("invalid canonical kernel source schema or version")
    return version, [
        f"kernel-{version}.config",
        f"kernel-modules-{version}.tar",
        f"vmlinuz-{version}",
    ]


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("contract", type=Path)
    parser.add_argument("artifact_dir", type=Path)
    parser.add_argument("--repeat-artifact-dir", type=Path, required=True)
    parser.add_argument("--kernel-source-contract", type=Path, default=DEFAULT_SOURCE_CONTRACT)
    parser.add_argument("--ca-bundle-sha-file", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()

    contract = json.loads(args.contract.read_text(encoding="utf-8"))
    if contract.get("$schema") != SCHEMA:
        fail("unexpected contract schema")

    reference = contract.get("reference_observation")
    if not reference:
        fail("reference observation is missing")

    reference_artifacts = reference.get("artifacts", {})
    if not reference_artifacts:
        fail("reference artifact inventory is missing")

    current_version, current_names = current_artifact_names(args.kernel_source_contract)
    observed_artifacts = {}
    repeat_artifacts = {}
    mismatches = {}
    for name in sorted(current_names):
        current_path = args.artifact_dir / name
        repeat_path = args.repeat_artifact_dir / name
        if not current_path.is_file():
            fail(f"missing current artifact: {name}")
        if not repeat_path.is_file():
            fail(f"missing repeat artifact: {name}")
        current_digest = sha256(current_path)
        repeat_digest = sha256(repeat_path)
        observed_artifacts[name] = current_digest
        repeat_artifacts[name] = repeat_digest
        if current_digest != repeat_digest:
            mismatches[name] = {
                "current": current_digest,
                "repeat": repeat_digest,
            }

    ca_line = args.ca_bundle_sha_file.read_text(encoding="utf-8").strip()
    if not ca_line:
        fail("CA bundle digest observation is empty")
    observed_ca = ca_line.split()[0]
    expected_ca = reference.get("ca_bundle_sha256")
    if observed_ca != expected_ca:
        mismatches["ca_bundle_sha256"] = {"expected": expected_ca, "observed": observed_ca}

    if mismatches:
        fail("current-source repeat digest mismatch: " + json.dumps(mismatches, sort_keys=True))

    report = {
        "$schema": REPORT_SCHEMA,
        "status": "pass",
        "reference_environment_source_commit": reference["source_commit"],
        "kernel_version": current_version,
        "current_source_artifact_names": sorted(current_names),
        "historical_reference_artifact_names": sorted(reference_artifacts),
        "artifact_digests": observed_artifacts,
        "repeat_artifact_digests": repeat_artifacts,
        "ca_bundle_sha256": observed_ca,
        "repeat_build_digest_match": True,
        "promotable_environment_gate": bool(
            contract["proof"].get("first_observation_complete")
            and contract["proof"].get("package_versions_pinned")
        ),
    }

    if args.out:
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    print("KERNEL_REPRODUCIBILITY=PASS")
    print("REPEAT_BUILD_DIGEST_MATCH=YES")
    for name, digest in sorted(observed_artifacts.items()):
        print(f"SHA256[{name}]={digest}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
