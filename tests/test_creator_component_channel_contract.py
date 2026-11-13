#!/usr/bin/env python3
"""Regress the Creator component candidate boundary after canonical trust promotion."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/creator-component-channel.json").read_text(encoding="utf-8")
)


class CreatorComponentChannelContractTests(unittest.TestCase):
    def test_candidate_is_enabled_but_publication_remains_blocked(self):
        self.assertEqual(
            CONTRACT["$schema"],
            "prototype-ordax.creator-component-channel/1",
        )
        self.assertEqual(CONTRACT["status"], "candidate-enabled")
        self.assertEqual(CONTRACT["implementation_repository"], "ordaxsystems/ordax-creator")
        self.assertEqual(CONTRACT["publisher_repository"], "ordaxsystems/ordax-os")
        self.assertEqual(
            CONTRACT["implementation_source_contract"],
            "docs/contracts/native-release-assembly.json#creator_source",
        )
        self.assertEqual(
            CONTRACT["source_repository_semantics"],
            "publisher-recipe-source-legacy-v1",
        )
        self.assertEqual(CONTRACT["source_repository"], CONTRACT["publisher_repository"])
        self.assertTrue(CONTRACT["canonical_public_trust_required"])
        self.assertTrue(CONTRACT["ed25519_signature_required"])
        self.assertFalse(CONTRACT["publish_allowed"])
        self.assertFalse(CONTRACT["raw_disk_writer_allowed"])
        self.assertFalse(CONTRACT["development_fallback_allowed_in_official_creator"])
        self.assertFalse(CONTRACT["publisher_private_key_in_consumer"])
        self.assertFalse(CONTRACT["publisher_private_key_in_ci_artifact"])
        self.assertFalse(CONTRACT["unsigned_manifest_may_activate_official_component"])


if __name__ == "__main__":
    unittest.main()
