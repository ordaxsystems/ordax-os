from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


class NativeIdentityRefreshSourceOfTruthTests(unittest.TestCase):
    def test_identity_session_drives_host_refresh_and_account_reconnect(self):
        text = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("identitySession.subscribe(() => host.refresh())", text)
        self.assertIn("await identitySession.refresh();", text)
        self.assertIn("await accountSync.refresh();", text)
        self.assertIn("const onOnline = () => void resumeAccountConnectivity();", text)
        self.assertIn("window.removeEventListener(\"online\", onOnline);", text)


if __name__ == "__main__":
    unittest.main()
