from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "system" / "apps" / "network"
CATALOG = ROOT / "system" / "apps" / "catalog.mjs"
COMPONENT_CATALOG = ROOT / "system" / "apps" / "component-catalog.mjs"
SHELL = ROOT / "system" / "surface" / "ui" / "desktop-shell.mjs"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.mjs"
DRAFT = ROOT / "system" / "services" / "professional-network" / "draft.mjs"
I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "network-app.mjs"
WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class NetworkSurfaceAppContractTests(unittest.TestCase):
    def text(self, path):
        return path.read_text(encoding="utf-8")

    def test_network_is_an_optional_independent_first_party_component(self):
        app = self.text(APP / "app.mjs")
        component = self.text(APP / "component.mjs")
        catalog = self.text(CATALOG)
        components = self.text(COMPONENT_CATALOG)

        self.assertIn('id: "network"', app)
        self.assertIn('extensionId: "network-workspace"', app)
        self.assertIn("networkApp", catalog)
        self.assertIn("networkComponent", components)
        self.assertIn('releaseMode: "git-app"', component)
        self.assertIn('criticality: "optional"', component)
        self.assertIn('failureDomain: "app"', component)
        self.assertIn('dependencies: ["surface-shell"]', component)
        self.assertNotIn('"network-service"', component)

    def test_surface_shows_network_but_does_not_fabricate_backend_state(self):
        shell = self.text(SHELL)
        controls = self.text(APP / "ui" / "workspace-controls.mjs")
        i18n = self.text(I18N)

        self.assertIn('railButton("network"', shell)
        self.assertIn('backend.dataset.networkBackend = "unavailable"', controls)
        self.assertIn("Nenhuma conversa fictícia", i18n)
        self.assertIn("não são inventados", i18n)
        self.assertNotIn("localStorage", controls)
        self.assertNotIn("fetch(", controls)

    def test_native_uses_real_identity_and_space_selection_while_web_is_honest(self):
        native = self.text(NATIVE)
        web = self.text(WEB)

        self.assertIn('componentId: "network"', native)
        self.assertIn('import("../../apps/network/runtime.mjs")', native)
        self.assertIn("identitySession,", native)
        self.assertIn("spaceSelection,", native)
        self.assertIn("networkComponent?.destroy()", native)

        self.assertIn('componentId: "network"', web)
        self.assertIn('import("../../apps/network/runtime.mjs")', web)
        self.assertIn("identitySession,", web)
        self.assertIn("spaceSelection: null", web)
        self.assertIn("networkComponent?.destroy()", web)

    def test_composer_preserves_focus_while_draft_body_updates(self):
        controls = self.text(APP / "ui" / "workspace-controls.mjs")
        self.assertIn('composer.dataset.networkConversation === target', controls)
        self.assertIn('documentObject.activeElement !== existingTextarea', controls)
        self.assertIn('existingTextarea.value !== desiredBody', controls)

    def test_draft_runtime_requires_explicit_retarget_and_clears_on_account_change(self):
        draft = self.text(DRAFT)
        self.assertIn("retargetToCurrentSpace()", draft)
        self.assertIn("draft.senderSpaceId === currentSpace.id", draft)
        self.assertIn("if (previousSubject !== nextSubject)", draft)
        self.assertIn("draft = null;", draft)
        selection_subscription = draft.split("const unsubscribeSelection", 1)[1].split("const port", 1)[0]
        self.assertNotIn("draft =", selection_subscription)

    def test_surface_ci_executes_network_app_regressions(self):
        workflow = self.text(WORKFLOW)
        self.assertGreaterEqual(workflow.count("tests/test_network_draft.mjs"), 2)
        self.assertGreaterEqual(workflow.count("tests/test_network_surface_app_contract.py"), 2)
        self.assertIn("node --test tests/test_network_draft.mjs", workflow)
        self.assertIn(
            "python -m unittest tests.test_network_surface_app_contract -v",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
