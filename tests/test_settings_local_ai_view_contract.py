"""Source-contract regressions for the Store-to-Settings Local AI navigation.

These tests assert owner boundaries, not browser layout appearance. Chromium
Surface Candidate separately compiles and smokes the UI.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SETTINGS = ROOT / "system/surface/ui/settings-overview-controls.mjs"
STORE = ROOT / "system/surface/ui/store-overview-controls.mjs"
NATIVE = ROOT / "system/composition/native/main.mjs"
SETTINGS_MESSAGES = ROOT / "system/services/i18n/catalog/settings.mjs"
STORE_MESSAGES = ROOT / "system/services/i18n/catalog/store.mjs"
SETTINGS_APP = ROOT / "system/apps/settings/ai/manifest.mjs"


class SettingsLocalAiViewTests(unittest.TestCase):
    def test_uses_existing_system_local_ai_port_and_candidate_identity_distinctly(self):
        text = SETTINGS.read_text(encoding="utf-8")
        self.assertIn('id: "intelligence", messageId: "settings.section.intelligence"', text)
        self.assertIn("assertLocalAiPort(localAiPort)", text)
        self.assertIn("validateLocalAiSnapshot(localAi.getSnapshot())", text)
        self.assertIn("localAi?.subscribe((snapshot)", text)
        self.assertIn("unsubscribeLocalAi?.()", text)
        self.assertIn("BUNDLED_LOCAL_AI_MODEL_CANDIDATE", text)
        self.assertIn("localAiSnapshot.modelId", text)
        self.assertIn("localAiSnapshot.engineId", text)
        self.assertIn('["ready", "busy"].includes(state)', text)
        self.assertIn('t("settings.intelligence.notActive")', text)
        self.assertNotIn("localAi.generate(", text)
        self.assertNotIn("localAi.probe(", text)

    def test_navigation_uses_authorized_app_activation_not_inference_authority(self):
        settings = SETTINGS.read_text(encoding="utf-8")
        store = STORE.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        self.assertIn('activationPort.publish({ appId: "store", target: "models" })', settings)
        self.assertIn('activation?.subscribe((next) => {', store)
        self.assertIn('next.appId !== "store" || !VIEWS.includes(next.target)', store)
        self.assertIn('activeView = next.target;', store)
        self.assertIn('modelReadState === "idle"', store)
        self.assertIn("      localAi,\n    );", native)
        self.assertEqual(native.count("      localAi,\n    );"), 2)
        self.assertIn("mountStoreOverviewControls(", native)
        self.assertNotIn('requestLifecycle({ appId: "model"', settings + store)

    def test_locale_strings_have_matching_keys_for_new_section(self):
        settings = SETTINGS_MESSAGES.read_text(encoding="utf-8")
        english = settings.split("export const SETTINGS_ENGLISH_MESSAGES", 1)[1]
        portuguese = settings.split("export const SETTINGS_ENGLISH_MESSAGES", 1)[0]
        for key in (
            "settings.section.intelligence",
            "settings.section.intelligence.subtitle",
            "settings.intelligence.pinned",
            "settings.intelligence.active",
            "settings.intelligence.notActive",
            "settings.intelligence.selectionPolicy",
            "settings.intelligence.openStoreModels",
            *("settings.intelligence.state." + state
              for state in ("ready", "busy", "error", "stopped", "unavailable")),
        ):
            with self.subTest(key=key):
                self.assertIn(f'"{key}":', portuguese)
                self.assertIn(f'"{key}":', english)
        self.assertIn("inteligência", SETTINGS_APP.read_text(encoding="utf-8"))
        self.assertIn('"store.navigation.models":', STORE_MESSAGES.read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
