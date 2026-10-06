from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system/composition/native/main.mjs"



SYSTEM_UI = ROOT / "system/surface/ui/system-overview-controls.mjs"
CLIENT_ACTIONS = ROOT / "system/services/intelligence/client-actions.mjs"


class IntelligenceProductConsumerTests(unittest.TestCase):
    def test_native_composes_intelligence_once_and_injects_consumers(self):
        text = NATIVE.read_text(encoding="utf-8")
        self.assertEqual(text.count("createLocalAiRuntime({"), 1)
        self.assertEqual(text.count("createIntelligenceRuntime({ inferencePort: localAi })"), 1)
        self.assertIn("void localAi.probe();", text)
        self.assertIn("intelligenceSystemAvailable = true", text)
        self.assertIn("componentManager.setCurrentHealth(", text)
        self.assertIn('"local-ai-service"', text)
        self.assertIn('"ordax-intelligence"', text)
        self.assertIn("intelligence,", text)


    def test_native_wires_verified_app_semantics_without_parallel_authority(self):
        text = NATIVE.read_text(encoding="utf-8")

        self.assertIn("createNativeVerifiedComponentPackageSource", text)
        self.assertIn("loadVerifiedFirstPartyApplicationSemantics", text)
        self.assertIn("EXTERNAL_FIRST_PARTY_SEMANTIC_APP_IDS", text)
        self.assertIn("overlayVerifiedFirstPartyApplications", text)
        self.assertIn("listFirstPartyApps()", text)
        self.assertIn("createApplicationIntelligenceAwareness", text)
        self.assertIn("createApplicationContextIntelligence", text)
        self.assertIn("actionCapabilityRegistryPort: null", text)

        base_index = text.index("const intelligence = createIntelligenceRuntime")
        profile_index = text.index("const profileContentIntelligence =")
        application_index = text.index("const applicationContextIntelligence =")
        memory_index = text.index("const selectedSpaceIntelligence =")
        self.assertLess(base_index, profile_index)
        self.assertLess(profile_index, application_index)
        self.assertLess(application_index, memory_index)

        health_block = text[
            text.index("const updateIntelligenceHealth ="):
            text.index("void localAi.probe();") + len("void localAi.probe();")
        ]
        self.assertIn("intelligence.subscribe(updateIntelligenceHealth)", health_block)
        self.assertNotIn("applicationContextIntelligence.subscribe", health_block)
        self.assertNotIn("profileContentIntelligence.subscribe", health_block)

        self.assertIn("intelligencePort: profileContentIntelligence", text)
        self.assertIn("intelligencePort: applicationContextIntelligence", text)
        self.assertNotIn("/__ordax/native/app-intelligence-manifest", text)
        self.assertNotIn("/__ordax/native/app-intelligence-awareness", text)

    def test_system_explanation_is_consultative_and_provider_neutral(self):
        ui = SYSTEM_UI.read_text(encoding="utf-8")
        actions = CLIENT_ACTIONS.read_text(encoding="utf-8")
        self.assertIn("assertIntelligencePort", ui)
        self.assertIn("explainSystemStateWithIntelligence", ui)
        self.assertIn("systemIntelligenceExplain", ui)
        self.assertIn('t("system.intelligence.answer.provenance")', ui)
        self.assertIn('"ordax-system-local-snapshot"', actions)
        self.assertIn('intent: "diagnose"', actions)
        self.assertNotIn("services/local-ai", ui)
        self.assertNotIn("contracts/local-ai", ui)
        self.assertNotIn("llama", ui.lower())
        self.assertNotIn("qwen", ui.lower())


if __name__ == "__main__":
    unittest.main()
