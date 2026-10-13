from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEB_COMPOSITION = ROOT / "system" / "composition" / "web" / "main.tsx"
WEB_RUNTIME = ROOT / "system" / "adapters" / "web" / "runtime.mjs"


class WebIdentityCapabilityRefreshTests(unittest.TestCase):
    def test_node_dynamic_identity_capabilities(self):
        subprocess.run(
            ["node", "--test", "tests/test_web_identity_capability_refresh.mjs"],
            cwd=ROOT,
            check=True,
        )

    def test_web_composition_uses_live_identity_authority_and_cleans_up(self):
        composition = WEB_COMPOSITION.read_text(encoding="utf-8")
        runtime = WEB_RUNTIME.read_text(encoding="utf-8")

        self.assertIn("readAccountIdentityAvailable = () => false", runtime)
        self.assertIn("readSyncSafeStateAvailable = () => false", runtime)
        self.assertIn("refresh: notify", runtime)
        self.assertNotIn("const identityAvailable =", composition)
        self.assertNotIn("identityAvailable ? createSameOriginIdentityCredentials", composition)


if __name__ == "__main__":
    unittest.main()
