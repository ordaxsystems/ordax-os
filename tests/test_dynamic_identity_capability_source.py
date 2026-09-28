from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"


class DynamicIdentityCompositionTests(unittest.TestCase):
    def test_compositions_use_live_session_and_no_boot_time_identity_cache(self):
        for path in (NATIVE, WEB):
            text = path.read_text(encoding="utf-8")
            self.assertIn("const identitySession = createWebIdentitySession(window);", text)
            self.assertIn("await identitySession.refresh();", text)
            self.assertIn("const identityCredentials = createSameOriginIdentityCredentials(window);", text)
            self.assertNotIn("const identityAvailable =", text)
            self.assertNotIn("accountIdentityAvailable:", text)
            self.assertNotIn("syncSafeStateAvailable:", text)
            self.assertNotIn("identityAvailable ? createSameOriginIdentityCredentials", text)

        self.assertIn("identitySession,\n  });", NATIVE.read_text(encoding="utf-8"))
        self.assertIn(
            "createWebSurfaceHost(window, { identitySession })",
            WEB.read_text(encoding="utf-8"),
        )


if __name__ == "__main__":
    unittest.main()
