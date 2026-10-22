"""Internet source ownership is external; Native product delivery stays gated."""
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PRODUCT = ROOT / "system/apps/internet"
POLICY = ROOT / "docs/contracts/runtime-component-package.json"


class InternetRemoveFirstCutoverTests(unittest.TestCase):
    def test_source_cutover_is_complete_without_granting_native_delivery(self):
        policy = json.loads(POLICY.read_text(encoding="utf-8"))
        self.assertEqual(
            policy["canonical_package_source_repository_by_component"]["internet"],
            "ordaxsystems/ordax-apps",
        )
        self.assertNotIn("internet", policy["prelaunch_remove_first_pending"])
        self.assertNotIn("internet", policy["canonical_external_source_repository_by_component"])
        self.assertFalse(policy["slot_activation_available"])
        self.assertFalse(policy["publish_allowed"])
        self.assertFalse(PRODUCT.exists())
        self.assertFalse((ROOT / "system/services/i18n/catalog/internet.mjs").exists())
        for name in ("supported_components", "native_loopback_broker_supported_components",
                     "runtime_health_bridge_supported_components", "native_loopback_broker_health_mutation_components"):
            self.assertNotIn("internet", policy[name])
        mirror = json.loads((ROOT / "sdk/app-sdk-v1/runtime-component-package-policy.json").read_text(encoding="utf-8"))
        self.assertEqual(mirror, policy)

    def test_no_embedded_app_loader_or_fake_native_install(self):
        for name in ("system/apps/catalog.mjs", "system/apps/component-catalog.mjs",
                     "system/apps/intelligence-catalog.mjs", "system/composition/native/main.mjs",
                     "tools/component-package/metadata.mjs", "tools/surface-native/browser-smoke.mjs"):
            source = (ROOT / name).read_text(encoding="utf-8")
            self.assertNotIn("./internet/", source, name)
            self.assertNotIn("apps/internet/", source, name)
            self.assertNotIn("internetComponent?.destroy()", source, name)
        shell = (ROOT / "system/surface/ui/desktop-shell.mjs").read_text(encoding="utf-8")
        self.assertNotIn('railButton("internet"', shell)
        self.assertNotIn('"internet",', shell)
        generated = (ROOT / "system/surface/runtime/native_store_metadata_policy.py").read_text(encoding="utf-8")
        self.assertIn('"internet"', generated)
        module_read = generated.split("NATIVE_MODULE_READ_COMPONENT_IDS", 1)[1].split(
            "NATIVE_HEALTH_MUTATION_COMPONENT_IDS", 1
        )[0]
        self.assertNotIn('"internet",', module_read)

    def test_native_browser_engine_and_host_services_are_preserved(self):
        for name in ("system/contracts/browser-session.mjs",
                     "system/contracts/browser-download.mjs",
                     "system/contracts/browser-favorites.mjs",
                     "system/contracts/browser-history.mjs",
                     "system/adapters/native/browser-session.mjs"):
            self.assertTrue((ROOT / name).is_file(), name)
        native = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        self.assertIn("createNativeBrowserSession", native)
        # A preserved Host adapter is not the same as an eager Native import.
        # The Internet app may use the canonical adapter when independently delivered.
        download = (ROOT / "system/adapters/native/browser-download.mjs").read_text(encoding="utf-8")
        self.assertIn("export function createNativeBrowserDownload", download)
        self.assertIn("assertBrowserDownloadPort", download)
        self.assertNotIn("createNativeBrowserDownload", native)


if __name__ == "__main__":
    unittest.main()
