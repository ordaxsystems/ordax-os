from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
STORE_APP = ROOT / "system/apps/store/app.mjs"
STORE_SERVICE = ROOT / "system/services/apps/store-catalog.mjs"
STORE_UI = ROOT / "system/surface/ui/store-overview-controls.mjs"
WEB = ROOT / "system/composition/web/main.mjs"
NATIVE = ROOT / "system/composition/native/main.mjs"
WEB_INDEX = ROOT / "system/composition/web/index.html"
NATIVE_INDEX = ROOT / "system/composition/native/index.html"
DELIVERY = ROOT / "docs/contracts/first-party-app-delivery.json"
DISTRIBUTION = ROOT / "docs/contracts/app-distribution.json"


class StoreFoundationTests(unittest.TestCase):
    def test_store_ui_is_mounted_in_both_compositions(self):
        for path in (WEB, NATIVE):
            source = path.read_text(encoding="utf-8")
            self.assertIn("mountStoreOverviewControls", source)
            self.assertIn("storeOverviewControls.destroy()", source)

        for path in (WEB_INDEX, NATIVE_INDEX):
            html = path.read_text(encoding="utf-8")
            self.assertIn("../../surface/ui/store.css", html)

    def test_store_ui_has_no_install_or_update_authority(self):
        app = STORE_APP.read_text(encoding="utf-8")
        service = STORE_SERVICE.read_text(encoding="utf-8")
        ui = STORE_UI.read_text(encoding="utf-8")
        combined = "\n".join((app, service, ui))

        self.assertIn('extensionId: "store-overview"', app)
        self.assertIn('authority: "none"', service)
        self.assertIn('installAction: "none"', service)
        self.assertIn("action.disabled = true", ui)
        self.assertIn('dataset.authority = "none"', ui)

        for forbidden in (
            "stageComponent",
            "promotePending",
            "rollbackCurrent",
            "uninstallCurrent",
            "signRelease",
            "privateKey",
            "fetch(",
            "__ordax/native/",
        ):
            self.assertNotIn(forbidden, combined)

    def test_contracts_record_read_only_store_without_install_authority(self):
        delivery = json.loads(DELIVERY.read_text(encoding="utf-8"))
        distribution = json.loads(DISTRIBUTION.read_text(encoding="utf-8"))

        self.assertIn("store", delivery["current_target_policy"]["structural"])
        self.assertTrue(delivery["store_boundary"]["public_store_ui_enabled"])
        self.assertTrue(delivery["store_boundary"]["store_ui_implemented"])
        self.assertTrue(delivery["store_boundary"]["store_catalog_service_implemented"])
        self.assertFalse(delivery["store_boundary"]["store_install_request_service_implemented"])
        self.assertFalse(delivery["store_boundary"]["store_install_executor_implemented"])
        self.assertTrue(delivery["store_boundary"]["must_reuse_component_manager"])
        self.assertFalse(delivery["store_boundary"]["may_create_parallel_updater"])

        self.assertEqual(distribution["catalog_owner"], "system/services/apps/store-catalog.mjs")
        self.assertTrue(distribution["mvp"]["store_ui_enabled"])
        self.assertIn("store", distribution["mvp"]["structural_app_ids"])
        self.assertFalse(distribution["security"]["store_ui_may_claim_install_authority"])
        self.assertTrue(distribution["security"]["store_is_not_a_second_updater"])


if __name__ == "__main__":
    unittest.main()
