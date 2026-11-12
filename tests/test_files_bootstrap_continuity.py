"""Boot without optional Files while retaining file services and signed-slot policies."""
from pathlib import Path
import unittest
ROOT = Path(__file__).resolve().parents[1]
class CleanFilesBootstrapTests(unittest.TestCase):
    def test_files_payload_is_absent_but_host_file_services_remain(self):
        for relative in ("system/apps/files","system/surface/ui/file-space-controls.mjs","system/surface/ui/files-component-runtime.mjs","system/surface/ui/files.css"):
            self.assertFalse((ROOT / relative).exists(),relative)
        for relative in ("system/contracts/file-space.mjs","system/adapters/native/file-space.mjs","system/services/files/projects.mjs","system/services/components/manifests/apps.mjs"):
            self.assertTrue((ROOT / relative).is_file(),relative)
        source = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        self.assertNotIn("mountFileSpaceControls",source)
        self.assertIn("createNativeFileSpace",source)
        catalog = (ROOT / "system/apps/catalog.mjs").read_text(encoding="utf-8")
        self.assertNotIn("filesApp",catalog)
    def test_store_does_not_install_files_implicitly(self):
        delivery = (ROOT / "system/services/apps/delivery-policy.mjs").read_text(encoding="utf-8")
        self.assertIn("authority: "+chr(34)+"none"+chr(34),delivery)
        self.assertNotIn("autoInstallFiles",delivery)
if __name__ == "__main__": unittest.main()
