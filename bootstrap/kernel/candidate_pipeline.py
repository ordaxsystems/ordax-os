#!/usr/bin/env python3
"""Candidate lane for future LTS kernels: one manifest, no per-version CI logic.

Candidate selection is a pointer to a signed source contract, not an alternate
source of version/hash/trust truth. No command in this module promotes releases,
changes the active kernel, or authorizes writes to physical media.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
SELECTOR = ROOT / "bootstrap/kernel/candidates/proposal.json"
CANONICAL = ROOT / "bootstrap/kernel/source.json"
SELECTION_SCHEMA = "prototype-ordax.kernel-candidate-selection/1"
PROVENANCE_SCHEMA = "prototype-ordax.kernel-provenance/1"
RECEIPT_SCHEMA = "prototype-ordax.kernel-upstream-signature-receipt/1"
HEX64 = re.compile(r"[0-9a-f]{64}")
RELEASE = re.compile(r"[0-9]+[.][0-9]+[.][0-9]+")
SOURCE_PATH = re.compile(r"bootstrap/kernel/candidates/([0-9]+[.][0-9]+[.][0-9]+)[.]json")


class CandidateError(ValueError):
    pass


def read_json(path: Path) -> dict:
    if path.is_symlink() or not path.is_file():
        raise CandidateError(f"missing or unsafe contract: {path}")
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise CandidateError(f"invalid JSON contract: {path}") from exc
    if not isinstance(data, dict):
        raise CandidateError("contract must be an object")
    return data


def version_tuple(value: object) -> tuple[int, int, int]:
    if not isinstance(value, str) or RELEASE.fullmatch(value) is None:
        raise CandidateError("kernel version must use N.N.N with no suffix")
    return tuple(map(int, value.split(".")))


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def select_candidate(root: Path = ROOT, selector: Path | None = None, *, require_newer: bool = True) -> tuple[Path, dict]:
    root = root.resolve()
    selection = read_json(selector if selector is not None else root / "bootstrap/kernel/candidates/proposal.json")
    if selection.get("$schema") != SELECTION_SCHEMA or set(selection) != {"$schema", "source_contract"}:
        raise CandidateError("unexpected kernel candidate selector schema or fields")
    relative = selection.get("source_contract")
    match = SOURCE_PATH.fullmatch(relative) if isinstance(relative, str) else None
    if match is None:
        raise CandidateError("candidate selector must refer to a versioned contract under candidates/")
    source_path = root / relative
    candidate = read_json(source_path)
    active = read_json(root / "bootstrap/kernel/source.json")
    v = version_tuple(candidate.get("version"))
    current = version_tuple(active.get("version"))
    if candidate.get("$schema") != "prototype-ordax.kernel-source/1":
        raise CandidateError("candidate is not a canonical kernel source contract")
    if active.get("$schema") != "prototype-ordax.kernel-source/1":
        raise CandidateError("active source schema is invalid")
    if candidate["version"] != match.group(1):
        raise CandidateError("candidate filename and source release disagree")
    if v[:2] != current[:2] or v < current or (require_newer and v == current):
        raise CandidateError("candidate must not downgrade or cross the active LTS line")
    expected_url = f"https://cdn.kernel.org/pub/linux/kernel/v{v[0]}.x/linux-{candidate['version']}.tar.xz"
    if candidate.get("archive_url") != expected_url or candidate.get("signature_url") != expected_url.removesuffix(".xz").removesuffix(".tar") + ".tar.sign":
        raise CandidateError("candidate upstream URLs are not canonical kernel.org endpoints")
    if not isinstance(candidate.get("archive_sha256"), str) or HEX64.fullmatch(candidate["archive_sha256"]) is None:
        raise CandidateError("candidate needs exact SHA-256 bytes")
    signature = candidate.get("upstream_signature")
    if not isinstance(signature, dict) or signature.get("algorithm") != "openpgp-detached-tar":
        raise CandidateError("new kernel candidate requires detached OpenPGP authentication")
    if signature.get("trusted_primary_fingerprint") is None or not re.fullmatch(
        r"[0-9A-F]{40}", signature["trusted_primary_fingerprint"]
    ):
        raise CandidateError("kernel signer primary fingerprint must be pinned")
    if candidate.get("build", {}).get("physical_artifact_authorized") is not False:
        raise CandidateError("staged kernel must not authorize physical writes")
    if candidate["build"].get("pinned_environment_resolved") is not False:
        raise CandidateError("staged environment cannot assert independent repeat proof")
    return source_path, candidate


def verify_candidate(out: Path, *, root: Path = ROOT, source_commit: str) -> dict:
    path, source = select_candidate(root)
    if not re.fullmatch(r"[0-9a-f]{40}", source_commit):
        raise CandidateError("exact source commit is required")
    proof = read_json(out / "kernel-provenance.json")
    authentication = proof.get("upstream_authentication")
    if (
        proof.get("$schema") != PROVENANCE_SCHEMA
        or proof.get("source_commit") != source_commit
        or proof.get("kernel_version") != source["version"]
        or proof.get("source_contract_sha256") != sha256_file(path)
        or proof.get("upstream_archive_sha256") != source["archive_sha256"]
        or proof.get("upstream_archive_url") != source["archive_url"]
        or proof.get("physical_artifact_authorized") is not False
        or proof.get("promotable_to_physical") is not False
        or not isinstance(authentication, dict)
        or authentication.get("$schema") != RECEIPT_SCHEMA
        or authentication.get("status") != "verified"
        or authentication.get("kernel_version") != source["version"]
        or authentication.get("archive_sha256") != source["archive_sha256"]
        or authentication.get("source_contract_sha256") != sha256_file(path)
        or authentication.get("trusted_primary_fingerprint")
        != source["upstream_signature"]["trusted_primary_fingerprint"]
        or authentication.get("physical_write_authorized") is not False
    ):
        raise CandidateError("kernel source or OpenPGP provenance disagrees with selected candidate")
    names = {
        f"vmlinuz-{source['version']}",
        f"kernel-modules-{source['version']}.tar",
        f"kernel-{source['version']}.config",
    }
    artifacts = proof.get("artifacts")
    if not isinstance(artifacts, dict) or set(artifacts) != names:
        raise CandidateError("candidate artifact inventory does not match selected release")
    for name in sorted(names):
        artifact = out / name
        if artifact.is_symlink() or not artifact.is_file():
            raise CandidateError("missing or unsafe staged artifact: " + name)
        if sha256_file(artifact) != artifacts[name]:
            raise CandidateError("staged artifact SHA-256 differs: " + name)
    return {
        "$schema": "prototype-ordax.kernel-candidate-check/1",
        "status": "verified",
        "kernel_version": source["version"],
        "source_commit": source_commit,
        "source_contract": str(path.relative_to(root.resolve())),
        "upstream_signature_verified": True,
        "artifact_digests": artifacts,
        "physical_write_authorized": False,
        "stable_mvp_promoted": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Reusable OrdaX LTS kernel candidate CI owner")
    sub = parser.add_subparsers(dest="command", required=True)
    select = sub.add_parser("select", help="emit the exact reviewed source contract for CI")
    select.add_argument("--github-output", type=Path)
    prove = sub.add_parser("prove", help="verify candidate provenance and exact artifacts")
    prove.add_argument("--out-dir", type=Path, required=True)
    prove.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    try:
        path, source = select_candidate()
        if args.command == "select":
            if args.github_output:
                if Path(os.environ.get("GITHUB_OUTPUT", "")) != args.github_output:
                    raise CandidateError("cannot write to non-runner GitHub output")
                with args.github_output.open("a", encoding="utf-8") as stream:
                    stream.write(f"source_contract={path.relative_to(ROOT)}\n")
                    stream.write(f"version={source['version']}\n")
            print(f"CANDIDATE_SOURCE_CONTRACT={path.relative_to(ROOT)}")
            print(f"CANDIDATE_VERSION={source['version']}")
        else:
            print(json.dumps(verify_candidate(args.out_dir, source_commit=args.source_commit),
                             indent=2, sort_keys=True))
        return 0
    except (CandidateError, OSError, KeyError) as exc:
        print(f"KERNEL_CANDIDATE=FAIL: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
