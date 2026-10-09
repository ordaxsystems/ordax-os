from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLS = ROOT / "system/surface/ui/settings-overview-controls.mjs"
SETTINGS_CATALOG = ROOT / "system/services/i18n/catalog/settings.mjs"
NETWORK_CATALOG = ROOT / "system/services/i18n/catalog/network.mjs"


class SettingsDeepLocalizationTests(unittest.TestCase):
    def test_preferences_and_keyboard_use_shared_localization_owner(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        for marker in (
            "PREFERENCE_PRESENTATION_IDS",
            't("settings.preference.active")',
            't("settings.keyboard.kicker")',
            't("settings.keyboard.title")',
            't("settings.keyboard.description")',
            't("settings.keyboard.marker.nextStart")',
            "KEYBOARD_LAYOUT_PRESENTATION_IDS",
        ):
            self.assertIn(marker, controls)
        for hardcoded in (
            '"Teclado físico"',
            '"Layout do teclado"',
            '"Próximo início"',
            '"Em uso"',
            '"Contraste escuro para ambientes de pouca luz."',
            '"Superfície clara e neutra como padrão do OrdaX."',
        ):
            self.assertNotIn(hardcoded, controls)

    def test_network_uses_semantic_catalog_ids_and_locale_aware_time(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        for marker in (
            't("settings.network.title")',
            '"settings.network.description.management"',
            '"settings.network.interfaces.stale"',
            '"settings.network.management.stale"',
            '"network.quick.action.scan"',
            '"network.quick.action.connect"',
            '"network.quick.action.disconnect"',
            '"network.quick.action.reconnect"',
            '"settings.network.action.forget"',
            "networkManagementActionMessageId",
            "networkManagementFailureMessageId",
            "formatReceivedAt(networkLastSuccessAt, localization.getLocale())",
            "formatReceivedAt(networkManagementLastSuccessAt, localization.getLocale())",
        ):
            self.assertIn(marker, controls)
        for hardcoded in (
            '"Rede e conexões"',
            '"Procurar redes"',
            '"Conectar"',
            '"Desconectar"',
            '"Reconectar"',
            '"Esquecer"',
            '"Dados de interface antigos',
            '"Dados de Wi-Fi antigos',
        ):
            self.assertNotIn(hardcoded, controls)

    def test_async_keyboard_and_network_messages_remain_semantic(self):
        controls = CONTROLS.read_text(encoding="utf-8")
        self.assertIn("let keyboardLayoutMessageId = null;", controls)
        self.assertIn("let networkManagementMessageId = null;", controls)
        self.assertIn(
            'keyboardLayoutMessageId = "settings.keyboard.message.saving"',
            controls,
        )
        self.assertIn(
            "networkManagementMessageId = networkManagementActionMessageId(action, 0)",
            controls,
        )
        self.assertIn(
            "networkManagementMessageId = networkManagementFailureMessageId(action, error)",
            controls,
        )
        self.assertIn(
            'networkManagementMessageId = "network.quick.passwordRequired"',
            controls,
        )
        self.assertNotIn("let keyboardLayoutMessage =", controls)
        self.assertNotIn("let networkManagementMessage =", controls)
        self.assertNotIn("networkManagementActionMessage(action", controls)
        self.assertNotIn("networkManagementFailureMessage(action", controls)

    def test_catalog_has_pt_br_and_en_us_deep_settings_copy(self):
        settings = SETTINGS_CATALOG.read_text(encoding="utf-8")
        network = NETWORK_CATALOG.read_text(encoding="utf-8")
        pairs = (
            ('"settings.preference.appearance.title": "Tema do OrdaX"', '"settings.preference.appearance.title": "OrdaX theme"'),
            ('"settings.keyboard.title": "Layout do teclado"', '"settings.keyboard.title": "Keyboard layout"'),
            ('"settings.network.title": "Rede e conexões"', '"settings.network.title": "Network and connections"'),
            ('"settings.network.connectivity.online": "Conectividade do host disponível"', '"settings.network.connectivity.online": "Host connectivity available"'),
        )
        for source, english in pairs:
            self.assertIn(source, settings)
            self.assertIn(english, settings)
        self.assertIn('"network.management.scan.pending": "Procurando redes Wi-Fi…"', network)
        self.assertIn('"network.management.scan.pending": "Searching for Wi-Fi networks…"', network)


if __name__ == "__main__":
    unittest.main()
