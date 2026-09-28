import json
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MATRIX = ROOT / "docs" / "contracts" / "hardware-support-matrix.json"
SOURCE = ROOT / "bootstrap" / "stable-base" / "source.json"
INIT = ROOT / "bootstrap" / "stable-base" / "ordax-stable-init"
KERNEL = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"


class StableHardwareBaselineContractTests(unittest.TestCase):
    def load_json(self, path: Path):
        return json.loads(path.read_text(encoding="utf-8"))

    def test_wifi_baseline_is_exactly_synchronized_across_policy_and_runtime(self):
        matrix = self.load_json(MATRIX)
        source = self.load_json(SOURCE)
        init = INIT.read_text(encoding="utf-8")

        wifi = next(
            item for item in matrix["required_mvp_capabilities"]
            if item["id"] == "wifi-after-base-start"
        )
        expected_modules = wifi["module_basenames"]
        self.assertEqual(source["kernel_modules"]["required_basenames"], expected_modules)

        coldplug_match = re.search(
            r"for module in ([^;]+); do",
            init,
        )
        self.assertIsNotNone(coldplug_match)
        coldplug_modules = coldplug_match.group(1).split()
        self.assertEqual(coldplug_modules, expected_modules)

        self.assertEqual(
            [package for package in source["packages"] if package.startswith("linux-firmware-")],
            wifi["firmware_packages"],
        )

    def test_wifi_baseline_modules_are_modular_not_boot_critical_builtins(self):
        matrix = self.load_json(MATRIX)
        kernel = KERNEL.read_text(encoding="utf-8")
        wifi = next(
            item for item in matrix["required_mvp_capabilities"]
            if item["id"] == "wifi-after-base-start"
        )
        config_by_module = {
            "iwlwifi": "CONFIG_IWLWIFI=m",
            "iwlmvm": "CONFIG_IWLMVM=m",
            "rtl8xxxu": "CONFIG_RTL8XXXU=m",
            "mt76x2u": "CONFIG_MT76x2U=m",
            "ath9k_htc": "CONFIG_ATH9K_HTC=m",
        }
        self.assertEqual(set(config_by_module), set(wifi["module_basenames"]))
        for module in wifi["module_basenames"]:
            self.assertIn(config_by_module[module], kernel)

    def test_hardware_extension_policy_prevents_silent_baseline_bloat(self):
        matrix = self.load_json(MATRIX)
        extension = matrix["extension_policy"]
        self.assertEqual(extension["strategy"], "small-baseline-plus-signed-hardware-packs")
        self.assertFalse(extension["activation_enabled"])
        self.assertTrue(extension["exact_modalias_match_required"])
        self.assertTrue(extension["exact_kernel_abi_match_required"])
        self.assertTrue(extension["signed_component_slot_required"])
        self.assertTrue(extension["known_good_and_rollback_required"])
        self.assertFalse(extension["driver_pack_presence_is_support_claim"])

    def test_stable_base_size_and_package_lock_remain_fail_closed(self):
        source = self.load_json(SOURCE)
        self.assertLessEqual(source["rootfs"]["maximum_unique_regular_bytes"], 256 * 1024 * 1024)
        self.assertTrue(source["apk_package_versions_pinned"])
        self.assertEqual(
            source["apk_package_lock_count"],
            len(source["apk_package_lock"]),
        )
        self.assertTrue(set(source["packages"]).issubset(source["apk_package_lock"]))


if __name__ == "__main__":
    unittest.main()
