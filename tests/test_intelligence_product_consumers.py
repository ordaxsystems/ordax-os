from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
NATIVE = ROOT / "system/composition/native/main.mjs"
NOTES_RUNTIME = ROOT / "system/apps/notes/runtime.mjs"
NOTES_UI = ROOT / "system/apps/notes/ui/workspace-controls.mjs"
NOTES_INTELLIGENCE = ROOT / "system/apps/notes/platform/intelligence-summary.mjs"
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

    def test_notes_consumes_public_intelligence_contract_without_private_services(self):
        runtime = NOTES_RUNTIME.read_text(encoding="utf-8")
        ui = NOTES_UI.read_text(encoding="utf-8")
        helper = NOTES_INTELLIGENCE.read_text(encoding="utf-8")
        notes_files = sorted((ROOT / "system/apps/notes").rglob("*.mjs"))
        notes_sources = "\n".join(
            path.read_text(encoding="utf-8")
            for path in notes_files
        )
        private_service_imports = []
        platform_services = (ROOT / "system/services").resolve()
        import_pattern = re.compile(
            r"""(?:from\s+|import\(\s*)["']([^"']+)["']"""
        )
        for path in notes_files:
            source = path.read_text(encoding="utf-8")
            for specifier in import_pattern.findall(source):
                if not specifier.startswith("."):
                    continue
                resolved = (path.parent / specifier).resolve()
                try:
                    resolved.relative_to(platform_services)
                except ValueError:
                    continue
                private_service_imports.append((path, specifier))

        self.assertIn("intelligence = null", runtime)
        self.assertIn("{ fileSpace, appActivation, intelligence }", runtime)
        self.assertIn("assertIntelligencePort", ui)
        self.assertIn("summarizeNoteWithIntelligence", ui)
        self.assertIn('from "../platform/intelligence-summary.mjs"', ui)
        self.assertIn("localization.getLocale()", ui)
        self.assertIn("assertIntelligencePort", helper)
        self.assertIn('intent: "summarize"', helper)
        self.assertIn('data.notesIntelligence', ui.replace("dataset", "data"))
        self.assertIn('"intelligence-summary"', ui)
        self.assertEqual(private_service_imports, [])
        self.assertNotIn("contracts/local-ai", notes_sources)
        self.assertNotIn("llama", notes_sources.lower())
        self.assertNotIn("qwen", notes_sources.lower())

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
