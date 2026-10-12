from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "system" / "apps" / "network"
POLICY = ROOT / "docs" / "contracts" / "runtime-component-package.json"

class NetworkSourceCutoverTests(unittest.TestCase):
    def text(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_network_has_one_external_owner_without_bundled_fallback(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertEqual(policy["canonical_package_source_repository_by_component"]["network"], "ordaxsystems/ordax-apps")
        self.assertFalse(APP.exists())
        for path in ["system/apps/catalog.mjs", "system/apps/component-catalog.mjs", "system/apps/intelligence-catalog.mjs", "system/composition/native/main.mjs"]:
            source = self.text(path)
            self.assertNotIn("apps/network/", source)
            self.assertNotIn("./network/", source)
        self.assertNotIn('railButton("network"', self.text("system/surface/ui/desktop-shell.mjs"))
        self.assertNotIn("system/apps/network/network.css", self.text("tools/surface-native/browser-smoke.mjs"))

    def test_network_is_not_falsely_executable_until_native_trust_gate(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertNotIn("network", policy["native_loopback_broker_supported_components"])
        self.assertNotIn("network", policy["runtime_health_bridge_supported_components"])
        generated = self.text("system/services/apps/external-first-party-policy.mjs")
        self.assertIn('"network": "ordaxsystems/ordax-apps"', generated)
        module_read_block = generated.split("EXTERNAL_FIRST_PARTY_NATIVE_MODULE_READ_IDS = Object.freeze([", 1)[1].split("]);", 1)[0]
        self.assertNotIn('"network"', module_read_block)

    def test_network_service_and_wifi_infrastructure_stay_on_os(self):
        for path in ["system/services/professional-network/draft.mjs", "system/contracts/network-draft.mjs", "system/surface/ui/network-quick-panel.mjs", "system/surface/ui/network-tray-controls.mjs"]:
            self.assertTrue((ROOT / path).is_file())
        native = self.text("system/composition/native/main.mjs")
        self.assertIn("mountNetworkQuickPanel", native)
        self.assertIn("mountNetworkTrayControls", native)
        sdk = json.loads(self.text("sdk/app-sdk-v1/bundle.json"))
        self.assertTrue(any(x["schema"] == "ordax.network-draft/1" for x in sdk["contracts"]))

if __name__ == "__main__":
    unittest.main()
