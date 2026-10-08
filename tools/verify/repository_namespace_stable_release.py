#!/usr/bin/env python3
"""Read-only stable release *discovery* gate for the OrdaX namespace cutover.

This file does NOT implement signature verification or authorize a transfer.
After this gate, the canonical Go Release Agent must inspect and cryptographically
verify the Ed25519-signed envelope using the pinned trust anchor.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
import re
import sys
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[2]
REPOSITORY_ID = "1371063347"
REPOSITORY = "ordaxsystems/ordax-os"
ENVELOPE_ASSET = "release-envelope.json"
TAG_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")


class StableReleaseError(ValueError):
    pass


def validate_current_identity(ownership: dict, release_contract: dict, env: dict) -> str:
    migration = ownership["namespace_migration"]
    owner = ownership["repositories"]["platform"]["repo"]
    if owner != REPOSITORY or migration["current_namespace"] != "ordaxsystems":
        raise StableReleaseError("canonical owner is not physically cut over")
    if migration["status"] != "complete":
        raise StableReleaseError("canonical namespace cutover is incomplete")
    if migration["completed_transfers"] != ["runtime", "apps", "control_plane", "platform"]:
        raise StableReleaseError("canonical transfer order is incomplete")
    if env.get("GITHUB_REPOSITORY") != REPOSITORY:
        raise StableReleaseError("GitHub runner repository is not the canonical owner")
    if env.get("GITHUB_REPOSITORY_ID") != REPOSITORY_ID:
        raise StableReleaseError("original immutable GitHub repository ID was not preserved")
    if release_contract["source_authority"]["repository"] != REPOSITORY:
        raise StableReleaseError("release contract points to a different owner")
    if release_contract["publication"]["latest_envelope_url"] != (
        f"https://github.com/{REPOSITORY}/releases/latest/download/{ENVELOPE_ASSET}"
    ):
        raise StableReleaseError("release pointer is not the canonical stable selector")
    if release_contract["publication"]["release_envelope_asset_name"] != ENVELOPE_ASSET:
        raise StableReleaseError("release envelope asset name has drifted")
    if release_contract["release"]["manifest_authenticity_required_before_production"] is not True:
        raise StableReleaseError("signed manifest requirement was relaxed")
    return owner


def verify_stable_release_metadata(release: dict, owner: str) -> dict:
    if not isinstance(release, dict) or release.get("draft") is not False:
        raise StableReleaseError("stable release must exist and not be a draft")
    if release.get("prerelease") is not False or not release.get("published_at"):
        raise StableReleaseError("stable release is not published")
    tag = release.get("tag_name")
    if not isinstance(tag, str) or not TAG_PATTERN.fullmatch(tag):
        raise StableReleaseError("stable release tag is unsafe or absent")
    if release.get("html_url") != f"https://github.com/{owner}/releases/tag/{tag}":
        raise StableReleaseError("stable release belongs to a different repository")
    assets = release.get("assets")
    if not isinstance(assets, list):
        raise StableReleaseError("release assets are missing")
    matches = [a for a in assets if isinstance(a, dict) and a.get("name") == ENVELOPE_ASSET]
    if len(matches) != 1:
        raise StableReleaseError("exactly one signed release envelope asset is required")
    asset = matches[0]
    url = f"https://github.com/{owner}/releases/download/{tag}/{ENVELOPE_ASSET}"
    if asset.get("browser_download_url") != url:
        raise StableReleaseError("envelope asset URL belongs to a different release")
    if asset.get("state") != "uploaded" or type(asset.get("size")) is not int or asset["size"] <= 0:
        raise StableReleaseError("stable release envelope asset is not fully uploaded")
    return {"repository": owner, "tag": tag, "asset": ENVELOPE_ASSET, "size": asset["size"]}


def fetch_github_latest(owner: str) -> dict:
    # Owner is validated against a canonical constant before constructing this URL.
    request = urllib.request.Request(
        f"https://api.github.com/repos/{owner}/releases/latest",
        headers={
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "ordax-namespace-stable-release-preflight",
        },
    )
    with urllib.request.urlopen(request, timeout=15) as response:
        if response.status != 200:
            raise StableReleaseError(f"latest stable GitHub API returned {response.status}")
        # Small bounded metadata only; artifact bytes are fetched by the Go
        # signature-verifying inspector, not by this metadata-only script.
        payload = response.read(1024 * 1024 + 1)
        if len(payload) > 1024 * 1024:
            raise StableReleaseError("stable release metadata is oversized")
        return json.loads(payload)


def main() -> int:
    try:
        ownership = json.loads(
            (ROOT / "docs/contracts/repository-ownership.json").read_text(encoding="utf-8")
        )
        channel = json.loads(
            (ROOT / "docs/contracts/release-channel.json").read_text(encoding="utf-8")
        )
        owner = validate_current_identity(ownership, channel, os.environ)
        release = fetch_github_latest(owner)
        result = verify_stable_release_metadata(release, owner)
        print(json.dumps({
            "$schema": "prototype-ordax.namespace-stable-release-discovery/1",
            "status": "verified-metadata-only",
            **result,
            "envelope_signature_verified": False,
            "requires_canonical_ed25519_inspector": True,
        }, sort_keys=True))
        return 0
    except (OSError, ValueError, KeyError, TypeError, urllib.error.URLError) as exc:
        print(f"NAMESPACE_STABLE_RELEASE=BLOCKED: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
