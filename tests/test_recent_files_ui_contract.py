"""Host recent-files history stays independent of optional Files UI."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVICE = ROOT / "system/services/files/recent-files.mjs"
ADAPTER = ROOT / "system/adapters/native/recent-files.mjs"
COMPOSITION = ROOT / "system/composition/native/main.mjs"
WORKFLOW = ROOT / ".github/workflows/surface-web-candidate.yml"

class RecentFilesUiContractTests(unittest.TestCase):
    def test_recent_history_policy_stays_out_of_native_adapter(self):
        service = SERVICE.read_text(encoding="utf-8")
        adapter = ADAPTER.read_text(encoding="utf-8")
        self.assertIn("MAX_RECENT_FILES", service)
        self.assertIn("recordOpened(path)", service)
        self.assertIn("relocate(fromPath, toPath)", service)
        self.assertIn("ordax.native.recent-files.v1", adapter)
        self.assertIn("localStorage", adapter)
        self.assertNotIn("MAX_RECENT_FILES", adapter)
        self.assertNotIn("surface/ui", adapter)
    def test_native_composition_preserves_recent_service_without_bundled_ui(self):
        composition = COMPOSITION.read_text(encoding="utf-8")
        self.assertIn("createNativeRecentFilesStore", composition)
        self.assertIn("createRecentFilesRuntime", composition)
        self.assertIn("const recentFiles = fileSpace === null ? null", composition)
        self.assertNotIn("mountFileSpaceControls", composition)
        self.assertFalse((ROOT / "system/surface/ui/file-space-controls.mjs").exists())
    def test_surface_candidate_keeps_host_services_regressions(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("node --test tests/test_recent_files.mjs", workflow)
        self.assertIn("python -m unittest tests.test_recent_files_ui_contract -v", workflow)

if __name__ == "__main__":
    unittest.main()
