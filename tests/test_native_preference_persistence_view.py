"""Native Surface must expose only the canonical persistence confirmation."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class NativePreferencePersistenceViewTests(unittest.TestCase):
    def test_surface_uses_shared_ack_owner(self):
        surface = (ROOT / "system/surface/ui/surface.mjs").read_text(encoding="utf-8")
        runtime = (ROOT / "system/services/preferences/runtime.mjs").read_text(encoding="utf-8")
        self.assertIn('import { createPreferencePersistence } from "../../services/preferences/runtime.mjs";', surface)
        self.assertIn("const preferencePersistence = createPreferencePersistence(store);", surface)
        self.assertIn("return preferencePersistence.getSnapshot();", surface)
        self.assertIn("preferencePersistence.save(state.preferences)", surface)
        self.assertNotIn("store.save(state.preferences)", surface)
        self.assertIn("unsubscribePreferencePersistence();", surface)
        self.assertIn("preferencePersistence.dispose();", surface)
        self.assertIn("export function createPreferencePersistence(", runtime)
        self.assertIn("const persistence = createPreferencePersistence(store);", runtime)

    def test_native_settings_has_localized_host_confirmed_status(self):
        controls = (ROOT / "system/surface/ui/settings-overview-controls.mjs").read_text(encoding="utf-8")
        messages = (ROOT / "system/services/i18n/catalog/settings.mjs").read_text(encoding="utf-8")
        self.assertIn('typeof preferences.getPersistenceSnapshot === "function"', controls)
        self.assertIn("status.dataset.settingsPreferencePersistence = persistence;", controls)
        self.assertIn('status.setAttribute("aria-live", "polite");', controls)
        self.assertNotIn('"settings.preference.persistence.not-written"', messages)
        for state in ("pending", "saved", "session-only"):
            self.assertEqual(messages.count(f'"settings.preference.persistence.{state}":'), 2)


if __name__ == "__main__":
    unittest.main()
