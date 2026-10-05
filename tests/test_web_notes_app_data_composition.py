#!/usr/bin/env python3
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"


class WebNotesAppDataCompositionTest(unittest.TestCase):
    def setUp(self):
        self.source = WEB_MAIN.read_text(encoding="utf-8")

    def test_notes_port_is_owned_by_web_platform_composition(self):
        self.assertIn('createWebAppDataStore', self.source)
        self.assertIn('createBoundAppDataPort', self.source)
        self.assertIn('appId: "notes"', self.source)
        self.assertIn('publisherId: "ordax-official"', self.source)
        self.assertIn('quotaBytes: 64 * 1024 * 1024', self.source)
        self.assertIn('maxKeys: 2048', self.source)
        self.assertIn('appData: notesAppData', self.source)

    def test_legacy_web_store_remains_seed_bridge_during_migration_window(self):
        self.assertIn('createStore: () => createWebNotesStore(window)', self.source)
        self.assertIn('let notesAppData = null', self.source)
        self.assertIn('OrdaX Notes App Data unavailable on Web', self.source)

    def test_app_data_identity_is_not_supplied_by_notes_product_source(self):
        notes_root = ROOT / "system" / "apps" / "notes"
        combined = "\n".join(
            path.read_text(encoding="utf-8", errors="ignore")
            for path in notes_root.rglob("*")
            if path.is_file() and path.suffix in {".mjs", ".json"}
        )
        self.assertNotIn('publisherId: "ordax-official"', combined)
        self.assertNotIn("/__ordax/native/app-data/", combined)


if __name__ == "__main__":
    unittest.main()
