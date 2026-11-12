#!/usr/bin/env python3
"""Read-only GitHub Releases metadata inspection for Creator's 17 source assets.

Consumes the independent Creator Core's bindings and the GitHub release API
response. Metadata is an advisory distribution coverage check, NOT the
publisher's mandatory full HTTPS download + SHA-256 readback.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import re

from prepare_creator_physical_v3 import PreparationError, _load_json, _verified_bindings, REPOSITORY

COMMIT = re.compile(r"^[0-9a-f]{40}$")
SCHEMA = "prototype-ordax.creator-source-distribution-inspection/1"


def inspect(bindings: dict, release: dict, source_commit: str) -> dict:
    if not isinstance(source_commit, str) or not COMMIT.fullmatch(source_commit):
        raise PreparationError("source commit must be immutable lowercase 40-hex")
    expected = _verified_bindings(bindings)  # Single Creator Core inventory.
    tag = f"ordax-stable-v4-{source_commit}"
    if release.get("tag_name") != tag or release.get("draft") is not False:
        raise PreparationError("GitHub metadata is not the exact published Stable release")
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise PreparationError("GitHub release has no valid asset inventory")

    published = {}
    for asset in assets:
        if not isinstance(asset, dict) or not isinstance(asset.get("name"), str):
            raise PreparationError("malformed GitHub release asset")
        name = asset["name"]
        if name in published or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", name):
            raise PreparationError("duplicate or unsafe GitHub release asset name")
        published[name] = asset

    prefix = f"https://github.com/{REPOSITORY}/releases/download/{tag}/"
    missing, mismatch, matching = [], [], []
    for item in expected:
        name = item["id"]
        remote = published.get(name)
        if remote is None:
            missing.append(name)
            continue
        if (
            remote.get("browser_download_url") != prefix + name
            or type(remote.get("size")) is not int
            or remote["size"] != item["size_bytes"]
            or remote.get("digest") != "sha256:" + item["sha256"]
        ):
            mismatch.append(name)
        else:
            matching.append(name)

    return {
        "$schema": SCHEMA,
        "status": "metadata-complete-readback-pending" if len(matching) == 17 else "blocked-incomplete-remote-distribution",
        "source_repository": REPOSITORY,
        "release_source_commit": source_commit,
        "release_tag": tag,
        "required_artifact_count": len(expected),
        "matching_metadata_count": len(matching),
        "missing_asset_ids": missing,
        "mismatched_asset_ids": mismatch,
        "metadata_only": True,
        "remote_byte_readback_passed": False,
        "release_published_with_complete_verified_bytes": False,
        "signed_creator_physical_writer_published": False,
        "physical_write_authorized": False,
        "physical_write_performed": False,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bindings", type=Path, required=True)
    parser.add_argument("--release-metadata", type=Path, required=True)
    parser.add_argument("--source-commit", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    try:
        result = inspect(_load_json(args.bindings, "Creator source bindings"),
                         _load_json(args.release_metadata, "GitHub Releases API metadata"),
                         args.source_commit)
        out = args.output.absolute()
        if not out.parent.is_dir() or out.parent.is_symlink() or out.parent.resolve() != out.parent:
            raise PreparationError("inspection output parent must be a real directory")
        with out.open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(result, stream, sort_keys=True, indent=2)
            stream.write("\n")
    except (PreparationError, FileExistsError) as exc:
        parser.exit(2, f"source distribution inspection rejected: {exc}\n")
    print(f"PORTABLE_V3_PUBLIC_ASSET_METADATA_MATCHES={result['matching_metadata_count']}/17")
    print(f"PORTABLE_V3_PUBLIC_ASSET_METADATA_STATUS={result['status']}")
    print("PORTABLE_V3_FULL_REMOTE_BYTE_READBACK=NOT_PERFORMED")
    print("CREATOR_PHYSICAL_PUBLICATION_READY=NO")
    print("PHYSICAL_DEVICE_TOUCHED=NO")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
