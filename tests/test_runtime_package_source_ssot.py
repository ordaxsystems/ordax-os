import importlib.util
import json
from pathlib import Path
import re
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
POLICY = ROOT / "docs" / "contracts" / "runtime-component-package.json"
GENERATED = ROOT / "tools" / "runtime-component-channel" / "external_sources_generated.go"


class RuntimePackageSourceSsotTests(unittest.TestCase):
    def test_runtime_source_generator_rejects_identity_spoofing(self):
        generator_path = ROOT / "tools/app-policy/render_runtime_package_source_policy.py"
        spec = importlib.util.spec_from_file_location("runtime_source_generator", generator_path)
        generator = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(generator)
        source_lock = json.loads(
            (ROOT / "system/services/device-agent/studio-runtime-source-lock.json").read_text(encoding="utf-8")
        )
        with tempfile.TemporaryDirectory() as temp:
            lock_path = Path(temp) / "source-lock.json"
            source_lock["source"]["repository"] = "https://github.com/ordaxsystems/ordax-os"
            lock_path.write_text(json.dumps(source_lock), encoding="utf-8")
            with self.assertRaisesRegex(generator.GenerationError, "not canonical"):
                generator.load_runtime_source_lock(lock_path)
        with self.assertRaisesRegex(generator.GenerationError, "may not be registered"):
            generator.render(
                {"notes": "ordaxsystems/ordax-apps", "product-runtime": "ordaxsystems/ordax-apps"},
                {"ordax.app-activation": 1},
                "ordaxsystems/ordax-runtime",
            )

    def test_runtime_package_source_go_table_matches_policy_ssot(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        expected = policy["canonical_package_source_repository_by_component"]
        source = GENERATED.read_text(encoding="utf-8")
        found = {
            component_id: "ordaxsystems/ordax-apps"
            for component_id in re.findall(
                r'^\t"([a-z][a-z0-9-]*)": appsSourceRepository,$',
                source,
                re.MULTILINE,
            )
        }
        self.assertEqual(found, expected)
        runtime_lock = json.loads(
            (ROOT / "system/services/device-agent/studio-runtime-source-lock.json").read_text(encoding="utf-8")
        )
        runtime_repository = runtime_lock["source"]["repository"].removeprefix("https://github.com/")
        self.assertEqual(runtime_repository, "ordaxsystems/ordax-runtime")
        self.assertIn(
            f'const productRuntimeSourceRepository = "{runtime_repository}"',
            source,
        )
        self.assertIn('"product-runtime": productRuntimeSourceRepository,', source)
        self.assertNotIn("product-runtime", expected)
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
