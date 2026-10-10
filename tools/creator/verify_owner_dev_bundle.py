#!/usr/bin/env python3
"""Verify a Windows Owner/Development Creator ZIP before GitHub publication.

The development profile is intentionally non-public. This checker does not
authorize physical writes or trust a directory's filename as provenance.
"""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import re
import sys
import zipfile

EXPECTED = {
    "OrdaX-Creator/OrdaX-Creator.exe",
    "OrdaX-Creator/ordax-creator-physical-test.exe",
    "OrdaX-Creator/ordax-bootstrap-seed.raw",
    "OrdaX-Creator/provenance.json",
    "OrdaX-Creator/LEIA-ME.txt",
}
SHA40 = re.compile(r"^[0-9a-f]{40}$")

def fail(reason: str) -> None:
    raise ValueError(reason)

def sha_file(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            size += len(block)
            h.update(block)
    return h.hexdigest(), size

def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--metadata", type=Path, required=True)
    parser.add_argument("--checksums", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    args = parser.parse_args()
    if not SHA40.fullmatch(args.source_commit):
        fail("invalid-exact-source-commit")
    metadata = json.loads(args.metadata.read_text(encoding="utf-8"))
    if metadata.get("$schema") != "prototype-ordax.creator-owner-bundle-update/1":
        fail("incorrect-update-schema")
    if metadata.get("channel") != "owner-prototype" or metadata.get("automatic_in_app_update") is not False:
        fail("public-or-automatic-channel-not-allowed")
    if metadata.get("source_commit") != args.source_commit:
        fail("source-commit-drift")
    if metadata.get("artifact") != "OrdaX-Creator-Owner-Prototype.zip":
        fail("unexpected-artifact-name")
    if metadata.get("version") != "owner-" + args.source_commit[:12]:
        fail("version-drift")
    digest, size = sha_file(args.archive)
    if digest != metadata.get("sha256") or size != metadata.get("size"):
        fail("archive-integrity-mismatch")
    sums = args.checksums.read_text(encoding="utf-8").strip()
    if sums != f"{digest}  OrdaX-Creator-Owner-Prototype.zip":
        fail("checksum-file-mismatch")
    with zipfile.ZipFile(args.archive, "r") as archive:
        members = archive.infolist()
        names = [item.filename for item in members]
        if len(names) != len(set(names)) or set(names) != EXPECTED:
            fail("unexpected-duplicate-or-missing-bundle-members")
        for item in members:
            if item.is_dir() or (item.external_attr >> 16) & 0o170000 == 0o120000:
                fail("directory-or-symlink-in-bundle")
        provenance = json.loads(archive.read("OrdaX-Creator/provenance.json"))
        if provenance.get("$schema") != "prototype-ordax.creator-owner-physical/1":
            fail("incorrect-provenance-schema")
        if provenance.get("source_commit") != args.source_commit:
            fail("seed-commit-drift")
        if provenance.get("canonical_public_release") is not False:
            fail("dev-bundle-misrepresented-as-public-release")
        if provenance.get("ephemeral_prototype_trust") is not True:
            fail("development-trust-scope-missing")
        if provenance.get("private_key_in_package") is not False:
            fail("private-key-marked-as-packaged")
        if provenance.get("physical_write_authorized_in_binary") is not True:
            fail("owner-writer-not-bound")
        h = hashlib.sha256()
        uncompressed = 0
        with archive.open("OrdaX-Creator/ordax-bootstrap-seed.raw") as raw:
            for block in iter(lambda: raw.read(1024 * 1024), b""):
                uncompressed += len(block)
                h.update(block)
        if h.hexdigest() != provenance.get("seed_sha256") or uncompressed != provenance.get("seed_size"):
            fail("development-seed-integrity-mismatch")
        for filename in ("OrdaX-Creator/OrdaX-Creator.exe",
                         "OrdaX-Creator/ordax-creator-physical-test.exe"):
            with archive.open(filename) as stream:
                if stream.read(2) != b"MZ":
                    fail("invalid-windows-executable")
    print(f"OWNER_DEV_BUNDLE_VERIFY=PASS source={args.source_commit} size={size}")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, zipfile.BadZipFile, json.JSONDecodeError) as exc:
        print(f"OWNER_DEV_BUNDLE_VERIFY=FAIL reason={exc}", file=sys.stderr)
        raise SystemExit(1)
