from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "system/surface/ui/file-intelligence-handoff-controls.mjs"
NATIVE = ROOT / "system/composition/native/main.mjs"


class IntelligenceFileSurfaceHandoffTests(unittest.TestCase):
    def test_controller_is_syntax_valid(self):
        subprocess.run(
            ["node", "--check", str(CONTROLLER)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_controller_reads_only_after_explicit_action_and_keeps_path_local(self):
        text = CONTROLLER.read_text(encoding="utf-8")
        self.assertIn("data-file-intelligence-handoff-action", text)
        self.assertIn("const onClick = (event) =>", text)
        self.assertIn("void shareSelectedFile();", text)
        self.assertIn("await port.readTextFile(path)", text)
        self.assertIn("MAX_TEXT_FILE_BYTES", text)
        self.assertIn("offerFileSelectionToIntelligence", text)
        self.assertIn("createFileSelectionIntelligenceHandoff", text)
        self.assertIn('appId: "intelligence"', text)
        self.assertIn("beforeEntry.modifiedAt", text)
        self.assertIn("afterEntry.modifiedAt", text)
        self.assertIn("selectedFilePath() !== path", text)
        self.assertIn("textFile.path !== path", text)
        self.assertNotIn("grantId", text)

        offer = text.split("offerFileSelectionToIntelligence(contextShare, {", 1)[1].split("});", 1)[0]
        self.assertIn("name: afterEntry.name", offer)
        self.assertIn("size: afterEntry.size", offer)
        self.assertIn("modifiedAt: afterEntry.modifiedAt", offer)
        self.assertIn("text: textFile.text", offer)
        self.assertNotIn("path:", offer)

    def test_pending_grant_is_revoked_if_navigation_cannot_take_ownership(self):
        text = CONTROLLER.read_text(encoding="utf-8")
        self.assertIn("const revokeShared = (shared) =>", text)
        self.assertIn("contextShare.take({", text)
        self.assertIn("contextShare.revoke(authorization)", text)
        self.assertGreaterEqual(text.count("revokeShared(shared);"), 2)

        offer_index = text.index("shared = offerFileSelectionToIntelligence")
        publish_index = text.index("activation.publish({", offer_index)
        release_index = text.index("shared = null;", publish_index)
        self.assertLess(offer_index, publish_index)
        self.assertLess(publish_index, release_index)

    def test_native_composition_mounts_and_destroys_controller(self):
        text = NATIVE.read_text(encoding="utf-8")
        self.assertIn("mountFileIntelligenceHandoffControls", text)
        self.assertIn("const fileIntelligenceHandoffControls = mountFileIntelligenceHandoffControls(", text)
        self.assertIn("fileIntelligenceHandoffControls.destroy();", text)


if __name__ == "__main__":
    unittest.main()
