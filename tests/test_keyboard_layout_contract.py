from importlib.util import module_from_spec, spec_from_file_location
import json
import os
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system" / "surface" / "runtime" / "native_host_server.py"
LAUNCHER = ROOT / "system" / "surface" / "bin" / "ordax-surface"
CONTRACT = ROOT / "docs" / "contracts" / "keyboard-layout.json"
CAPABILITIES = ROOT / "docs" / "contracts" / "product-capabilities.json"
ADAPTER = ROOT / "system" / "adapters" / "native" / "keyboard-layout.mjs"
RUNTIME = ROOT / "system" / "adapters" / "native" / "runtime.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.tsx"
SETTINGS = ROOT / "system" / "surface" / "ui" / "settings-overview-controls.mjs"
SETTINGS_CSS = ROOT / "system" / "surface" / "ui" / "settings.css"


def load_host_server():
    spec = spec_from_file_location("ordax_native_keyboard_layout_test", SERVER)
    module = module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class NativeKeyboardLayoutTests(unittest.TestCase):
    def test_persistent_layout_is_private_atomic_and_fail_closed(self):
        host = load_host_server()
        with tempfile.TemporaryDirectory() as directory:
            host.KEYBOARD_LAYOUT_FILE = str(Path(directory) / "keyboard-layout")
            self.assertEqual(host.read_keyboard_layout_id(), "br-abnt2")

            Path(host.KEYBOARD_LAYOUT_FILE).write_text("unsupported\n", encoding="utf-8")
            self.assertEqual(host.read_keyboard_layout_id(), "br-abnt2")

            host.write_keyboard_layout_id("us")
            self.assertEqual(host.read_keyboard_layout_id(), "us")
            self.assertFalse(list(Path(directory).glob("*.tmp.*")))
            self.assertEqual(
                stat.S_IMODE(os.stat(host.KEYBOARD_LAYOUT_FILE).st_mode),
                0o600,
            )
            with self.assertRaises(ValueError):
                host.write_keyboard_layout_id("de")

            with patch.dict(
                os.environ,
                {"ORDAX_KEYBOARD_LAYOUT_ID": "br-abnt2"},
                clear=False,
            ):
                snapshot = host.keyboard_layout_snapshot()
            self.assertEqual(snapshot["configuredLayoutId"], "us")
            self.assertEqual(snapshot["appliedLayoutId"], "br-abnt2")
            self.assertTrue(snapshot["restartRequired"])
            self.assertEqual(snapshot["supportedLayoutIds"], ["br-abnt2", "us"])

    def test_native_host_route_is_loopback_bounded_and_not_shell_driven(self):
        server = SERVER.read_text(encoding="utf-8")
        get_section = server.split("def do_GET", 1)[1].split("def do_POST", 1)[0]
        post_section = server.split("def do_POST", 1)[1]
        self.assertIn(
            'KEYBOARD_LAYOUT_PATH = "/__ordax/native/keyboard-layout"',
            server,
        )
        self.assertIn(
            'KEYBOARD_LAYOUT_FILE = "/var/lib/ordax/keyboard-layout"',
            server,
        )
        self.assertIn("MAX_KEYBOARD_LAYOUT_BODY = 128", server)
        self.assertIn("keyboard_layout_snapshot()", get_section)
        self.assertIn('set(payload) != {"layoutId"}', post_section)
        self.assertIn("KEYBOARD_LAYOUT_ID_SET", post_section)
        self.assertIn("write_keyboard_layout_id", post_section)
        self.assertIn("KEYBOARD_LAYOUT_PATH", get_section)
        self.assertNotIn("subprocess", server)
        self.assertNotIn("os.system", server)
        self.assertNotIn("Access-Control-Allow-Origin", server)

    def test_launcher_maps_only_whitelisted_layouts_before_cage(self):
        launcher = LAUNCHER.read_text(encoding="utf-8")
        self.assertIn(
            "KEYBOARD_LAYOUT_STATE=$PERSISTENT_NATIVE_STATE/keyboard-layout",
            launcher,
        )
        self.assertIn("configure_keyboard_layout()", launcher)
        self.assertIn("br-abnt2|us)", launcher)
        self.assertIn("XKB_DEFAULT_MODEL=abnt2", launcher)
        self.assertIn("XKB_DEFAULT_LAYOUT=br", launcher)
        self.assertIn("XKB_DEFAULT_MODEL=pc105", launcher)
        self.assertIn("XKB_DEFAULT_LAYOUT=us", launcher)
        self.assertIn("export XKB_DEFAULT_RULES XKB_DEFAULT_MODEL XKB_DEFAULT_LAYOUT", launcher)
        self.assertIn("export XKB_DEFAULT_VARIANT XKB_DEFAULT_OPTIONS ORDAX_KEYBOARD_LAYOUT_ID", launcher)
        self.assertLess(
            launcher.index("configure_keyboard_layout\n"),
            launcher.index('START_URI="http://127.0.0.1:8765/composition/native/index.html'),
        )

    def test_capability_is_native_only_and_declared_in_product_contract(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(contract["$schema"], "prototype-ordax.keyboard-layout/1")
        self.assertEqual(contract["default_layout_id"], "br-abnt2")
        self.assertEqual(set(contract["supported_layouts"]), {"br-abnt2", "us"})
        self.assertFalse(contract["application"]["live_reconfigure_supported"])
        self.assertTrue(
            contract["application"][
                "restart_required_when_configured_differs_from_applied"
            ]
        )
        self.assertFalse(contract["first_run"]["selector_exposed"])

        capabilities = json.loads(CAPABILITIES.read_text(encoding="utf-8"))
        entries = {entry["id"]: entry for entry in capabilities["capabilities"]}
        self.assertEqual(
            entries["input.keyboard-layout"]["security_boundary"],
            "loopback-validated-device-input-state",
        )
        modes = {mode["id"]: mode for mode in capabilities["modes"]}
        for mode in ("usb", "native-disk"):
            self.assertIn(
                "input.keyboard-layout",
                modes[mode]["baseline_capabilities"],
            )
        for mode in ("web", "mobile", "desktop"):
            self.assertNotIn(
                "input.keyboard-layout",
                modes[mode]["baseline_capabilities"],
            )

    def test_composition_and_settings_consume_neutral_native_port(self):
        adapter = ADAPTER.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        native = NATIVE_MAIN.read_text(encoding="utf-8")
        web = WEB_MAIN.read_text(encoding="utf-8")
        settings = SETTINGS.read_text(encoding="utf-8")
        css = SETTINGS_CSS.read_text(encoding="utf-8")

        self.assertIn('KEYBOARD_LAYOUT_ENDPOINT = "/__ordax/native/keyboard-layout"', adapter)
        self.assertIn("createNativeKeyboardLayout", native)
        self.assertIn("() => createNativeKeyboardLayout(window)", native)
        self.assertIn("keyboardLayoutAvailable", native)
        self.assertIn('"input.keyboard-layout"', runtime)
        self.assertNotIn("createNativeKeyboardLayout", web)

        self.assertIn("assertKeyboardLayoutPort", settings)
        self.assertIn("validateKeyboardLayoutSnapshot", settings)
        self.assertIn("KEYBOARD_LAYOUT_OPTIONS", settings)
        self.assertIn('t("settings.keyboard.marker.nextStart")', settings)
        self.assertIn("keyboardLayoutPort.configure", settings)
        self.assertNotIn("/__ordax/native/keyboard-layout", settings)
        self.assertIn(".ordax-settings-keyboard-option", css)


if __name__ == "__main__":
    unittest.main()
