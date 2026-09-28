import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "system" / "apps" / "intelligence"
SESSION = APP / "session.mjs"
CHAT = APP / "ui" / "chat-controls.mjs"
HANDOFF = ROOT / "system" / "contracts" / "intelligence-handoff.mjs"
CONTEXT_SHARE = ROOT / "system" / "contracts" / "intelligence-context-share.mjs"
CONTEXT_SHARE_RUNTIME = ROOT / "system" / "services" / "intelligence" / "context-sharing-runtime.mjs"
CONTRACT = ROOT / "docs" / "contracts" / "intelligence-chat-app.json"
APP_CATALOG = ROOT / "system" / "apps" / "catalog.mjs"
COMPONENT_CATALOG = ROOT / "system" / "apps" / "component-catalog.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.mjs"


class IntelligenceChatAppFoundationTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_app_is_local_consultative_client(self):
        app = self.text(APP / "app.mjs")
        component = self.text(APP / "component.mjs")
        runtime = self.text(APP / "runtime.mjs")
        session = self.text(SESSION)
        chat = self.text(CHAT)

        self.assertIn('id: "intelligence"', app)
        self.assertIn('requiredCapabilities: ["intelligence.system"]', app)
        self.assertIn('extensionId: "intelligence-chat"', app)
        self.assertIn('dependencies: ["surface-shell", "ordax-intelligence"]', component)
        self.assertIn('componentId: "intelligence"', runtime)
        self.assertIn("assertIntelligencePort", session)
        self.assertIn('intent: "ask"', session)
        self.assertIn("createIntelligenceContextCapsuleBuilder", session)
        self.assertIn("planner.plan", session)
        self.assertIn("createIntelligenceContextRegistry", runtime)
        self.assertIn("createFirstPartyAppCatalogContextSource", runtime)
        self.assertIn("createGrantedIntelligenceContextSource", runtime)
        self.assertIn('id: "project-selection"', runtime)
        self.assertIn("parseIntelligenceHandoffTarget", chat)
        self.assertIn("assertIntelligenceContextSharePort", chat)
        self.assertIn("contextShare?.take", chat)
        self.assertIn('lifecycle.getAppTarget("intelligence")', chat)
        self.assertIn('lifecycle.setAppTarget("intelligence", null)', chat)
        self.assertIn("{ authorizations }", chat)
        self.assertIn("contextShare?.revoke", chat)
        self.assertNotIn("fetch(", session)
        self.assertNotIn("local-ai", session)
        self.assertNotIn("fetch(", chat)
        self.assertNotIn("local-ai", chat)

    def test_chat_and_plan_modes_do_not_claim_web_tools_or_persistent_history(self):
        session = self.text(SESSION)
        catalog = self.text(ROOT / "system" / "services" / "i18n" / "catalog" / "intelligence.mjs")
        css = self.text(APP / "intelligence.css")

        self.assertIn("INTELLIGENCE_CHAT_MAX_MESSAGES", session)
        self.assertIn('history: "session-only"', session)
        self.assertIn("webGrounding: false", session)
        self.assertIn("externalProvider: false", session)
        self.assertIn("toolExecution: false", session)
        self.assertIn("Web desativada", catalog)
        self.assertIn("Sem envio automático para a nuvem", catalog)
        self.assertIn("Contexto do sistema", catalog)
        self.assertIn("Histórico somente nesta sessão", catalog)
        self.assertIn("Planejar", catalog)
        self.assertIn("não executa ações", catalog)
        self.assertIn("conteúdo privado do app não foi incluído", catalog)
        self.assertIn("autorizado para um único envio", catalog)
        self.assertIn('[data-app-extension="intelligence-chat"]', css)
        self.assertIn('.ordax-intelligence-chat-mode[data-active="true"]', css)
        self.assertIn('[data-kind="plan"]', css)

    def test_handoff_contract_is_typed_bounded_and_non_executable(self):
        handoff = self.text(HANDOFF)
        self.assertIn('INTELLIGENCE_HANDOFF_SCHEMA = "ordax.intelligence-handoff/1"', handoff)
        self.assertIn("validateIntelligenceTaskTarget", handoff)
        self.assertIn('new Set(["ask", "plan"])', handoff)
        self.assertIn('authority: "none"', handoff)
        self.assertIn("executable: false", handoff)
        self.assertIn("toolExecution: false", handoff)
        self.assertNotIn("context", handoff.lower())
        self.assertNotIn("requestedCapabilities", handoff)

    def test_request_context_share_is_ephemeral_and_not_encoded_in_handoff(self):
        share_contract = self.text(CONTEXT_SHARE)
        runtime = self.text(CONTEXT_SHARE_RUNTIME)
        chat = self.text(CHAT)

        self.assertIn('INTELLIGENCE_CONTEXT_SHARE_PORT_SCHEMA = "ordax.intelligence-context-share/1"', share_contract)
        self.assertIn("validateIntelligenceContextShareOffer", share_contract)
        self.assertIn('authority: "none"', share_contract)
        self.assertIn("executable: false", share_contract)
        self.assertIn("createIntelligenceContextGrantBroker", runtime)
        self.assertIn("createIntelligenceContextShare", runtime)
        self.assertIn("activeContextAuthorization", chat)
        self.assertIn("contextShare?.take", chat)
        self.assertIn("contextShare?.revoke", chat)
        self.assertNotIn("grantId", self.text(HANDOFF))

    def test_native_product_wiring_is_explicit_and_web_remains_unclaimed(self):
        app_catalog = self.text(APP_CATALOG)
        component_catalog = self.text(COMPONENT_CATALOG)
        native_main = self.text(NATIVE_MAIN)
        web_main = self.text(WEB_MAIN)

        self.assertIn('import { intelligenceApp } from "./intelligence/app.mjs"', app_catalog)
        self.assertIn("intelligenceApp,", app_catalog)
        self.assertIn('import { intelligenceAppComponent } from "./intelligence/component.mjs"', component_catalog)
        self.assertIn("intelligenceAppComponent,", component_catalog)
        self.assertIn('componentId: "intelligence"', native_main)
        self.assertIn('import("../../apps/intelligence/runtime.mjs")', native_main)
        self.assertIn("surfaceLifecycle: surface", native_main)
        self.assertIn("intelligence,", native_main)
        self.assertIn('reportClientDiagnostic("intelligence-runtime"', native_main)
        self.assertNotIn('import("../../apps/intelligence/runtime.mjs")', web_main)

    def test_contract_matches_current_native_integration_without_overclaim(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["status"], "native-integrated-beta")
        self.assertTrue(contract["integration"]["catalog_registered"])
        self.assertTrue(contract["integration"]["native_composition_mounted"])
        self.assertFalse(contract["integration"]["web_composition_mounted"])
        self.assertEqual(contract["context"]["registry_schema"], "ordax.intelligence-context-registry/1")
        self.assertEqual(contract["context"]["capsule_schema"], "ordax.intelligence-context-capsule/1")
        self.assertEqual(contract["context"]["handoff_schema"], "ordax.intelligence-handoff/1")
        self.assertEqual(contract["context"]["automatic_sources"], ["first-party-app-catalog"])
        self.assertFalse(contract["context"]["persistent_memory_automatic"])
        self.assertFalse(contract["context"]["private_app_state_automatic"])
        self.assertFalse(contract["context"]["user_prompt_can_grant_context"])
        self.assertTrue(contract["context"]["explicit_sources_require_caller_authorization"])
        self.assertFalse(contract["context"]["handoff_carries_private_content"])
        self.assertTrue(contract["capabilities"]["consultative_planning"])
        self.assertFalse(contract["capabilities"]["planning_is_executable"])
        self.assertFalse(contract["capabilities"]["planning_can_grant_capabilities"])
        self.assertFalse(contract["capabilities"]["web_grounding"])
        self.assertFalse(contract["capabilities"]["external_provider_runtime"])
        self.assertFalse(contract["capabilities"]["tool_execution"])
        self.assertFalse(contract["capabilities"]["file_mutation"])
        self.assertFalse(contract["capabilities"]["system_mutation"])
        self.assertEqual(contract["history"], "session-only")
        self.assertEqual(contract["authority"], "none")


if __name__ == "__main__":
    unittest.main()
