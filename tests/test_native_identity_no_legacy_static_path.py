from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


class NativeIdentityNoLegacyStaticPathTests(unittest.TestCase):
    def test_static_boot_identity_capability_path_is_absent(self):
        runtime = RUNTIME.read_text(encoding="utf-8")
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertNotIn("accountIdentityAvailable = false", runtime)
        self.assertNotIn("syncSafeStateAvailable = false", runtime)
        self.assertNotIn("accountIdentityAvailable: identityAvailable", composition)
        self.assertNotIn("syncSafeStateAvailable: identityAvailable", composition)
        self.assertNotIn("identityAvailable ? createSameOriginIdentityCredentials", composition)


if __name__ == "__main__":
    unittest.main()
