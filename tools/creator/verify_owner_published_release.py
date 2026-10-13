#!/usr/bin/env python3
"""Verify the four bytes-bound assets of the mutable Owner/Development release.

The fixed creator-owner-prototype tag is a channel locator, NOT the provenance
of the current asset. The immutable Git SHA is carried in creator-owner-update.json
and provenance.json, and must match the just-built archive. GitHub metadata PATCH
may be forbidden to an Actions integration that can publish release assets.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import re
import sys

TAG = "creator-owner-prototype"
NAMES = (
    "OrdaX-Creator-Owner-Prototype.zip",
    "SHA256SUMS.txt",
    "LEIA-ME.txt",
    "creator-owner-update.json",
)
SHA40 = re.compile(r"^[0-9a-f]{40}$")
SHA256 = re.compile(r"^[0-9a-f]{64}$")


def verify(release: dict, local: dict[str, bytes], source_commit: str) -> None:
    if not SHA40.fullmatch(source_commit):
        raise ValueError("invalid-expected-source")
    if (release.get("tag_name") != TAG or release.get("prerelease") is not True
            or release.get("draft") is not False):
        raise ValueError("wrong-release-channel-or-visibility")
    assets = release.get("assets")
    if not isinstance(assets, list) or len(assets) != len(NAMES):
        raise ValueError("wrong-asset-count")
    names = [a.get("name") for a in assets if isinstance(a, dict)]
    if len(names) != len(NAMES) or set(names) != set(NAMES) or len(names) != len(set(names)):
        raise ValueError("missing-unexpected-or-duplicate-assets")
    if set(local) != set(NAMES):
        raise ValueError("invalid-local-asset-set")
    for asset in assets:
        name = asset["name"]
        digest = hashlib.sha256(local[name]).hexdigest()
        if (asset.get("size") != len(local[name])
                or asset.get("digest") != "sha256:" + digest
                or asset.get("state") not in (None, "uploaded")):
            raise ValueError("published-asset-hash-size-or-state-drift:" + name)
    meta = json.loads(local["creator-owner-update.json"])
    if (meta.get("$schema") != "prototype-ordax.creator-owner-bundle-update/1"
            or meta.get("source_commit") != source_commit
            or meta.get("channel") != "owner-prototype"
            or meta.get("automatic_in_app_update") is not False
            or meta.get("artifact") != NAMES[0]):
        raise ValueError("wrong-published-source-or-channel")
    zip_hash = hashlib.sha256(local[NAMES[0]]).hexdigest()
    if not SHA256.fullmatch(zip_hash):
        raise ValueError("invalid-zip-hash")
    if (meta.get("sha256") != zip_hash
            or meta.get("size") != len(local[NAMES[0]])
            or local["SHA256SUMS.txt"] != f"{zip_hash}  {NAMES[0]}\n".encode()):
        raise ValueError("remote-manifest-does-not-bind-published-zip")
    if meta.get("download_url") != (
        "https://github.com/ordaxsystems/ordax-os/releases/download/"
        + TAG + "/" + NAMES[0]
    ):
        raise ValueError("unexpected-download-channel")
    # Deliberately DO NOT compare target_commitish with source_commit:
    # for a pre-existing fixed tag it is creation-time metadata, not the
    # identity of the currently published ZIP or of the versioned manifest.


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--release", type=Path, required=True)
    p.add_argument("--archive", type=Path, required=True)
    p.add_argument("--metadata", type=Path, required=True)
    p.add_argument("--checksums", type=Path, required=True)
    p.add_argument("--readme", type=Path, required=True)
    p.add_argument("--source-commit", required=True)
    args = p.parse_args()
    expected = {NAMES[0]: args.archive, NAMES[1]: args.checksums,
                NAMES[2]: args.readme, NAMES[3]: args.metadata}
    local = {k: v.read_bytes() for k, v in expected.items()}
    verify(json.loads(args.release.read_text(encoding="utf-8")), local, args.source_commit)
    print(f"OWNER_RELEASE_ASSET_READBACK=PASS source={args.source_commit} zip_sha256={hashlib.sha256(local[NAMES[0]]).hexdigest()}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError) as err:
        print(f"OWNER_RELEASE_ASSET_READBACK=FAIL reason={err}", file=sys.stderr)
        raise SystemExit(1)
