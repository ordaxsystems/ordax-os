from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system/surface/ui/system-overview-controls.mjs"
CATALOG = ROOT / "system/services/i18n/catalog/system.mjs"
PRESENTATION = ROOT / "system/services/update/presentation.mjs"


class SystemUpdateDetailsLocalizationTests(unittest.TestCase):
    def test_update_details_use_shared_localization_owner(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        block = controls.split("const renderUpdateDetails = (view) => {", 1)[1].split(
            "\n  const renderRecovery = (view) => {", 1
        )[0]
        for message_id in (
            "system.updates.kicker",
            "system.updates.title",
            "system.updates.unavailable",
            "system.updates.fact.delivery",
            "system.updates.fact.commit",
            "system.updates.fact.status",
            "system.updates.fact.phase",
            "system.updates.fact.applyMode",
            "system.updates.fact.transport",
            "system.updates.fact.boot",
            "system.updates.duration",
            "system.updates.attention.generic",
        ):
            self.assertIn(f't("{message_id}"', block)
        for hardcoded in (
            '"Atualização"',
            '"Entrega e recuperação"',
            '"Commit técnico"',
            '"Última verificação"',
            '"Commit bloqueado"',
            '"Progresso da Base"',
        ):
            self.assertNotIn(hardcoded, block)

    def test_update_semantics_are_localized_not_pretranslated(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        block = controls.split("const renderUpdateDetails = (view) => {", 1)[1].split(
            "\n  const renderRecovery = (view) => {", 1
        )[0]
        self.assertIn("overviewUpdateStatusMessageId(updateSnapshot.status)", block)
        self.assertIn("overviewUpdateModeMessageId(updateSnapshot.applyMode)", block)
        self.assertIn("UPDATE_PHASE_MESSAGE_IDS[updateSnapshot.phase]", block)
        self.assertIn("BASE_PHASE_MESSAGE_IDS[updateSnapshot.baseUpdatePhase]", block)
        self.assertIn("BOOT_MESSAGE_IDS[updateSnapshot.baseUpdatePhase]", block)
        self.assertIn("UPDATE_TRANSPORT_MESSAGE_IDS[updateSnapshot.updateTransport]", block)
        self.assertNotIn("updateStatusLabel(updateSnapshot.status)", block)
        self.assertNotIn("readableUpdatePhase(updateSnapshot.phase)", block)
        self.assertNotIn("readableUpdateMode(updateSnapshot.applyMode)", block)
        self.assertNotIn("readableBaseUpdatePhase(updateSnapshot.baseUpdatePhase)", block)
        self.assertNotIn("updateBootLabel(updateSnapshot)", block)
        self.assertNotIn("updateAttentionMessage(updateSnapshot)", block)

    def test_update_history_uses_shared_localization_owner(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        block = controls.split("const renderHistory = (view) => {", 1)[1].split(
            "\n  const renderCapabilities = (view) => {", 1
        )[0]
        for message_id in (
            "system.history.kicker",
            "system.history.title",
            "system.history.refresh",
            "system.history.reading",
            "system.history.applications",
            "system.history.result.applied",
            "system.history.result.rolledBack",
            "system.history.application.detail",
            "system.history.releases",
            "system.history.release.sha",
        ):
            self.assertIn(f't("{message_id}"', block)
        for hardcoded in (
            '"Registro"',
            '"Histórico de atualizações"',
            '"Aplicações neste notebook"',
            '"Entregas do OrdaX"',
            '"Aplicada"',
            '"Revertida"',
        ):
            self.assertNotIn(hardcoded, block)

    def test_components_about_capabilities_and_intelligence_are_localized(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        for marker in (
            't("system.components.scope.title")',
            't("system.components.scope.productionBoundary")',
            'componentChannelLabel(component.updateChannel)',
            'componentTitleLabel(component.id, component.title)',
            't("system.about.delivery.kicker")',
            't("system.components.versionsTitle")',
            't("system.capabilities.title")',
            't("system.intelligence.title")',
            't("system.intelligence.description"',
            't("system.intelligence.answer.provenance")',
        ):
            self.assertIn(marker, controls)
        for hardcoded in (
            '"OrdaX e aplicativos"',
            '"Versões e isolamento"',
            '"Capacidades desta execução"',
            '"Explicação local do estado"',
            '"Fonte: snapshot local de Sistema · autoridade: nenhuma"',
            '"Estado de componentes e saúde persistido neste dispositivo."',
        ):
            self.assertNotIn(hardcoded, controls)

    def test_runtime_failures_store_semantic_ids_not_rendered_copy(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        for state_name in (
            "metricsMessageId",
            "historyMessageId",
            "recoveryMessageId",
            "intelligenceMessageId",
        ):
            self.assertIn(state_name, controls)
        for assignment in (
            '"system.resources.readFailedPrevious"',
            '"system.resources.readFailed"',
            'historyMessageId = "system.history.readFailed"',
            'recoveryMessageId = "system.recovery.readFailed"',
            'intelligenceMessageId = "system.intelligence.message.analyzing"',
            'intelligenceMessageId = "system.intelligence.message.completed"',
            'intelligenceMessageId = "system.intelligence.message.failed"',
        ):
            self.assertIn(assignment, controls)
        self.assertNotIn('historyMessage = t(', controls)
        self.assertNotIn('recoveryMessage = t(', controls)

    def test_obsolete_pt_br_update_helpers_are_removed(self):
        presentation = PRESENTATION.read_text(encoding="utf-8")
        for helper in (
            "formatUpdateTimestamp",
            "readableUpdateMode",
            "readableBaseUpdatePhase",
            "readableUpdatePhase",
            "updateBootLabel",
            "updateAttentionMessage",
        ):
            self.assertNotIn(f"export function {helper}", presentation)
        for retained in ("updateStatusLabel", "updateSummaryLabel", "updateSummaryDetail"):
            self.assertIn(f"export function {retained}", presentation)

    def test_catalog_has_pt_br_and_en_us_update_details(self):
        catalog = CATALOG.read_text(encoding="utf-8")
        self.assertIn('"system.updates.title": "Entrega e recuperação"', catalog)
        self.assertIn('"system.updates.title": "Delivery and recovery"', catalog)
        self.assertIn('"system.updates.phase.healthWait": "Aguardando confirmação de saúde"', catalog)
        self.assertIn('"system.updates.phase.healthWait": "Waiting for health confirmation"', catalog)
        self.assertIn('"system.updates.boot.pendingActivation": "Base pendente de ativação"', catalog)
        self.assertIn('"system.updates.boot.pendingActivation": "Base pending activation"', catalog)
        self.assertEqual(catalog.count('"system.updates.attention.generic"'), 2)
        for key in ("system.updates.fact.transport", "system.updates.transport.gitMain", "system.updates.transport.signedRelease"):
            self.assertEqual(catalog.count(f'"{key}"'), 2)
        self.assertIn('"system.history.title": "Histórico de atualizações"', catalog)
        self.assertIn('"system.history.title": "Update history"', catalog)
        self.assertIn('"system.history.result.rolledBack": "Revertida"', catalog)
        self.assertIn('"system.history.result.rolledBack": "Rolled back"', catalog)
        self.assertIn('"system.components.scope.title": "OrdaX e aplicativos"', catalog)
        self.assertIn('"system.components.scope.title": "OrdaX and apps"', catalog)
        self.assertIn('"system.components.title.updateService": "Serviço de Atualização"', catalog)
        self.assertIn('"system.components.title.updateService": "Update Service"', catalog)
        self.assertIn('"system.capabilities.title": "Capacidades desta execução"', catalog)
        self.assertIn('"system.capabilities.title": "Capabilities in this run"', catalog)
        self.assertIn('"system.intelligence.title": "Explicação local do estado"', catalog)
        self.assertIn('"system.intelligence.title": "Local state explanation"', catalog)
        self.assertIn('"system.resources.readFailedPrevious":', catalog)
        self.assertEqual(catalog.count('"system.intelligence.message.completed"'), 2)


if __name__ == "__main__":
    unittest.main()
