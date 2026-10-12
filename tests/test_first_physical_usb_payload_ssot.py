"""Ensure the physical USB payload uses one release identity SSOT.

This is a source-contract regression check; it does not test physical USB I/O.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOW = ROOT / ".github" / "workflows" / "first-physical-usb-payload.yml"


class PhysicalUsbPayloadIdentityTests(unittest.TestCase):
    def test_release_identity_comes_only_from_authorization(self):
        source = WORKFLOW.read_text(encoding="utf-8")
        self.assertNotIn("inputs.release_source_commit", source)
        self.assertNotIn("inputs.envelope_url", source)
        self.assertNotIn("b924ff8d74d1761232381ae3f9604bba17497cfd", source)
        self.assertIn("id: canonical", source)
        self.assertIn("steps.canonical.outputs.release_source_commit", source)
        self.assertIn("operator/docs/contracts/physical-write-authorization.json", source)
        self.assertIn("operator/docs/evidence/canonical-v4-release-proof.json", source)
        self.assertIn("canonical_v4_release_proof_sha256", source)
        self.assertIn("CANONICAL_RELEASE_FROM_AUTHORIZATION_SSOT=PASS", source)
        self.assertIn("if auth.get('status') != 'authorized':", source)


if __name__ == "__main__":
    unittest.main()
