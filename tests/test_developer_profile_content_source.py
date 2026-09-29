#!/usr/bin/env python3
"""Regression guards for the canonical Developer Profile content source."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "system/profile-content-sources/developer-core/v0.1.0"
PACK_PATH = SOURCE / "content.pack"
CONTENT_MANIFEST_PATH = SOURCE / "manifest.json"
PROFILE_MANIFEST_PATH = ROOT / "system/profile-packs/developer/v1/manifest.json"
HEX40 = re.compile(r"^[0-9a-f]{40}$")


class DeveloperProfileContentSourceTests(unittest.TestCase):
    def test_source_is_deterministically_bound_and_non_privileged(self):
        pack_bytes = PACK_PATH.read_bytes()
        pack = json.loads(pack_bytes)
        manifest = json.loads(CONTENT_MANIFEST_PATH.read_text(encoding="utf-8"))

        self.assertEqual(pack["schema"], "ordax.profile-content-pack/1")
        self.assertEqual(pack["kind"], "knowledge-pack")
        self.assertGreaterEqual(len(pack["entries"]), 2)
        self.assertEqual(manifest["$schema"], "prototype-ordax.profile-content-manifest/1")
        self.assertEqual(manifest["id"], "knowledge.developer-core")
        self.assertEqual(manifest["kind"], "knowledge-pack")
        self.assertEqual(manifest["version"], "0.1.0")
        self.assertEqual(manifest["content_format"], "ordax.profile-content-pack/1")
        self.assertEqual(manifest["content_size"], len(pack_bytes))
        self.assertEqual(manifest["content_hash"], hashlib.sha256(pack_bytes).hexdigest())
        self.assertEqual(manifest["requested_capabilities"], [])
        self.assertFalse(manifest["runtime_network_allowed"])
        self.assertFalse(manifest["mutable_host_access_allowed"])

        source_revision = manifest["source"]["revision"]
        self.assertRegex(source_revision, HEX40)
        self.assertEqual(manifest["source"]["license"], "project-owned")
        for entry in pack["entries"]:
            content = entry["content"].strip()
            self.assertEqual(
                entry["contentSha256"],
                hashlib.sha256(content.encode("utf-8")).hexdigest(),
            )
            source = entry["source"]
            self.assertEqual(source["revision"], source_revision)
            self.assertIn(source_revision, source["uri"])
            self.assertEqual(source["license"], "project-owned")

    def test_profile_references_source_as_planned_not_falsely_published(self):
        profile = json.loads(PROFILE_MANIFEST_PATH.read_text(encoding="utf-8"))
        components = [row for row in profile["components"] if row["id"] == "knowledge.developer-core"]
        self.assertEqual(len(components), 1)
        component = components[0]
        self.assertEqual(component["kind"], "knowledge-pack")
        self.assertEqual(component["version"], "0.1.0")
        self.assertTrue(component["required"])
        self.assertEqual(component["availability"], "planned")
        self.assertIsNone(component["sha256"])
        self.assertTrue(component["signature_required"])

    def test_source_is_not_publication_evidence(self):
        names = {path.name for path in SOURCE.iterdir()}
        self.assertEqual(names, {"content.pack", "manifest.json"})
        self.assertFalse(any(name.endswith((".pem", ".key", ".p12", ".pfx")) for name in names))
        self.assertNotIn("envelope.json", names)
        self.assertNotIn("ceremony-public-evidence.json", names)


if __name__ == "__main__":
    unittest.main()
