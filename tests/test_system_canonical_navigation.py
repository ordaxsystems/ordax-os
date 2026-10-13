from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SYSTEM = ROOT / "system" / "surface" / "ui" / "system-overview-controls.mjs"
UPDATE = ROOT / "system" / "surface" / "ui" / "update-controls.mjs"
PRESENTATION = ROOT / "system" / "services" / "update" / "presentation.mjs"
COMPONENT_PRESENTATION = ROOT / "system" / "services" / "components" / "update-presentation.mjs"
SURFACE = ROOT / "system" / "surface" / "ui" / "surface.mjs"
CSS = ROOT / "system" / "surface" / "ui" / "system.css"
NATIVE = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB = ROOT / "system" / "composition" / "web" / "main.tsx"
SYSTEM_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "system.mjs"


class SystemCanonicalNavigationTests(unittest.TestCase):
    def test_system_owns_validated_internal_sections_without_second_router(self):
        system = SYSTEM.read_text(encoding="utf-8")
        for section_id in ("overview", "updates", "storage", "diagnostics", "about"):
            self.assertIn(f'id: "{section_id}"', system)
        self.assertIn("validSystemSection", system)
        self.assertIn("data.systemSection", system.replace("dataset", "data"))
        self.assertIn('aria-current', system)
        self.assertIn('activation.appId === "system"', system)
        self.assertIn("validSystemSection(activation.target)", system)
        self.assertNotIn("sectionId", system)
        self.assertNotIn("detailId", system)

    def test_overview_summary_uses_structured_localized_presentation(self):
        system = SYSTEM.read_text(encoding="utf-8")
        catalog = SYSTEM_I18N.read_text(encoding="utf-8")
        self.assertIn('t("system.overview.aria")', system)
        self.assertIn("overviewUpdateSummaryMessageId", system)
        self.assertIn("overviewUpdateModeMessageId", system)
        self.assertIn("localization.getLocale()", system)
        self.assertIn('"system.overview.card.productVersion": "Prototype version"', catalog)
        self.assertIn('"system.overview.update.status.rolledBack": "Update rolled back"', catalog)
        self.assertIn('"system.overview.update.summary.activationReady": "Base ready for activation"', catalog)
        summary = system.split("const renderSummary = (view) => {", 1)[1].split("\n  const renderMemory = (view) => {", 1)[0]
        header = system.split("const renderHeader = (view) => {", 1)[1].split("\n  const renderSectionNavigation = (view) => {", 1)[0]
        for forbidden in (
            '"Resumo do sistema"', '"Versão do protótipo"', '"Entrega observada"',
            '"Gerenciamento de entrega não exposto neste host"', '"Atenção na atualização"',
            '"Sem conexão"', '"Surface ativa"',
        ):
            self.assertNotIn(forbidden, summary + header)

    def test_update_footer_is_only_an_accelerator_to_canonical_system_updates(self):
        update = UPDATE.read_text(encoding="utf-8")
        self.assertIn('activationPort.publish({ appId: "system", target: "updates" })', update)
        self.assertIn('"system.updateShortcut.aria"', update)
        self.assertNotIn("data.updateMenu", update.replace("dataset", "data"))
        self.assertNotIn("ordax-update-menu", update)
        self.assertNotIn("targetSha", update)
        self.assertNotIn("lastError", update)
        self.assertNotIn("lastAppliedAt", update)

    def test_surface_activation_channel_opens_target_app_before_owner_handles_target(self):
        surface = SURFACE.read_text(encoding="utf-8")
        system = SYSTEM.read_text(encoding="utf-8")
        self.assertIn("activationPort?.subscribe", surface)
        self.assertIn('appId: activation.appId,', surface)
        self.assertIn('target: activation.target,', surface)
        self.assertIn("unsubscribeActivation?.()", surface)
        self.assertIn("activationPort.publish({ appId, target })", surface)
        self.assertIn('lifecycle.getAppTarget("system")', system)
        self.assertIn('activationPort.publish({ appId: "system", target: nextSection })', system)

    def test_update_presentation_has_one_shared_owner(self):
        update = UPDATE.read_text(encoding="utf-8")
        system = SYSTEM.read_text(encoding="utf-8")
        presentation = PRESENTATION.read_text(encoding="utf-8")
        self.assertIn("services/update/presentation.mjs", update)
        self.assertIn("services/update/presentation.mjs", system)
        for marker in ("updateIsAlerting", "updateStatusLabel", "updateSummaryLabel", "updateSummaryDetail"):
            self.assertIn(marker, presentation)
        self.assertIn("America/Bahia", system)
        self.assertIn("UPDATE_PHASE_MESSAGE_IDS", system)
        self.assertIn("overviewUpdateModeMessageId", system)

    def test_component_update_scopes_are_visible_in_system_updates(self):
        system = SYSTEM.read_text(encoding="utf-8")
        component_presentation = COMPONENT_PRESENTATION.read_text(encoding="utf-8")
        self.assertIn("services/components/update-presentation.mjs", system)
        self.assertIn("createComponentUpdateScopes(componentSnapshot)", system)
        self.assertIn("renderComponentUpdateScopes(view)", system)
        self.assertIn('"system.components.scope.system"', system)
        self.assertIn('"system.components.scope.applications"', system)
        self.assertIn('"system.components.stage.beta"', system)
        self.assertIn("componentChannelLabel(component.updateChannel)", system)
        self.assertIn('t("system.components.scope.productionBoundary")', system)
        for marker in ('"development-git"', '"system-bundle"', '"independent-component"'):
            self.assertIn(marker, component_presentation)

    def test_transaction_details_remain_in_system_updates(self):
        system = SYSTEM.read_text(encoding="utf-8")
        for marker in ("targetSha", "attemptId", "lastError", "lastAppliedAt", "rejectedSha", "runtimeSurfaceSha"):
            self.assertIn(marker, system)
        for message_id in ("system.updates.fact.attempt", "system.updates.fact.diagnostic"):
            self.assertIn(f't("{message_id}")', system)

    def test_system_sections_expose_only_real_existing_data_owners(self):
        system = SYSTEM.read_text(encoding="utf-8")
        catalog = SYSTEM_I18N.read_text(encoding="utf-8")
        for section in ("overview", "updates", "storage", "diagnostics", "about"):
            self.assertIn(f'activeSection === "{section}"', system)
        self.assertNotIn('id: "recovery"', system)
        self.assertNotIn('id: "energy"', system)
        self.assertIn('t("system.about.delivery.unavailable")', system)
        self.assertIn('t("system.resources.storage.scope")', system)
        self.assertIn('"system.resources.storage.scope":', catalog)
        self.assertIn("Não representa o disco físico inteiro", catalog)

    def test_navigation_is_shared_responsive_and_wired_in_native_composition(self):
        css = CSS.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        web = WEB.read_text(encoding="utf-8")
        self.assertIn(".ordax-system-navigation {", css)
        self.assertIn(".ordax-system-navigation-item", css)
        self.assertIn('overflow-x: auto', css)
        self.assertIn("mountUpdateControls(root, updateWatcher, appActivation, surface)", native)
        self.assertIn("updateHistory,\n    appActivation,", native)


if __name__ == "__main__":
    unittest.main()
