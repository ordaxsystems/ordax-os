import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "docs" / "contracts" / "runtime-component-package.json"
GENERATED = ROOT / "tools" / "runtime-component-channel" / "external_sources_generated.go"


class RuntimePackageSourceSsotTests(unittest.TestCase):
    def test_runtime_package_source_go_table_matches_policy_ssot(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        expected = policy["canonical_package_source_repository_by_component"]
        source = GENERATED.read_text(encoding="utf-8")
        constant_to_repository = {
            "appsSourceRepository": "ordaxsystems/ordax-apps",
            "productRuntimeSourceRepository": "ordaxsystems/ordax-runtime",
        }
        found = {
            component_id: constant_to_repository[constant]
            for component_id, constant in re.findall(
                r'^\t"([a-z][a-z0-9-]*)": (appsSourceRepository|productRuntimeSourceRepository),
        host_abi = policy["native_host_contract_major_versions"]
        self.assertEqual(host_abi["ordax.app-activation"], 1)
        self.assertEqual(host_abi["ordax.app-data"], 1)
        self.assertEqual(host_abi["ordax.localization"], 2)
        self.assertEqual(host_abi["ordax.surface-render-lifecycle"], 5)
        for name, major in host_abi.items():
            self.assertIn(f'\t"{name}": {major},', source)
        self.assertNotIn("ordax.internet", host_abi)

        self.assertEqual(found.get("activity"), "ordaxsystems/ordax-apps")
        self.assertNotIn("activity", policy["native_loopback_broker_supported_components"])
        self.assertNotIn("activity", policy["runtime_health_bridge_supported_components"])
        self.assertNotIn("activity", policy["prelaunch_remove_first_pending"])


if __name__ == "__main__":
    unittest.main()
,
                source,
                re.MULTILINE,
            )
        }
        self.assertEqual(found, expected)
        self.assertEqual(found["product-runtime"], "ordaxsystems/ordax-runtime")
        self.assertNotIn("product-runtime", policy["supported_components"])
        self.assertNotIn("product-runtime", policy["packaging_only_components"])
        self.assertNotIn("product-runtime", policy["native_loopback_broker_supported_components"])
        host_abi = policy["native_host_contract_major_versions"]
        self.assertEqual(host_abi["ordax.app-activation"], 1)
        self.assertEqual(host_abi["ordax.app-data"], 1)
        self.assertEqual(host_abi["ordax.localization"], 2)
        self.assertEqual(host_abi["ordax.surface-render-lifecycle"], 5)
        for name, major in host_abi.items():
            self.assertIn(f'\t"{name}": {major},', source)
        self.assertNotIn("ordax.internet", host_abi)

        self.assertEqual(found.get("activity"), "ordaxsystems/ordax-apps")
        self.assertNotIn("activity", policy["native_loopback_broker_supported_components"])
        self.assertNotIn("activity", policy["runtime_health_bridge_supported_components"])
        self.assertNotIn("activity", policy["prelaunch_remove_first_pending"])


if __name__ == "__main__":
    unittest.main()
