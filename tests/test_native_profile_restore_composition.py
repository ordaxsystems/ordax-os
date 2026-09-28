from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMPOSITION = ROOT / "system" / "composition" / "native" / "main.mjs"


class NativeProfileRestoreCompositionTests(unittest.TestCase):
    def test_profile_restore_is_optional_and_never_boot_critical(self):
        source = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeProfileActivationState", source)
        self.assertIn("createProfilePackRuntime", source)
        self.assertIn("LOCAL_PROFILE_PACK_MANIFESTS", source)
        self.assertIn(
            "persisted Profile restore disabled",
            source,
        )
        self.assertIn(
            "continuing without Profile composition",
            source,
        )
        self.assertIn('entry.state === "disabled-safe"', source)
        self.assertIn("profilePackRuntime?.dispose()", source)
        self.assertIn("profileActivationState?.dispose()", source)
        self.assertNotIn("await profilePackRuntime.activate", source)
        self.assertNotIn("profilePackRuntime.activate(", source)


if __name__ == "__main__":
    unittest.main()
