from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "system/apps/projects"
I18N = ROOT / "system/services/i18n/catalog/projects.mjs"

class ProjectsPlatformAbsenceTests(unittest.TestCase):
    def read(self, path):
        return (ROOT / path).read_text(encoding="utf-8")

    def test_single_source_remove_first_without_platform_fallback(self):
        self.assertFalse(APP.exists())
        self.assertFalse(I18N.exists())
        for path in (
            "system/apps/catalog.mjs",
            "system/apps/component-catalog.mjs",
            "system/apps/intelligence-catalog.mjs",
            "system/composition/native/main.mjs",
        ):
            content = self.read(path)
            self.assertNotIn('apps/projects/', content)
            self.assertNotIn('./projects/', content)
            self.assertNotIn('projectsApp', content)
            self.assertNotIn('projectsComponent', content)
            self.assertNotIn('projectsIntelligenceManifest', content)
        shell = self.read("system/surface/ui/desktop-shell.mjs")
        self.assertNotIn('railButton("projects"', shell)
        self.assertNotIn('"projects", "internet"', shell)

    def test_platform_project_domain_and_public_contracts_are_retained(self):
        for path in (
            "system/contracts/project-catalog.mjs",
            "system/contracts/project-cloud-links-reader.mjs",
            "system/services/files/projects.mjs",
            "system/services/projects/cloud-links-reader.mjs",
            "system/adapters/native/projects.mjs",
            "system/services/device-agent/capability-reader.mjs",
        ):
            self.assertTrue((ROOT / path).is_file(), path)
        native = self.read("system/composition/native/main.mjs")
        self.assertIn("createProjectCatalogRuntime", native)
        self.assertIn("createProjectCloudLinksReader", native)
        self.assertIn("mountHomeContinuation", native)
        self.assertNotIn('componentId: "projects"', native)
        sdk = json.loads(self.read("sdk/app-sdk-v1/bundle.json"))
        schemas = {entry["schema"] for entry in sdk["contracts"]}
        self.assertIn("ordax.project-catalog/1", schemas)
        self.assertIn("ordax.project-cloud-links-reader/1", schemas)

if __name__ == "__main__":
    unittest.main()
