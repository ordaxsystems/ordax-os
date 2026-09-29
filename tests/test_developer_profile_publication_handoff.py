#!/usr/bin/env python3
from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tools/profile-content-channel/prepare_publication_handoff.py"
SOURCE = ROOT / "system/profile-content-sources/developer-core/v0.1.0"

spec = importlib.util.spec_from_file_location("prepare_publication_handoff", TOOL)
module = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(module)


class DeveloperProfilePublicationHandoffTests(unittest.TestCase):
    def test_real_developer_source_produces_unsigned_fail_closed_handoff(self):
        handoff = module.build_handoff(SOURCE)
        self.assertEqual(
            handoff["$schema"],
            "prototype-ordax.profile-content-publication-handoff/1",
        )
        self.assertEqual(handoff["component"]["id"], "knowledge.developer-core")
        self.assertEqual(handoff["component"]["version"], "0.1.0")
        self.assertEqual(handoff["component"]["kind"], "knowledge-pack")
        self.assertTrue(handoff["signing"]["required"])
        self.assertFalse(handoff["signing"]["envelopePresent"])
        self.assertFalse(handoff["signing"]["canonicalTrustAnchorPinned"])
        self.assertFalse(handoff["gates"]["publicationAllowed"])
        self.assertFalse(handoff["gates"]["installationAllowed"])
        self.assertFalse(handoff["gates"]["activationAllowed"])
        self.assertEqual(handoff["constraints"]["requestedCapabilities"], [])
        self.assertFalse(handoff["constraints"]["runtimeNetworkAllowed"])
        self.assertFalse(handoff["constraints"]["mutableHostAccessAllowed"])

        manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
        self.assertEqual(handoff["source"]["revision"], manifest["source"]["revision"])
        self.assertEqual(
            handoff["artifacts"]["content"]["sha256"],
            manifest["content_hash"],
        )
        self.assertEqual(
            handoff["artifacts"]["content"]["sizeBytes"],
            manifest["content_size"],
        )

    def test_writer_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "handoff.json"
            module.write_handoff(SOURCE, out)
            with self.assertRaisesRegex(module.HandoffError, "overwrite"):
                module.write_handoff(SOURCE, out)

    def test_source_with_extra_file_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            clone = Path(tmp) / "source"
            clone.mkdir()
            for name in ("manifest.json", "content.pack"):
                (clone / name).write_bytes((SOURCE / name).read_bytes())
            (clone / "envelope.json").write_text("{}\n", encoding="utf-8")
            with self.assertRaisesRegex(module.HandoffError, "exactly"):
                module.build_handoff(clone)


if __name__ == "__main__":
    unittest.main()
