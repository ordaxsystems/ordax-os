"""Host project continuity remains available without bundled Files UI."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "system/services/files/projects.mjs"
CONTRACT = ROOT / "system/contracts/project-catalog.mjs"
COMPOSITION = ROOT / "system/composition/native/main.mjs"
WORKFLOW = ROOT / ".github/workflows/surface-web-candidate.yml"

class ProjectFilesUiContractTests(unittest.TestCase):
    def test_product_source_removed_without_erasing_project_services(self):
        self.assertFalse((ROOT / "system/apps/files").exists())
        self.assertFalse((ROOT / "system/surface/ui/file-space-controls.mjs").exists())
        self.assertTrue(SERVICE.is_file())
        self.assertTrue(CONTRACT.is_file())
        self.assertIn("createProjectCatalogRuntime", COMPOSITION.read_text(encoding="utf-8"))
        self.assertIn("createNativeProjectStore", COMPOSITION.read_text(encoding="utf-8"))
        self.assertIn("createProjectContinuityFileSpace", COMPOSITION.read_text(encoding="utf-8"))
    def test_project_behavior_is_covered_by_service_owner(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("node --test tests/test_projects.mjs", workflow)
        self.assertIn("python -m unittest tests.test_project_files_ui_contract -v", workflow)
        self.assertIn("tests/test_project_file_space_continuity.mjs", workflow)

if __name__ == "__main__":
    unittest.main()
