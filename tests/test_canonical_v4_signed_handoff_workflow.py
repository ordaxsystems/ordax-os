"""Offline, read-only proof uses the existing exact Windows Step 5 authority."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github/workflows/canonical-v4-signed-handoff-proof.yml"
ENVELOPE = ROOT / "docs/evidence/canonical-v4-signed-envelope-03f88eeaf382a59aaefbcf4943d0639d2730741b.json"


class CanonicalV4SignedHandoffWorkflowTests(unittest.TestCase):
    def test_readonly_user_initiated_runner_and_official_verifier(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", source)
        self.assertNotIn("  push:", source)
        self.assertNotIn("  pull_request:", source)
        self.assertIn("contents: read", source)
        self.assertIn("actions: read", source)
        self.assertIn("runs-on: windows-2025", source)
        self.assertIn("probe_active_operator_artifacts.py", source)
        self.assertIn("source_commit", source)
        self.assertIn("artifact_id", source)
        self.assertIn("meta.digest", source)
        self.assertIn("canonical-v4-signing-request-active.json", source)
        self.assertIn("tools/release-signing/windows/5-Verify-PortableV4-SignedHandoff.ps1", source)
        self.assertIn("signed-handoff-verification.json", source)
        self.assertIn("signed_payload_matches_manifest_bytes", source)
        self.assertIn("local_artifacts_match_signed_manifest", source)
        self.assertIn("physical_write_performed", source)
        self.assertIn("RELEASE_PUBLISHED=NO", source)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", source)
        self.assertNotIn("gh release create", source)
        self.assertNotIn("gh release upload", source)
        self.assertNotIn("PRIVATE_KEY", source)
        self.assertNotIn("contents: write", source)

    def test_only_public_envelope_stored_as_evidence(self):
        import json
        document = json.loads(ENVELOPE.read_text(encoding="utf-8"))
        self.assertEqual(set(document), {"$schema", "payload", "signature", "key_id"})
        self.assertEqual(document["$schema"], "prototype-ordax.release-envelope/1")
        self.assertEqual(document["key_id"], "ordax-prototype-release-v1")
        self.assertNotIn("PRIVATE KEY", ENVELOPE.read_text(encoding="utf-8"))
        self.assertLess(ENVELOPE.stat().st_size, 16 * 1024)


if __name__ == "__main__":
    unittest.main()
