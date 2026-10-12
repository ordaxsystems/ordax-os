from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE_I18N = ROOT / "system/services/i18n/surface.mjs"
BOOT_I18N = ROOT / "system/services/i18n/catalog/boot.mjs"
POWER_I18N = ROOT / "system/services/i18n/catalog/power.mjs"
SYSTEM_I18N = ROOT / "system/services/i18n/catalog/system.mjs"
HOME_CONTINUATION = ROOT / "system/surface/ui/home-continuation.mjs"
HOME_PENDING = ROOT / "system/surface/ui/home-pending.mjs"
POWER = ROOT / "system/surface/ui/power-controls.mjs"
UPDATES = ROOT / "system/surface/ui/update-controls.mjs"
BOOT = ROOT / "system/surface/ui/boot-screen.mjs"
DESKTOP = ROOT / "system/surface/ui/desktop-shell.mjs"
NATIVE_MAIN = ROOT / "system/composition/native/main.mjs"
WEB_MAIN = ROOT / "system/composition/web/main.tsx"
NATIVE_HTML = ROOT / "system/composition/native/index.html"
WEB_HTML = ROOT / "system/composition/web/index.html"


class SurfaceResidualLocalizationTests(unittest.TestCase):
    def test_home_continuation_is_semantic_and_locale_aware(self):
        source = HOME_CONTINUATION.read_text(encoding="utf-8")
        for marker in (
            "assertSurfaceRenderLifecycle",
            "localization.getLocale()",
            "localization.subscribe",
            '"home.continuation.heading"',
            '"home.continuation.projectDetail"',
            '"home.continuation.recentDetail"',
            '"home.continuation.projectAction"',
            '"home.continuation.recentAction"',
        ):
            self.assertIn(marker, source)
        for hardcoded in (
            '"Continuar trabalho"',
            '"atividade desconhecida"',
            '" · somente nesta sessão"',
            '"Mostrar ${entry.name} em Arquivos"',
        ):
            self.assertNotIn(hardcoded, source)

    def test_home_pending_is_semantic_and_live_rerenderable(self):
        source = HOME_PENDING.read_text(encoding="utf-8")
        for marker in (
            "assertSurfaceRenderLifecycle",
            "localization.subscribe",
            '"home.pending.heading"',
            '"home.pending.notifications.title.one"',
            '"home.pending.notifications.detail.dnd"',
            '"home.pending.sync.title.one"',
            '"home.pending.sync.transport.unavailable"',
            '"home.pending.sync.action"',
        ):
            self.assertIn(marker, source)
        for hardcoded in (
            '"Pendências"',
            '"Não perturbe ativo"',
            '"histórico somente nesta sessão"',
            '"transporte remoto não está ativo"',
            '"Abrir Conta em Sincronização"',
        ):
            self.assertNotIn(hardcoded, source)

    def test_power_controls_store_message_identity_not_rendered_portuguese(self):
        source = POWER.read_text(encoding="utf-8")
        for marker in (
            "assertSurfaceRenderLifecycle",
            "let messageId = null;",
            "localization.subscribe",
            '"power.controls.restart.confirm"',
            '"power.controls.shutdown.confirm"',
            '"power.controls.request.restart"',
            '"power.controls.request.shutdown"',
            '"power.controls.failed"',
        ):
            self.assertIn(marker, source)
        for hardcoded in (
            '"Confirmar reinício"',
            '"Confirmar desligamento"',
            '"Solicitando reinício ao host…"',
            '"Solicitando desligamento ao host…"',
            '"A ação de energia não pôde ser concluída."',
        ):
            self.assertNotIn(hardcoded, source)

    def test_update_shortcut_uses_shared_localization_owner(self):
        source = UPDATES.read_text(encoding="utf-8")
        self.assertIn("assertSurfaceRenderLifecycle", source)
        self.assertIn("localization.subscribe", source)
        self.assertIn('"system.updateShortcut.label"', source)
        self.assertIn('"system.updateShortcut.title.basePending"', source)
        self.assertNotIn('"Atualizações"', source)
        self.assertNotIn('"Há uma atualização que requer atenção.', source)

    def test_boot_copy_uses_same_surface_catalog_and_neutral_pre_js_markup(self):
        i18n = SURFACE_I18N.read_text(encoding="utf-8")
        boot_catalog = BOOT_I18N.read_text(encoding="utf-8")
        native = NATIVE_MAIN.read_text(encoding="utf-8")
        web = WEB_MAIN.read_text(encoding="utf-8")
        boot = BOOT.read_text(encoding="utf-8")
        for marker in (
            '"surface.boot.loadingSurface": "Carregando superfície…"',
            '"surface.boot.loadingSurface": "Loading Surface…"',
            '"surface.boot.loadingApps": "Carregando aplicativos…"',
            '"surface.boot.loadingApps": "Loading applications…"',
            '"surface.boot.failed": "Não foi possível iniciar a interface"',
            '"surface.boot.failed": "The interface could not be started"',
        ):
            self.assertIn(marker, boot_catalog)
        self.assertIn("export function translateSurfaceMessage", i18n)
        self.assertIn("...SURFACE_BOOT_SOURCE_MESSAGES", i18n)
        self.assertIn("...SURFACE_BOOT_ENGLISH_MESSAGES", i18n)
        for composition in (native,):
            self.assertIn("translateSurfaceMessage", composition)
            self.assertIn('"surface.boot.loadingSurface"', composition)
            self.assertIn('"surface.boot.loadingApps"', composition)
            self.assertIn('"surface.boot.failed"', composition)
            self.assertNotIn('bootScreen.fail("Não foi possível iniciar a interface")', composition)
        self.assertNotIn("Não foi possível iniciar a interface", boot)
        for html_path in (NATIVE_HTML, WEB_HTML):
            html = html_path.read_text(encoding="utf-8")
            self.assertIn(
                '<html lang="und">' if html_path == NATIVE_HTML else '<html lang="pt-BR">',
                html,
            )
            self.assertIn("data-ordax-boot-status>OrdaX</span>", html)
            self.assertNotIn("Preparando OrdaX…", html)

    def test_catalogs_have_english_for_residual_surface_copy(self):
        surface = SURFACE_I18N.read_text(encoding="utf-8")
        power = POWER_I18N.read_text(encoding="utf-8")
        system = SYSTEM_I18N.read_text(encoding="utf-8")
        pairs = (
            (surface, '"home.continuation.heading": "Continuar trabalho"', '"home.continuation.heading": "Continue working"'),
            (surface, '"home.pending.heading": "Pendências"', '"home.pending.heading": "Pending"'),
            (power, '"power.controls.restart.label": "Reiniciar"', '"power.controls.restart.label": "Restart"'),
            (power, '"power.controls.shutdown.label": "Desligar"', '"power.controls.shutdown.label": "Shut down"'),
            (system, '"system.updateShortcut.label": "Atualizações"', '"system.updateShortcut.label": "Updates"'),
        )
        for catalog, source, english in pairs:
            self.assertIn(source, catalog)
            self.assertIn(english, catalog)

    def test_desktop_clock_has_no_portuguese_fallback_outside_catalog(self):
        source = DESKTOP.read_text(encoding="utf-8")
        self.assertIn('localizationPort.translate("shell.clock.timeZone"', source)
        self.assertNotIn("Fuso horário:", source)


if __name__ == "__main__":
    unittest.main()
