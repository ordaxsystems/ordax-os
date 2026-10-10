#!/usr/bin/env python3
"""Offline kernel.org tarball authentication against a pinned OpenPGP identity.

The kernel.org .tar.sign is over the *uncompressed tar stream*, never the .xz
bytes. This verifier does not retrieve signing keys or trust the user's GPG
home directory. A subsequent build integration must supply an independently
reviewed, versioned public key and invoke this verifier before extraction.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

SCHEMA = "prototype-ordax.kernel-source/1"
RECEIPT_SCHEMA = "prototype-ordax.kernel-upstream-signature-receipt/1"
HEX40 = re.compile(r"[0-9A-F]{40}")
HEX64 = re.compile(r"[0-9a-f]{64}")
VERSION = re.compile(r"[0-9]+[.][0-9]+[.][0-9]+")


class VerificationError(RuntimeError):
    pass


def sha256(path: Path) -> str:
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def gpg(args: list[str], home: Path) -> subprocess.CompletedProcess[str]:
    try:
        return subprocess.run(
            ["gpg", "--homedir", str(home), "--batch", "--no-tty",
             "--no-auto-key-retrieve", *args],
            capture_output=True,
            text=True,
            check=False,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise VerificationError(f"gpg execution unavailable: {exc}") from exc


def primary_fingerprints(key_listing: str) -> list[str]:
    fingerprints: list[str] = []
    expect_primary = False
    for line in key_listing.splitlines():
        parts = line.split(":")
        if parts[0] == "pub":
            expect_primary = True
        elif parts[0] == "fpr" and expect_primary:
            if len(parts) < 10:
                raise VerificationError("malformed GPG fingerprint listing")
            fingerprints.append(parts[9].upper())
            expect_primary = False
        elif parts[0] == "sub":
            expect_primary = False
    return fingerprints


def validate_source_contract(source: dict) -> tuple[str, str, str]:
    version = source.get("version")
    signature = source.get("upstream_signature")
    if source.get("$schema") != SCHEMA or not isinstance(version, str) or not VERSION.fullmatch(version):
        raise VerificationError("invalid canonical kernel source schema or version")
    expected_hash = source.get("archive_sha256")
    if not isinstance(expected_hash, str) or not HEX64.fullmatch(expected_hash):
        raise VerificationError("invalid kernel source SHA-256 pin")
    if not isinstance(signature, dict) or signature.get("algorithm") != "openpgp-detached-tar":
        raise VerificationError("missing mandatory OpenPGP signature policy")
    expected_fpr = signature.get("trusted_primary_fingerprint")
    if not isinstance(expected_fpr, str) or not HEX40.fullmatch(expected_fpr.upper()):
        raise VerificationError("invalid trusted OpenPGP fingerprint")
    expected_tar = f"linux-{version}.tar"
    prefix = "https://cdn.kernel.org/pub/linux/kernel/v6.x/"
    if source.get("archive_url") != prefix + expected_tar + ".xz":
        raise VerificationError("kernel archive URL differs from canonical version")
    if source.get("signature_url") != prefix + expected_tar + ".sign":
        raise VerificationError("kernel detached signature URL differs from canonical version")
    return version, expected_hash, expected_fpr.upper()


def verify(
    contract_path: Path,
    archive: Path,
    signature_path: Path,
    public_key: Path,
) -> dict:
    try:
        contract = json.loads(contract_path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as exc:
        raise VerificationError(f"cannot read kernel source contract: {exc}") from exc
    version, expected_hash, expected_fpr = validate_source_contract(contract)
    if archive.name != f"linux-{version}.tar.xz" or signature_path.name != f"linux-{version}.tar.sign":
        raise VerificationError("archive or signature filename disagrees with kernel source pin")
    for path, label, limit in (
        (archive, "archive", None),
        (signature_path, "signature", 128 * 1024),
        (public_key, "trusted public key", 1024 * 1024),
    ):
        if path.is_symlink() or not path.is_file():
            raise VerificationError(f"missing or unsafe {label}: {path}")
        if limit is not None and path.stat().st_size > limit:
            raise VerificationError(f"{label} is unexpectedly large")
    observed_hash = sha256(archive)
    if observed_hash != expected_hash:
        raise VerificationError(f"kernel tarball SHA-256 mismatch: expected={expected_hash} actual={observed_hash}")

    with tempfile.TemporaryDirectory(prefix="ordax-kernel-gpg-") as temporary:
        home = Path(temporary)
        home.chmod(0o700)
        imported = gpg(["--import", str(public_key)], home)
        if imported.returncode != 0:
            raise VerificationError("trusted OpenPGP public key could not be imported")
        listing = gpg(["--with-colons", "--fingerprint", "--list-keys"], home)
        if listing.returncode != 0 or primary_fingerprints(listing.stdout) != [expected_fpr]:
            raise VerificationError("imported public key is not the pinned signer identity")
        try:
            decoder = subprocess.Popen(
                ["xz", "--decompress", "--stdout", "--", str(archive)],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            assert decoder.stdout is not None
            # Never hold the multi-hundred-MB uncompressed kernel tarball in RAM.
            gpg_result = subprocess.run(
                ["gpg", "--homedir", str(home), "--batch", "--no-tty",
                 "--no-auto-key-retrieve", "--status-fd", "1",
                 "--verify", str(signature_path), "-"],
                stdin=decoder.stdout,
                capture_output=True,
                text=True,
                check=False,
                timeout=180,
            )
            decoder.stdout.close()
            decoder_stderr = decoder.communicate(timeout=30)[1]
        except (OSError, subprocess.TimeoutExpired) as exc:
            if "decoder" in locals() and decoder.poll() is None:
                decoder.kill()
                decoder.communicate()
            raise VerificationError(f"kernel signature verification failed to execute: {exc}") from exc
        if decoder.returncode != 0:
            raise VerificationError("kernel .tar.xz decompression failed during signature verification")
        if gpg_result.returncode != 0:
            raise VerificationError("kernel detached OpenPGP signature is invalid")
        valid_signatures = []
        for line in gpg_result.stdout.splitlines():
            if line.startswith("[GNUPG:] VALIDSIG "):
                tokens = line.split()
                # A signing subkey may appear first; final token is the primary
                # fingerprint when that information is supplied by GnuPG.
                candidate = tokens[-1] if len(tokens) >= 12 else tokens[2]
                valid_signatures.append(candidate.upper())
        if valid_signatures != [expected_fpr]:
            raise VerificationError("OpenPGP signature signer differs from the pinned identity")

    return {
        "$schema": RECEIPT_SCHEMA,
        "status": "verified",
        "kernel_version": version,
        "archive_sha256": observed_hash,
        "signature_sha256": sha256(signature_path),
        "source_contract_sha256": sha256(contract_path),
        "trusted_primary_fingerprint": expected_fpr,
        "detached_signature_target": "uncompressed-tar-stream",
        "key_discovery_performed": False,
        "physical_write_authorized": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify pinned kernel.org tarball SHA-256 and detached signer")
    parser.add_argument("--source-contract", type=Path, required=True)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--signature", type=Path, required=True)
    parser.add_argument("--public-key", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    try:
        receipt = verify(args.source_contract, args.archive, args.signature, args.public_key)
        args.out.parent.mkdir(parents=True, exist_ok=True)
        args.out.write_text(json.dumps(receipt, sort_keys=True, indent=2) + "\n", encoding="utf-8")
    except (VerificationError, OSError) as exc:
        print(f"KERNEL_UPSTREAM_SIGNATURE=FAIL: {exc}", file=sys.stderr)
        return 1
    print("KERNEL_UPSTREAM_SIGNATURE=VERIFIED")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
