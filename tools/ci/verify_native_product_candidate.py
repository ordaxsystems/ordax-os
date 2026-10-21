"""Offline, read-only verification of an unsigned Runtime CI candidate.

This is a provenance gate for the Owner Development handoff, NOT a signing,
installation, device-grant, attestation or runtime-activation operation.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import stat
import sys
import zipfile

EXPECTED_FILES = frozenset(("SHA256SUMS", "candidate.json", "ordax-product-agent", "self-test.json"))
SHA256 = re.compile(r"[0-9a-f]{64}\Z")
COMMIT = re.compile(r"[0-9a-f]{40}\Z")


class CandidateError(ValueError):
    pass


def _hash_stream(stream):
    digest = hashlib.sha256()
    count = 0
    while chunk := stream.read(1024 * 1024):
        count += len(chunk)
        digest.update(chunk)
    return digest.hexdigest(), count


def _document(data, name):
    if len(data) > 16384:
        raise CandidateError(f"{name} is too large")
    try:
        value = json.loads(data)
    except (ValueError, UnicodeDecodeError) as error:
        raise CandidateError(f"{name} is not JSON") from error
    if not isinstance(value, dict):
        raise CandidateError(f"{name} must be an object")
    return value


def verify(archive: Path, source_lock: Path) -> dict:
    lock = _document(source_lock.read_bytes(), "source lock")
    if lock.get("$schema") != "prototype-ordax.studio-runtime-source-lock/1":
        raise CandidateError("unexpected OS source-lock schema")
    source = lock.get("source", {})
    evidence = lock.get("candidate_evidence", {})
    distribution = lock.get("distribution", {})
    activation = lock.get("activation", {})
    sha = source.get("commit")
    if not isinstance(sha, str) or not COMMIT.fullmatch(sha):
        raise CandidateError("source commit is not pinned")
    if evidence.get("kind") != "ci-only-unsigned" or evidence.get("source_commit") != sha:
        raise CandidateError("candidate does not bind to pinned source")
    if evidence.get("platform") != "linux-amd64-musl":
        raise CandidateError("candidate platform is unsupported")
    for field in ("archive_sha256", "executable_sha256"):
        if not isinstance(evidence.get(field), str) or not SHA256.fullmatch(evidence[field]):
            raise CandidateError(f"missing pinned {field}")
    if not isinstance(evidence.get("executable_size_bytes"), int) or evidence["executable_size_bytes"] <= 0:
        raise CandidateError("invalid binary size pin")
    if (evidence.get("offline_proof_verified") is not True or evidence.get("device_execution_proven") is not False
        or evidence.get("signed_distribution_authorized") is not False
        or evidence.get("native_graphical_control_proven") is not False):
        raise CandidateError("candidate evidence cannot authorize runtime")
    if (distribution.get("runtime_artifact_claimed") is not False or
        distribution.get("runtime_packaged_in_stable") is not False or
        distribution.get("source_binding_only") is not True or
        activation.get("dispatch_enabled") is not False or
        activation.get("requires_signed_runtime_slot") is not True):
        raise CandidateError("OS activation gates must stay closed")

    with archive.open("rb") as source_bytes:
        digest, _ = _hash_stream(source_bytes)
    if digest != evidence["archive_sha256"]:
        raise CandidateError("archive digest does not match OS evidence")

    try:
        with zipfile.ZipFile(archive) as zipped:
            infos = zipped.infolist()
            if len(infos) != len(EXPECTED_FILES) or {i.filename for i in infos} != EXPECTED_FILES:
                raise CandidateError("candidate ZIP members are not exact")
            for info in infos:
                mode = info.external_attr >> 16
                if (info.is_dir() or stat.S_IFMT(mode) == stat.S_IFLNK or
                    info.flag_bits & 1):
                    raise CandidateError("unsafe candidate ZIP entry")
            manifest = _document(zipped.read("candidate.json"), "candidate manifest")
            proof = _document(zipped.read("self-test.json"), "offline proof")
            if (manifest.get("schema") != "ordax.native-product-runtime-candidate/1" or
                manifest.get("source_repository") != "ordaxsystems/ordax-runtime" or
                manifest.get("source_commit") != sha or
                manifest.get("platform") != "linux-amd64-musl" or
                manifest.get("artifact") != "ordax-product-agent"):
                raise CandidateError("candidate manifest is not pinned to canonical Runtime")
            if any(manifest.get(flag) is not False for flag in (
                "python_required_on_device", "graphical_control_implemented",
                "signature_present", "installation_authorized_by_candidate", "stable_activation_authorized"
            )):
                raise CandidateError("candidate must not claim signature/activation")
            if (manifest.get("sha256") != evidence["executable_sha256"] or
                manifest.get("size_bytes") != evidence["executable_size_bytes"]):
                raise CandidateError("candidate executable does not match evidence")
            if (proof.get("ok") is not True or proof.get("network_used") is not False or
                proof.get("device_credential_used") is not False or proof.get("graphical_actions") != [] or
                proof.get("probes") != ["filesystem", "terminal", "supervised-process"] or
                proof.get("profile") != "owner-development-usb"):
                raise CandidateError("offline execution proof does not match expected boundary")
            with zipped.open("ordax-product-agent") as stream:
                elf = stream.read(20)
            with zipped.open("ordax-product-agent") as stream:
                binary_hash, size = _hash_stream(stream)
            if elf[:5] != b"\x7fELF\x02" or elf[18:20] != b"\x3e\x00":
                raise CandidateError("candidate is not an amd64 ELF")
            if binary_hash != evidence["executable_sha256"] or size != evidence["executable_size_bytes"]:
                raise CandidateError("candidate executable bytes failed verification")
            if zipped.read("SHA256SUMS") != f"{binary_hash}  ordax-product-agent\n".encode():
                raise CandidateError("SHA256SUMS does not match executable")
    except (zipfile.BadZipFile, RuntimeError, OSError) as error:
        raise CandidateError("candidate ZIP unreadable") from error
    return {"source_commit": sha, "sha256": binary_hash, "size_bytes": size,
            "activation_authorized": False, "device_execution_proven": False}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--source-lock", type=Path, default=Path(__file__).resolve().parents[2] /
                        "system/services/device-agent/studio-runtime-source-lock.json")
    args = parser.parse_args()
    try:
        result = verify(args.archive, args.source_lock)
    except (CandidateError, FileNotFoundError, PermissionError) as error:
        print(f"ORDAX_NATIVE_PRODUCT_CANDIDATE=FAIL: {error}", file=sys.stderr)
        return 1
    print("ORDAX_NATIVE_PRODUCT_CANDIDATE=PASS")
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
