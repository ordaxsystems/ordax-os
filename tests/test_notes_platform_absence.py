from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]

REMOVED_PATHS = (
    "system/apps/notes",
    "system/contracts/notes-store.mjs",
    "system/contracts/notes-file-importer.mjs",
    "system/surface/ui/file-notes-action.mjs",
    "system/adapters/native/notes.mjs",
    "system/adapters/web/notes.mjs",
    "system/services/i18n/catalog/notes.mjs",
)

class NotesPlatformAbsenceTests(unittest.TestCase):
    def test_notes_product_source_is_absent_from_platform(self):
        for relative in REMOVED_PATHS:
            self.assertFalse((ROOT / relative).exists(), relative)

    def test_files_do_not_import_removed_notes_contract(self):
        controls = (ROOT / "system/surface/ui/file-space-controls.mjs").read_text(encoding="utf-8")
        self.assertNotIn("notes-file-importer", controls)
        self.assertNotIn("notesFileImporter", controls)
        self.assertNotIn("createNoteFromSelected", controls)

    def test_local_catalogs_do_not_import_notes_implementation(self):
        app_catalog = (ROOT / "system/apps/catalog.mjs").read_text(encoding="utf-8")
        component_catalog = (ROOT / "system/apps/component-catalog.mjs").read_text(encoding="utf-8")
        self.assertNotIn("./notes/", app_catalog)
        self.assertNotIn("./notes/", component_catalog)
        self.assertNotIn("notesApp", app_catalog)
        self.assertNotIn("notesComponent", component_catalog)

    def test_web_and_native_compositions_do_not_load_local_notes_runtime(self):
        for relative in (
            "system/composition/web/main.mjs",
            "system/composition/native/main.mjs",
        ):
            source = (ROOT / relative).read_text(encoding="utf-8")
            self.assertNotIn("apps/notes", source)
            self.assertNotIn("NotesStore", source)
            self.assertNotIn("notesComponent", source)

    def test_legacy_native_notes_endpoint_is_gone(self):
        host = (ROOT / "system/surface/runtime/native_host_server.py").read_text(encoding="utf-8")
        for forbidden in (
            "/__ordax/native/notes",
            "/var/lib/ordax/notes.json",
            "NOTES_PATH",
            "NOTES_FILE",
            "read_notes_payload",
            "write_notes_payload",
            "MAX_NOTES_PAYLOAD",
        ):
            self.assertNotIn(forbidden, host)

    def test_fixed_notes_launcher_is_gone(self):
        shell = (ROOT / "system/surface/ui/desktop-shell.mjs").read_text(encoding="utf-8")
        self.assertNotIn('railButton("notes"', shell)
        self.assertNotIn("ICONS.notes", shell)

    def test_notes_remains_known_as_on_demand_store_only_product(self):
        delivery = (ROOT / "system/services/apps/delivery-policy.mjs").read_text(encoding="utf-8")
        self.assertIn(
            '{ appId: "notes", deliveryClass: "on-demand", removable: true, discovery: "store-only" }',
            delivery,
        )
        contract = json.loads(
            (ROOT / "docs/contracts/first-party-app-delivery.json").read_text(encoding="utf-8")
        )
        self.assertIn("notes", contract["current_target_policy"]["on_demand"])
        self.assertFalse(contract["principles"]["store_ui_is_install_authority"])

if __name__ == "__main__":
    unittest.main()
