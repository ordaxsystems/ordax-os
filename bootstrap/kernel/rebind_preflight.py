#!/usr/bin/env python3
"""Fail-closed, read-only kernel rebind preflight for the canonical OrdaX media.

The normal build and SHA256SUMS verifier remain the only build/byte owners.
This tool checks two independent complete kernel builds, signed-upstream
provenance and the existing Creator + A/B pins. It emits an INERT proposal.
It NEVER edits canonical pins, signs releases, publishes or writes physical media.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import re
import sys

import verify as kernel_verify

ROOT = Path(__file__).resolve().parents[2]
SHA40 = re.compile(r"[0-9a-f]{40}")
SHA64 = re.compile(r"[0-9a-f]{64}")


class RebindError(RuntimeError):
    pass


def _regular(path: Path, label: str) -> Path:
    if path.is_symlink() or not path.is_file():
        raise RebindError(f"{label} is missing, linked or not a regular file")
    return path


def _json(path: Path, label: str) -> dict:
    try:
        value = json.loads(_regular(path, label).read_text(encoding="utf-8"))
    except (OSError, ValueError, UnicodeError) as exc:
        raise RebindError(f"{label} is unreadable or malformed") from exc
    if not isinstance(value, dict):
        raise RebindError(f"{label} must be an object")
    return value


def _trusted_source(root: Path) -> tuple[dict, str, str]:
    source_path = root / "bootstrap/kernel/source.json"
    source = _json(source_path, "kernel source contract")
    if source.get("$schema") != "prototype-ordax.kernel-source/1":
        raise RebindError("unsupported kernel source schema")
    version = source.get("version")
    if not isinstance(version, str) or re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", version) is None:
        raise RebindError("invalid kernel version")
    if source.get("build", {}).get("pinned_environment_resolved") is not True:
        raise RebindError("kernel build environment is not pinned")
    signature = source.get("upstream_signature", {})
    if not isinstance(signature, dict) or signature.get("algorithm") != "openpgp-detached-tar":
        raise RebindError("kernel signed source required")
    fragment_rel = source.get("configuration", {}).get("fragment")
    if fragment_rel != "bootstrap/kernel/config/ordax.fragment":
        raise RebindError("unexpected noncanonical kernel fragment")
    fragment_path = _regular(root / fragment_rel, "kernel fragment")
    return source, kernel_verify.sha256_file(source_path), kernel_verify.sha256_file(fragment_path)


def _validated_build(
    folder: Path, source: dict, source_digest: str, fragment_digest: str,
    source_commit: str,
) -> dict[str, str]:
    try:
        summary = kernel_verify.verify_output(folder)
    except kernel_verify.VerificationError as exc:
        raise RebindError(f"invalid kernel candidate: {exc}") from exc
    provenance = _json(folder / "kernel-provenance.json", "kernel provenance")
    version = source["version"]
    names = {f"kernel-{version}.config", f"kernel-modules-{version}.tar", f"vmlinuz-{version}"}
    artifacts = provenance["artifacts"]
    if set(artifacts) != names or not all(isinstance(v, str) and SHA64.fullmatch(v) for v in artifacts.values()):
        raise RebindError("kernel candidate does not have the exact canonical artifact set")
    if provenance.get("source_commit") != source_commit or summary.get("source_commit") != source_commit:
        raise RebindError("kernel candidate source commit is not the reviewed exact SHA")
    if provenance.get("kernel_version") != version or summary.get("kernel_version") != version:
        raise RebindError("kernel version mismatch")
    if provenance.get("source_contract_sha256") != source_digest:
        raise RebindError("kernel source contract digest mismatch")
    if provenance.get("fragment_sha256") != fragment_digest:
        raise RebindError("kernel fragment digest mismatch")
    if provenance.get("upstream_archive_sha256") != source.get("archive_sha256"):
        raise RebindError("kernel upstream archive mismatch")
    if provenance.get("status") != "verified-build-environment":
        raise RebindError("unverified kernel build environment")
    env = provenance.get("build_environment")
    if not isinstance(env, dict) or env.get("immutable_environment_pinned") is not True:
        raise RebindError("kernel build environment was not pinned")
    receipt = provenance.get("upstream_authentication")
    if (
        not isinstance(receipt, dict)
        or receipt.get("status") != "verified"
        or receipt.get("kernel_version") != version
        or receipt.get("archive_sha256") != source["archive_sha256"]
        or receipt.get("source_contract_sha256") != source_digest
        or receipt.get("trusted_primary_fingerprint")
            != source["upstream_signature"].get("trusted_primary_fingerprint")
    ):
        raise RebindError("kernel upstream authentication receipt is absent or mismatched")
    if provenance.get("physical_artifact_authorized") is not False:
        raise RebindError("preflight cannot consume physically authorized kernel artifacts")
    if provenance.get("promotable_to_physical") is not False:
        raise RebindError("preflight cannot grant physical promotion")
    return artifacts


def _current_binding(root: Path, version: str) -> tuple[str, dict[str, str]]:
    media_path = root / "docs/contracts/minimal-bootstrap.json"
    update_path = root / "system/base-update/candidate.json"
    media = _json(media_path, "Creator media contract")
    update = _json(update_path, "A/B candidate contract")
    if (
        media.get("$schema") != "prototype-ordax.minimal-bootstrap/4"
        or media.get("status") != "canonical-bytes-resolved"
        or media.get("physical_write_allowed") is not False
        or media.get("all_artifacts_resolved") is not True
        or update.get("$schema") != "prototype-ordax.base-update-candidate/1"
    ):
        raise RebindError("canonical Creator or A/B contract invalid")
    groups = media.get("artifact_groups")
    if not isinstance(groups, list):
        raise RebindError("Creator artifact groups unavailable")
    kernels = [g for g in groups if isinstance(g, dict) and g.get("id") == "kernel"]
    initramfs = [g for g in groups if isinstance(g, dict) and g.get("id") == "initramfs"]
    if len(kernels) != 1 or len(initramfs) != 1:
        raise RebindError("Creator kernel/initramfs group is not unique")
    k = kernels[0].get("artifacts")
    init = initramfs[0].get("artifacts")
    if not isinstance(k, list) or len(k) != 1 or not isinstance(init, list) or len(init) != 1:
        raise RebindError("Creator kernel/initramfs inventory is ambiguous")
    entry, init_entry = k[0], init[0]
    if (
        entry.get("source_path") != f"bootstrap/kernel/vmlinuz-{version}"
        or entry.get("target_path") != "/ordax/vmlinuz"
        or entry.get("logical_owner") != "kernel"
        or kernels[0].get("resolved") is not True
        or initramfs[0].get("resolved") is not True
        or update.get("initramfs_sha256") != init_entry.get("sha256")
    ):
        raise RebindError("Creator media or initramfs A/B binding mismatch")
    old = entry.get("sha256")
    if not isinstance(old, str) or not SHA64.fullmatch(old) or update.get("kernel_sha256") != old:
        raise RebindError("Creator kernel and A/B kernel pins already disagree")
    return old, {
        "docs/contracts/minimal-bootstrap.json": kernel_verify.sha256_file(media_path),
        "system/base-update/candidate.json": kernel_verify.sha256_file(update_path),
    }


def plan(root: Path, first: Path, second: Path, source_commit: str) -> dict:
    if not isinstance(source_commit, str) or not SHA40.fullmatch(source_commit):
        raise RebindError("reviewed exact 40-hex source commit required")
    if first.is_symlink() or second.is_symlink() or first.resolve() == second.resolve():
        raise RebindError("two distinct unlinked kernel build roots are required")
    source, source_digest, fragment_digest = _trusted_source(root)
    first_artifacts = _validated_build(first, source, source_digest, fragment_digest, source_commit)
    second_artifacts = _validated_build(second, source, source_digest, fragment_digest, source_commit)
    if first_artifacts != second_artifacts:
        raise RebindError("independent kernel build digests differ")
    version = source["version"]
    for name in sorted(first_artifacts):
        a, b = first / name, second / name
        if os.path.samefile(a, b):
            raise RebindError("independent kernel build artifacts share an inode")
    old, current_contracts = _current_binding(root, version)
    latest = first_artifacts[f"vmlinuz-{version}"]
    return {
        "$schema": "ordax.kernel-rebind-preflight/1",
        "status": "candidate-needs-release-proofs" if latest != old else "no-change",
        "source_commit": source_commit,
        "source_contract_sha256": source_digest,
        "kernel_fragment_sha256": fragment_digest,
        "kernel_version": version,
        "matching_verified_artifact_bytes": True,
        "independent_build_process_attested": False,
        "candidate_artifacts_sha256": dict(sorted(first_artifacts.items())),
        "current_kernel_sha256": old,
        "candidate_kernel_sha256": latest,
        "current_binding_files_sha256": current_contracts,
        "proposed_binding_paths": [
            "docs/contracts/minimal-bootstrap.json",
            "system/base-update/candidate.json",
        ] if latest != old else [],
        "manual_hash_substitution_authorized": False,
        "signed_release_published": False,
        "physical_write_authorized": False,
        "remaining_release_gates": [
            "reviewed-exact-source-ci-attestation",
            "independent-build-process-and-pinned-environment-evidence",
            "byte-complete-creator-payload-with-exact-kernel",
            "signed-release-and-canonical-manifest-rebinding",
            "qemu-uefi-fallback-and-physical-proof",
        ] if latest != old else [],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--first", type=Path, required=True, help="first verified kernel build directory")
    parser.add_argument("--second", type=Path, required=True, help="independent repeat build directory")
    parser.add_argument("--source-commit", required=True, help="exact reviewed commit built twice")
    parser.add_argument("--repo-root", type=Path, default=ROOT)
    parser.add_argument("--out", type=Path, help="new JSON proposal; never overwrites an existing file")
    args = parser.parse_args()
    try:
        result = plan(args.repo_root, args.first, args.second, args.source_commit)
        payload = json.dumps(result, indent=2, sort_keys=True) + "\n"
        if args.out:
            fd = os.open(args.out, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as output:
                output.write(payload)
                output.flush()
                os.fsync(output.fileno())
        print(payload, end="")
        return 0
    except (RebindError, OSError, ValueError, TypeError) as exc:
        print(f"KERNEL_REBIND_PREFLIGHT=FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
