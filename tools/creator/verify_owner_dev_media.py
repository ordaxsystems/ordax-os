#!/usr/bin/env python3
"""Fail-closed QEMU-accepted Owner USB media verifier; no Creator app build."""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import sys

ASSETS = frozenset({
    "creator-owner-media.json",
    "ordax-bootstrap-seed.raw.gz",
    "ordax-symbol.png",
    "ordax-design-theme.json",
})
SHA40 = re.compile(r"[0-9a-f]{40}\Z")
SHA256 = re.compile(r"[0-9a-f]{64}\Z")


def digest(path: Path) -> tuple[str, int]:
    h = hashlib.sha256()
    size = 0
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
            size += len(block)
    return h.hexdigest(), size


def verify(directory: Path, expected_source: str, seed: Path | None,
           proof: Path | None, release: Path | None) -> dict:
    if not SHA40.fullmatch(expected_source):
        raise ValueError("source-commit-invalid")
    actual = {p.name for p in directory.iterdir() if p.is_file()}
    if actual != ASSETS or any(p.is_symlink() or not p.is_file() for p in directory.iterdir()):
        raise ValueError("unexpected-or-missing-media-assets")
    meta = json.loads((directory / "creator-owner-media.json").read_text(encoding="utf-8"))
    if (meta.get("$schema") != "prototype-ordax.creator-owner-media/1"
            or meta.get("channel") != "owner-prototype"
            or meta.get("status") != "qemu-accepted-development-media-only"
            or meta.get("source_repository") != "ordaxsystems/ordax-os"
            or meta.get("source_commit") != expected_source
            or meta.get("qemu_two_boot_acceptance") is not True
            or meta.get("physical_hardware_proven") is not False
            or meta.get("canonical_public_release") is not False
            or meta.get("private_key_in_package") is not False
            or meta.get("windows_executable_in_media") is not False):
        raise ValueError("media-provenance-or-authority-mismatch")
    for field in ("assembly_creator_source_commit",):
        if not isinstance(meta.get(field), str) or not SHA40.fullmatch(meta[field]):
            raise ValueError("source-identity-invalid:" + field)
    for field in ("seed_sha256", "compressed_seed_sha256", "symbol_sha256",
                  "theme_sha256", "trust_sha256", "prototype_manifest_sha256",
                  "qemu_proof_sha256"):
        if not isinstance(meta.get(field), str) or not SHA256.fullmatch(meta[field]):
            raise ValueError("media-hash-invalid:" + field)
    for field in ("seed_size", "compressed_seed_size"):
        if type(meta.get(field)) is not int or not 0 < meta[field] <= 8 * 1024**3:
            raise ValueError("media-size-invalid:" + field)
    for name, sha_field, size_field in (
        ("ordax-bootstrap-seed.raw.gz", "compressed_seed_sha256", "compressed_seed_size"),
        ("ordax-symbol.png", "symbol_sha256", None),
        ("ordax-design-theme.json", "theme_sha256", None),
    ):
        actual_sha, actual_size = digest(directory / name)
        if actual_sha != meta[sha_field] or (size_field and actual_size != meta[size_field]):
            raise ValueError("media-asset-mismatch:" + name)
    if (directory / "ordax-symbol.png").stat().st_size > 2 << 20 or (
            directory / "ordax-design-theme.json").stat().st_size > 64 << 10:
        raise ValueError("media-brand-size-invalid")
    # The published compressed image must reproduce exactly the RAW that was
    # accepted by QEMU. Merely hashing the compressed bytes is insufficient.
    unpacked_sha = hashlib.sha256()
    unpacked_size = 0
    with gzip.open(directory / "ordax-bootstrap-seed.raw.gz", "rb") as reader:
        for chunk in iter(lambda: reader.read(1024 * 1024), b""):
            unpacked_size += len(chunk)
            if unpacked_size > meta["seed_size"]:
                raise ValueError("compressed-media-expansion-exceeds-proven-seed")
            unpacked_sha.update(chunk)
    if unpacked_sha.hexdigest() != meta["seed_sha256"] or unpacked_size != meta["seed_size"]:
        raise ValueError("compressed-media-does-not-match-proven-seed")
    if seed is not None:
        raw_sha, raw_size = digest(seed)
        if raw_sha != meta["seed_sha256"] or raw_size != meta["seed_size"]:
            raise ValueError("uncompressed-seed-mismatch")
    if proof is not None:
        proof_sha, _ = digest(proof)
        accepted = json.loads(proof.read_text(encoding="utf-8"))
        if (proof_sha != meta["qemu_proof_sha256"]
                or accepted.get("status") != "pass"
                or not all(accepted.get("checks", {}).values())
                or not accepted.get("second_offline_boot_proven")
                or not accepted.get("welcome_screen_rendered_proven")
                or not accepted.get("guest_acpi_shutdown_proven")
                or not accepted.get("ext4_clean_after_guest_shutdown")
                or accepted.get("physical_device_touched") is not False):
            raise ValueError("QEMU-proof-binding-invalid")
    if release is not None:
        doc = json.loads(release.read_text(encoding="utf-8"))
        assets = doc.get("assets")
        if (doc.get("tag_name") != "creator-owner-media"
                or doc.get("prerelease") is not True or doc.get("draft") is not False
                or not isinstance(assets, list) or len(assets) != len(ASSETS)):
            raise ValueError("release-channel-invalid")
        names = [x.get("name") for x in assets]
        if len(names) != len(set(names)) or set(names) != ASSETS:
            raise ValueError("release-assets-mismatch")
        for asset in assets:
            sha, size = digest(directory / asset["name"])
            if (asset.get("size") != size
                    or asset.get("digest") != "sha256:" + sha
                    or asset.get("state") not in (None, "uploaded")):
                raise ValueError("release-readback-mismatch:" + asset["name"])
    return meta


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--directory", type=Path, required=True)
    p.add_argument("--source-commit", required=True)
    p.add_argument("--seed", type=Path)
    p.add_argument("--qemu-proof", type=Path)
    p.add_argument("--release-json", type=Path)
    args = p.parse_args()
    info = verify(args.directory, args.source_commit, args.seed,
                  args.qemu_proof, args.release_json)
    print("ORDAX_OWNER_MEDIA=PASS source=" + info["source_commit"])
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (ValueError, OSError, json.JSONDecodeError, gzip.BadGzipFile) as exc:
        print("ORDAX_OWNER_MEDIA=FAIL reason=" + str(exc), file=sys.stderr)
        raise SystemExit(1)
