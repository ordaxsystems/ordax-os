"""Physical Files Gate A: app source removed, Native file services retained.

Original app-owned code and behavior tests remain recoverable from the
immutable Files snapshot in ordax-apps/migrations/files.source-snapshot.json.
The app remains unavailable until independent Gate B and signed install proof.
"""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
OWNED = (
    "system/apps/files",
    "system/surface/ui/file-space-controls.mjs",
    "system/surface/ui/file-space-response-identity.mjs",
    "system/surface/ui/files-component-runtime.mjs",
    "system/surface/ui/files.css",
    "system/services/i18n/catalog/files.mjs",
)

class FilesBootstrapContinuityTests(unittest.TestCase):
    def test_no_duplicate_native_files_implementation_before_gate_b(self):
        for item in OWNED:
            self.assertFalse((ROOT / item).exists(), item)
        for item in (
            "system/contracts/file-space.mjs",
            "system/adapters/native/file-space.mjs",
            "system/contracts/app-activation.mjs",
            "system/contracts/recent-files.mjs",
            "system/contracts/project-catalog.mjs",
            "system/services/files/recent-files.mjs",
            "system/services/files/project-continuity-file-space.mjs",
            "system/contracts/first-party-app.mjs",
        ):
            self.assertTrue((ROOT / item).is_file(), item)

    def test_missing_files_is_explicitly_fail_closed(self):
        policy = json.loads((ROOT / "docs/contracts/runtime-component-package.json").read_text(encoding="utf-8"))
        sdk = json.loads((ROOT / "sdk/app-sdk-v1/runtime-component-package-policy.json").read_text(encoding="utf-8"))
        self.assertEqual(policy, sdk)
        self.assertNotIn("files", policy["canonical_package_source_repository_by_component"])
        pending = policy["prelaunch_remove_first_pending"]["files"]
        self.assertEqual(pending["state"], "platform-source-removed-app-source-pending")
        self.assertFalse(pending["distribution_activation_allowed"])
        main = (ROOT / "system/composition/native/main.mjs").read_text(encoding="utf-8")
        self.assertNotIn("mountFileSpaceControls", main)
        self.assertNotIn("fileSpaceControls.destroy()", main)
        self.assertIn("createNativeRecentFilesStore", main)
        delivery = (ROOT / "system/services/apps/delivery-policy.mjs").read_text(encoding="utf-8")
        self.assertIn('appId: "files", deliveryClass: "bootstrap"', delivery)
        self.assertIn('authority: "none"', delivery)

if __name__ == "__main__":
    unittest.main()
