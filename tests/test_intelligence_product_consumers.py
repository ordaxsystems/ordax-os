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
        self.assertIn("createLocalAiProbeSupervisor", text)
        self.assertIn("localAiProbeSupervisor.start();", text)
        self.assertIn("localAiProbeSupervisor.dispose();", text)
        self.assertNotIn("void localAi.probe();", text)
        self.assertIn("intelligenceSystemAvailable = true", text)
        self.assertIn("componentManager.setCurrentHealth(", text)
        self.assertIn('"local-ai-service"', text)
        self.assertIn('"ordax-intelligence"', text)
        self.assertIn("intelligence,", text)
        self.assertIn("createNativeVerifiedComponentPackageSource", text)
        self.assertIn("loadVerifiedFirstPartyApplicationSemantics", text)
        self.assertIn("createApplicationIntelligenceAwareness", text)
        self.assertIn("createApplicationContextIntelligence", text)
        self.assertIn("createApplicationActionCapabilityRegistry", text)
        self.assertIn("const verifiedActionCapabilities = verifiedAppSemantics.flatMap(", text)
        self.assertIn("(entry) => entry.actionManifest?.capabilities ?? []", text)
        self.assertIn("actionCapabilityRegistryPort: appActionCapabilities", text)
        self.assertIn("listBundledFirstPartyIntelligenceManifests", text)
        self.assertIn("createApplicationSemanticRouter", text)
        self.assertIn("semanticRouterPort: appSemanticRouter", text)
        self.assertIn("const verifiedAppSemanticsPromise = optionalNativeProbe(", text)
        self.assertIn("const appAwareIntelligence = createApplicationContextIntelligence({", text)
        self.assertIn("intelligencePort: appAwareIntelligence", text)
        self.assertIn(": appAwareIntelligence;", text)


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
