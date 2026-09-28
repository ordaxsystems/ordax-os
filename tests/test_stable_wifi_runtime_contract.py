import json
import re
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
STABLE_SOURCE = ROOT / "bootstrap" / "stable-base" / "source.json"
KERNEL_FRAGMENT = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"
NETWORK_BROKER = ROOT / "system" / "surface" / "runtime" / "network_broker.sh"

KERNEL_MARKERS = {
    "iwlwifi": "CONFIG_IWLWIFI=m",
    "iwlmvm": "CONFIG_IWLMVM=m",
    "rtl8xxxu": "CONFIG_RTL8XXXU=m",
    "mt76x2u": "CONFIG_MT76x2U=m",
    "ath9k_htc": "CONFIG_ATH9K_HTC=m",
}


class StableWifiRuntimeContractTests(unittest.TestCase):
    def test_broker_module_activation_matches_stable_base_contract(self):
        source = json.loads(STABLE_SOURCE.read_text(encoding="utf-8"))
        required = source["kernel_modules"]["required_basenames"]
        broker = NETWORK_BROKER.read_text(encoding="utf-8")
        match = re.search(r'^WIFI_MODULES="([^"]+)"$', broker, flags=re.MULTILINE)
        self.assertIsNotNone(match)
        activated = match.group(1).split()
        self.assertEqual(activated, required)

    def test_every_runtime_wifi_module_is_built_by_the_kernel(self):
        source = json.loads(STABLE_SOURCE.read_text(encoding="utf-8"))
        required = source["kernel_modules"]["required_basenames"]
        fragment = KERNEL_FRAGMENT.read_text(encoding="utf-8")
        self.assertEqual(set(required), set(KERNEL_MARKERS))
        for module in required:
            self.assertIn(KERNEL_MARKERS[module], fragment)

    def test_network_owner_activates_modules_before_serving_requests(self):
        broker = NETWORK_BROKER.read_text(encoding="utf-8")
        self.assertIn("MODPROBE_BIN=$(command -v modprobe || true)", broker)
        self.assertIn("load_supported_wifi_modules()", broker)
        self.assertIn("find_or_activate_wifi_interface()", broker)
        self.assertLess(
            broker.index("load_supported_wifi_modules\n\nexec 9<>\"$CONTROL\""),
            broker.index("while :; do"),
        )


if __name__ == "__main__":
    unittest.main()
