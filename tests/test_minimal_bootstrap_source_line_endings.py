#!/usr/bin/env python3
"""Guard cross-platform bytes of all SHA-256-bound bootstrap text sources.

A Windows checkout with autocrlf must not silently mutate payload bytes. No
hash is recalculated or rewritten: the manifest stays authoritative.
"""
from __future__ import annotations

import hashlib
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "docs/contracts/minimal-bootstrap.json"
ATTRIBUTES = ROOT / ".gitattributes"

# These five payload sources are reproducible/pinned *binaries* and must not
# be subject to newline processing. All other manifest entries are exact
# source text files; changes to this list require review of the source owner.
BINARY_SOURCES = frozenset({
    "boot/esp/EFI/BOOT/BOOTX64.EFI",
    next(
        artifact["source_path"]
        for group in json.loads(MANIFEST.read_text(encoding="utf-8"))["artifact_groups"]
        if group["id"] == "kernel"
        for artifact in group["artifacts"]
    ),
    "bootstrap/initramfs/initramfs.cpio.gz",
    "bootstrap/network/bin/netbox",
    "bootstrap/release-acquisition/ordax-release-agent",
})


def tracked_lf_sources() -> tuple[tuple[str, str], ...]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sources = []
    for group in manifest["artifact_groups"]:
        for artifact in group["artifacts"]:
            path = artifact["source_path"]
            if path not in BINARY_SOURCES:
                sources.append((path, artifact["sha256"]))
    return tuple(sources)


def text_attribute_paths() -> set[str]:
    result = set()
    for line in ATTRIBUTES.read_text(encoding="utf-8").splitlines():
        tokens = line.split()
        if len(tokens) == 3 and tokens[1:] == ["text", "eol=lf"]:
            result.add(tokens[0])
    return result


class MinimalBootstrapSourceLineEndingsTests(unittest.TestCase):
    def test_each_hash_bound_text_source_pins_lf_in_git(self):
        pins = text_attribute_paths()
        sources = tracked_lf_sources()
        self.assertGreaterEqual(len(sources), 8)
        for path, _ in sources:
            with self.subTest(source=path):
                self.assertIn(path, pins, "Git must not convert hash-bound source bytes")

    def test_checked_out_bytes_match_pinned_manifest_not_windows_crlf(self):
        for path, expected in tracked_lf_sources():
            with self.subTest(source=path):
                source = ROOT / path
                self.assertTrue(source.is_file(), f"Missing text source: {path}")
                self.assertFalse(source.is_symlink(), f"Symlinked source: {path}")
                data = source.read_bytes()
                self.assertNotIn(b"\r\n", data, f"Windows CRLF drift in {path}")
                self.assertEqual(
                    hashlib.sha256(data).hexdigest(),
                    expected,
                    f"Hash drift in canonical bootstrap source: {path}",
                )

    def test_binary_sources_remain_outside_text_normalization(self):
        declared = {
            artifact["source_path"]
            for group in json.loads(MANIFEST.read_text(encoding="utf-8"))["artifact_groups"]
            for artifact in group["artifacts"]
        }
        self.assertTrue(BINARY_SOURCES <= declared)
        self.assertFalse(BINARY_SOURCES & text_attribute_paths())


if __name__ == "__main__":
    unittest.main()
