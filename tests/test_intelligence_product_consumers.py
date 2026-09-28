from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system/composition/native/main.mjs"
NATIVE_SYSTEM_ANALYSIS = ROOT / "system/composition/native/intelligence-system-analysis.mjs"
NOTES_RUNTIME = ROOT / "system/apps/notes/runtime.mjs"
NOTES_UI = ROOT / "system/apps/notes/ui/workspace-controls.mjs"
NOTES_HANDOFF = ROOT / "system/apps/notes/ui/intelligence-handoff-controls.mjs"
SYSTEM_UI = ROOT / "system/surface/ui/system-overview-controls.mjs"
CLIENT_ACTIONS = ROOT / "system/services/intelligence/client-actions.mjs"
CONTEXT_SOURCES = ROOT / "system/services/intelligence/first-party-context-sources.mjs"


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
        self.assertIn("createNativeIntelligenceSystemAnalysis({", text)
        self.assertIn("intelligenceSystemAnalysis.intelligence", text)
        self.assertIn("intelligenceSystemAnalysis.dispose();", text)
        self.assertIn("intelligence,", text)

    def test_native_system_analysis_uses_governed_read_only_observation_stack(self):
        text = NATIVE_SYSTEM_ANALYSIS.read_text(encoding="utf-8")
        self.assertIn("createIntelligenceAuditJournal", text)
        self.assertIn("createIntelligenceCapabilityBridge", text)
        self.assertIn("createIntelligenceToolAuthorizationBroker", text)
        self.assertIn("createIntelligenceReadOnlyToolExecutor", text)
        self.assertIn("createIntelligenceSystemObserver", text)
        self.assertIn('"observe-system-metrics"', text)
        self.assertIn('"observe-network-status"', text)
        self.assertIn('"observe-power-status"', text)
        self.assertIn("observer.observe()", text)
        self.assertIn('request.intent !== "diagnose"', text)
        self.assertNotIn("network.management", text)
        self.assertNotIn("power-actions", text)
        self.assertNotIn("shell", text.lower())

    def test_notes_consumes_intelligence_not_local_ai(self):
        runtime = NOTES_RUNTIME.read_text(encoding="utf-8")
        ui = NOTES_UI.read_text(encoding="utf-8")
        handoff = NOTES_HANDOFF.read_text(encoding="utf-8")
        actions = CLIENT_ACTIONS.read_text(encoding="utf-8")
        sources = CONTEXT_SOURCES.read_text(encoding="utf-8")

        self.assertIn("intelligence = null", runtime)
        self.assertIn("getDefaultIntelligenceContextSharingRuntime", runtime)
        self.assertIn("mountNotesIntelligenceHandoffControls", runtime)
        self.assertIn("assertIntelligencePort", ui)
        self.assertIn("summarizeDocumentWithIntelligence", ui)
        self.assertIn('data.notesIntelligence', ui.replace("dataset", "data"))
        self.assertIn('"intelligence-summary"', ui)
        self.assertIn("assertIntelligenceContextSharePort", handoff)
        self.assertIn("createDocumentIntelligenceContext", handoff)
        self.assertIn('sourceId: NOTE_CONTEXT_SOURCE_ID', handoff)
        self.assertIn('sourceAppId: "notes"', handoff)
        self.assertIn('kind: "document"', handoff)
        self.assertIn('appId: "intelligence"', handoff)
        self.assertIn('provenance: `ordax:notes:${note.id}:user-authorized-selection`', handoff)
        self.assertIn("createDocumentIntelligenceContext", actions)
        self.assertIn('id: "note-selection"', sources)
        self.assertNotIn("reference.path", handoff)
        self.assertNotIn("requestedCapabilities", handoff)
        self.assertNotIn("local-ai", runtime)
        self.assertNotIn("services/local-ai", ui)
        self.assertNotIn("contracts/local-ai", ui)
        self.assertNotIn("llama", runtime.lower())
        self.assertNotIn("llama", ui.lower())
        self.assertNotIn("qwen", runtime.lower())
        self.assertNotIn("qwen", ui.lower())

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
