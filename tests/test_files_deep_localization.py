"""Remove-first regression: product-owned Files localization cannot leak into OS."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class FilesLocalizationRemovalTests(unittest.TestCase):
    def test_no_bundled_files_localization_catalog(self):
        self.assertFalse((ROOT / "system/services/i18n/catalog/files.mjs").exists())
        self.assertFalse((ROOT / "system/apps/files").exists())
        source = (ROOT / "system/services/i18n/surface.mjs").read_text(encoding="utf-8")
        self.assertNotIn("FILES_SOURCE_MESSAGES", source)
        self.assertNotIn("FILES_ENGLISH_MESSAGES", source)

    def test_shared_system_localization_remains_available(self):
        for app in ("account", "settings", "system", "store"):
            self.assertTrue(
                (ROOT / f"system/services/i18n/catalog/{app}.mjs").is_file(),
                app,
            )


if __name__ == "__main__":
    unittest.main()
