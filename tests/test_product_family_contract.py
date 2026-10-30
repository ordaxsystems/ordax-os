import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class ProductFamilyContractTests(unittest.TestCase):
    def test_branding_points_to_one_runtime_presentation_owner(self):
        branding = json.loads((ROOT / "docs/contracts/branding.json").read_text(encoding="utf-8"))
        family = branding["product_family"]
        self.assertEqual(family["mode_display_and_version_owner"], "system/contracts/product-family.mjs")
        self.assertEqual(family["mode_id_registry"], "docs/contracts/foundation.json#product_modes.modes")
        self.assertEqual(family["capability_contract"], "docs/contracts/product-capabilities.json")
        self.assertTrue(family["tablet_uses_mobile_mode"])
        self.assertTrue(family["studio_is_an_application_not_a_mode"])
        self.assertTrue(family["public_portal_is_not_web_mode"])

    def test_version_policy_does_not_confuse_mode_with_release(self):
        contract = json.loads((ROOT / "docs/contracts/update-nomenclature.json").read_text(encoding="utf-8"))
        policy = contract["mode_version_policy"]
        self.assertEqual(policy["canonical_presentation"], "system/contracts/product-family.mjs")
        self.assertTrue(policy["client_versions_require_verified_own_deployment_or_package"])
        self.assertIsNone(policy["unpublished_client_version"])
        self.assertTrue(policy["os_usb_and_native_share_product_version"])
        self.assertFalse(policy["one_global_version_number_for_all_clients"])
        self.assertTrue(policy["release_availability_remains_external_to_branding"])

    def test_mode_registry_is_not_replaced_by_public_names(self):
        foundation = json.loads((ROOT / "docs/contracts/foundation.json").read_text(encoding="utf-8"))
        capability = json.loads((ROOT / "docs/contracts/product-capabilities.json").read_text(encoding="utf-8"))
        self.assertEqual(
            foundation["product_modes"]["modes"],
            [mode["id"] for mode in capability["modes"]],
        )
        self.assertEqual(
            foundation["product_modes"]["modes"],
            ["web", "mobile", "desktop", "usb", "native-disk"],
        )


if __name__ == "__main__":
    unittest.main()
