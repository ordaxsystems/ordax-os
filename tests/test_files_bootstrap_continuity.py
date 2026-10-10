"""Protect the preinstalled Files entrypoint until a verified handoff replaces it.

This is a source/composition regression gate, not a signed package or host E2E proof.
The test should evolve only alongside an independently verified first-boot delivery.
"""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class FilesBootstrapContinuityTests(unittest.TestCase):
    def test_files_remains_preinstalled_and_mounted_during_cutover_preparation(self):
        for relative in (
            "system/apps/files/app.mjs",
            "system/apps/files/component.mjs",
            "system/apps/files/runtime.mjs",
            "system/surface/ui/file-space-controls.mjs",
            "system/surface/ui/file-space-response-identity.mjs",
            "system/services/components/manifests/apps.mjs",
            "system/adapters/native/file-space.mjs",
        ):
            self.assertTrue((ROOT / relative).is_file(), relative)

        app_catalog = (ROOT / "system/apps/catalog.mjs").read_text(encoding="utf-8")
        delivery = (ROOT / "system/services/apps/delivery-policy.mjs").read_text(encoding="utf-8")
        components = (ROOT / "system/services/components/manifests/apps.mjs").read_text(encoding="utf-8")
        native = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")

        self.assertIn('import { filesApp } from "./files/app.mjs";', app_catalog)
        self.assertIn('  filesApp,', app_catalog)
        self.assertIn('{ appId: "files", deliveryClass: "bootstrap"', delivery)
        component = (ROOT / "system/apps/files/component.mjs").read_text(encoding="utf-8")
        app = (ROOT / "system/apps/files/app.mjs").read_text(encoding="utf-8")
        component_catalog = (ROOT / "system/apps/component-catalog.mjs").read_text(encoding="utf-8")
        self.assertIn('import { filesComponent } from "./files/component.mjs";', component_catalog)
        self.assertIn("  filesComponent,", component_catalog)
        self.assertNotIn('apps/files/component.mjs', components)
        self.assertNotIn('export const filesComponent = defineComponentManifest({', components)
        self.assertIn('export const filesComponent = defineComponentManifest({', component)
        self.assertIn('  releaseMode: "bundled",', component)
        self.assertIn('  owner: "system/apps/files",', component)
        self.assertIn('import { filesComponent } from "./component.mjs";', app)
        self.assertNotIn('services/components/manifests/apps.mjs', app)
        self.assertIn('import { mountFileSpaceControls } from "../../surface/ui/file-space-controls.mjs";', native)
        self.assertIn('const fileSpaceControls = mountFileSpaceControls(', native)
        runtime = (ROOT / "system/apps/files/runtime.mjs").read_text(encoding="utf-8")
        self.assertIn('export const componentRuntime = Object.freeze({', runtime)
        self.assertIn('mountFileSpaceControls(', runtime)
        self.assertIn('assertFileSpacePort(fileSpace)', runtime)
        self.assertNotIn("adapters/native/file-space.mjs", runtime)

    def test_no_parallel_files_source_or_store_install_authority_is_introduced(self):
        delivery = (ROOT / "system/services/apps/delivery-policy.mjs").read_text(encoding="utf-8")
        self.assertIn('appId: "files", deliveryClass: "bootstrap"', delivery)
        # Delivery policy is a read-only projection; Store remains unable to
        # install and must use platform lifecycle trust for an eventual handoff.
        self.assertIn('authority: "none"', delivery)
        self.assertNotIn("autoInstallFiles", delivery)


if __name__ == "__main__":
    unittest.main()
