"""Windows Aura signed source-lock distribution owner: immutable proven bytes, no legacy download."""
from pathlib import Path
import json
import unittest

ROOT=Path(__file__).resolve().parents[1]
SHA="21680ead38fbbd34848826badb1ec30ee489b5a8c25fca29deb9d1da74e2cc29"

class WindowsAuraDistributionTests(unittest.TestCase):
    def test_os_distributes_historical_proven_artifact_without_rebuilding(self):
        lock=json.loads((ROOT/"system/services/local-ai/source-lock.json").read_text(encoding="utf-8"))
        artifact=lock["engine"]["windows_artifact"]
        self.assertEqual(artifact["distribution_repository"],"ordaxsystems/ordax-os")
        self.assertEqual(artifact["builder_repository"],"ordaxsystems/ordax-intelligence")
        self.assertEqual(artifact["builder_commit"],"70fc05715e1eb99a43d513caec9f4ac13fbcb1f3")
        self.assertEqual(artifact["proof_run_id"],43309006398)
        self.assertEqual(artifact["proof_bundle_sha256"],SHA)

    def test_windows_consumer_uses_os_release_only_and_hash_checks(self):
        workflow=(ROOT/".github/workflows/windows-desktop-dev.yml").read_text(encoding="utf-8")
        self.assertIn("$artifact.distribution_repository -cne 'ordaxsystems/ordax-os'",workflow)
        self.assertIn("https://github.com/$($artifact.distribution_repository)/releases/download/$tag/$asset",workflow)
        self.assertNotIn("https://github.com/$($artifact.builder_repository)/releases",workflow)
        self.assertIn("Get-FileHash -LiteralPath $archive -Algorithm SHA256",workflow)
        self.assertIn("$archiveHash -cne $proofBundle",workflow)
        self.assertIn("Fetch and stage exact proven offline Aura payload",workflow)

if __name__=="__main__":
    unittest.main()
