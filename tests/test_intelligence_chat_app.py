import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "system" / "apps" / "intelligence"
CHAT = APP / "ui" / "chat-controls.mjs"
CONTRACT = ROOT / "docs" / "contracts" / "intelligence-chat-app.json"


class IntelligenceChatAppFoundationTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_app_is_local_consultative_client(self):
        app = self.text(APP / "app.mjs")
        component = self.text(APP / "component.mjs")
        runtime = self.text(APP / "runtime.mjs")
        chat = self.text(CHAT)

        self.assertIn('id: "intelligence"', app)
        self.assertIn('requiredCapabilities: ["intelligence.system"]', app)
        self.assertIn('extensionId: "intelligence-chat"', app)
        self.assertIn('dependencies: ["surface-shell", "ordax-intelligence"]', component)
        self.assertIn('componentId: "intelligence"', runtime)
        self.assertIn("assertIntelligencePort", chat)
        self.assertIn('intent: "ask"', chat)
        self.assertIn("context: []", chat)
        self.assertNotIn("fetch(", chat)
        self.assertNotIn("local-ai", chat)
        self.assertNotIn("shell", chat.lower().replace("stylesheet", ""))

    def test_chat_does_not_claim_web_tools_or_persistent_history(self):
        chat = self.text(CHAT)
        catalog = self.text(ROOT / "system" / "services" / "i18n" / "catalog" / "intelligence.mjs")
        css = self.text(APP / "intelligence.css")

        self.assertIn("MAX_SESSION_MESSAGES", chat)
        self.assertIn("messages = []", chat)
        self.assertIn("Web desativada", catalog)
        self.assertIn("Sem envio automático para a nuvem", catalog)
        self.assertIn("Histórico somente nesta sessão", catalog)
        self.assertIn('[data-app-extension="intelligence-chat"]', css)

    def test_staging_contract_does_not_overclaim_product_wiring(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "source-foundation")
        self.assertFalse(contract["integration"]["catalog_registered"])
        self.assertFalse(contract["integration"]["native_composition_mounted"])
        self.assertFalse(contract["capabilities"]["web_grounding"])
        self.assertFalse(contract["capabilities"]["external_provider_runtime"])
        self.assertFalse(contract["capabilities"]["tool_execution"])
        self.assertEqual(contract["history"], "session-only")


if __name__ == "__main__":
    unittest.main()
