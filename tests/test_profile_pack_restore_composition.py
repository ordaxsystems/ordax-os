from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"


class ProfilePackRestoreCompositionTests(unittest.TestCase):
    def test_native_boot_uses_optional_same_origin_profile_restore_metadata(self):
        source = NATIVE.read_text(encoding="utf-8")
        self.assertIn("loadBundledProfilePacks", source)
        self.assertIn("createNativeProfileActivationState", source)
        self.assertIn("resolveProfilePackRestore", source)
        self.assertIn('"OrdaX bundled Profile manifests unavailable"', source)
        self.assertIn('"OrdaX native Profile activation state unavailable"', source)
        self.assertIn("entry.state === \"disabled-safe\"", source)
        self.assertIn("capability application remains disabled", source)

    def test_restore_does_not_expose_mutation_or_become_boot_critical(self):
        source = NATIVE.read_text(encoding="utf-8")
        self.assertNotIn("activate_profile(", source)
        self.assertNotIn("rollback_profile(", source)
        self.assertNotIn("profileRestore.activate(", source)
        self.assertNotIn("profileRestore.rollback(", source)
        self.assertIn("try {", source)
        self.assertIn('console.warn("OrdaX Profile restore metadata unavailable"', source)


if __name__ == "__main__":
    unittest.main()
