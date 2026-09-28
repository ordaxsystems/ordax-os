from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOC = ROOT / "docs" / "contracts" / "native-identity-capability-refresh.md"


class NativeIdentityContractDocsTests(unittest.TestCase):
    def test_documentation_rejects_boot_time_or_connectivity_as_identity_authority(self):
        text = DOC.read_text(encoding="utf-8")
        self.assertIn("boot-time availability result is not retained as standing authority", text)
        self.assertIn("Browser connectivity alone never grants either capability", text)
        self.assertIn("identity-actions", text)
        self.assertIn("fail closed", text)
        self.assertIn("pagehide", text)


if __name__ == "__main__":
    unittest.main()
