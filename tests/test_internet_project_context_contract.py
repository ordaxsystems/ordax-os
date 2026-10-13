from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class NativeBrowserProjectBoundaryTests(unittest.TestCase):
    def test_platform_keeps_single_project_runtime_and_reference_store(self):
        native = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        self.assertIn("createProjectCatalogRuntime", native)
        self.assertIn("createProjectWebReferenceRuntime", native)
        self.assertIn("createNativeProjectWebReferenceStore", native)
        self.assertIn("projectReferences?.destroy()", native)
        self.assertNotIn('componentId: "internet"', native)
        self.assertFalse((ROOT / "system/apps/internet/ui/browser-controls.mjs").exists())

    def test_web_does_not_claim_native_project_reference_persistence(self):
        web = (ROOT / "system/composition/web/main.tsx").read_text(encoding="utf-8")
        for source in ("createProjectCatalogRuntime", "createProjectWebReferenceRuntime",
                       "createNativeProjectWebReferenceStore"):
            self.assertNotIn(source, web)

    def test_project_reference_contract_is_host_owned_bounded_and_private(self):
        contract = (ROOT / "system/contracts/project-web-references.mjs").read_text(encoding="utf-8")
        store = (ROOT / "system/contracts/project-web-reference-store.mjs").read_text(encoding="utf-8")
        runtime = (ROOT / "system/services/projects/web-references.mjs").read_text(encoding="utf-8")
        adapter = (ROOT / "system/adapters/native/project-web-references.mjs").read_text(encoding="utf-8")
        self.assertIn('PROJECT_WEB_REFERENCES_SCHEMA = "ordax.project-web-references/1"', contract)
        self.assertIn("MAX_PROJECT_WEB_REFERENCES = 512", contract)
        self.assertIn("PROJECT_WEB_REFERENCE_STORE_SCHEMA", store)
        self.assertIn("assertProjectCatalogPort(projects)", runtime)
        self.assertIn("removeMissingProjects", runtime)
        self.assertIn("ordax.native.project-web-references.v1", adapter)

if __name__ == "__main__":
    unittest.main()
