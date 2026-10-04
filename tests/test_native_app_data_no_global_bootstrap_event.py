import json
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BROWSER_HOST = ROOT / "system" / "surface" / "runtime" / "ordax_browser_host.py"
CONTRACT = ROOT / "docs" / "contracts" / "native-app-data-binding.json"


class NativeAppDataNoGlobalBootstrapEventTests(unittest.TestCase):
    def test_app_data_bootstrap_is_delivered_by_direct_privileged_module_call(self):
        source = BROWSER_HOST.read_text(encoding="utf-8")
        start = source.index("    def emit_app_data_bootstrap(self) -> None:")
        end = source.index("    def emit_host_event(self, payload: dict) -> None:", start)
        method = source[start:end]

        self.assertNotIn("window.dispatchEvent", method)
        self.assertNotIn("CustomEvent", method)
        self.assertNotIn("APP_DATA_COMPOSITION_BOOTSTRAP_EVENT", source)
        self.assertIn("/composition/native/app-data-bootstrap.mjs", method)
        self.assertIn("acceptTrustedNativeAppDataBootstrap", method)

    def test_machine_readable_contract_matches_direct_delivery_boundary(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        handoff = contract["trusted_composition_handoff"]

        self.assertEqual(handoff["browser_bridge_request"], "app-data.bootstrap.request")
        self.assertEqual(handoff["browser_bridge_delivery"], "direct-privileged-module-call")
        self.assertEqual(
            handoff["browser_bridge_module"],
            "/composition/native/app-data-bootstrap.mjs",
        )
        self.assertEqual(
            handoff["browser_bridge_export"],
            "acceptTrustedNativeAppDataBootstrap",
        )
        self.assertIsNone(handoff["browser_bridge_response_event"])
        self.assertFalse(handoff["dom_exposure"])


if __name__ == "__main__":
    unittest.main()
