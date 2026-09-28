from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTROLLER = ROOT / "system/surface/ui/workspace-intelligence-handoff-controls.mjs"
NATIVE = ROOT / "system/composition/native/main.mjs"


class IntelligenceWorkspaceSurfaceHandoffTests(unittest.TestCase):
    def test_controller_is_syntax_valid(self):
        subprocess.run(
            ["node", "--check", str(CONTROLLER)],
            cwd=ROOT,
            check=True,
            capture_output=True,
            text=True,
        )

    def test_workspace_is_shared_only_from_explicit_system_action(self):
        text = CONTROLLER.read_text(encoding="utf-8")
        self.assertIn("data-system-intelligence-workspace-action", text)
        self.assertIn("const onClick = (event) =>", text)
        self.assertIn("openWorkspacePlan();", text)
        self.assertIn("const workspace = workspaceStore.load();", text)
        self.assertIn("offerWorkspaceSelectionToIntelligence(contextShare, workspace)", text)
        self.assertIn("createWorkspaceSelectionIntelligenceHandoff(shared)", text)
        self.assertIn('appId: "intelligence"', text)
        self.assertIn('sourceAppId: "system"', text)
        self.assertNotIn("windowState.target", text)
        self.assertNotIn("grantId", text)

        click_index = text.index("const onClick = (event) =>")
        load_index = text.index("const workspace = workspaceStore.load();")
        self.assertLess(load_index, click_index)
        self.assertIn("openWorkspacePlan();", text[click_index:])

    def test_navigation_failure_revokes_pending_workspace_grant(self):
        text = CONTROLLER.read_text(encoding="utf-8")
        self.assertIn("const revokeShared = (shared) =>", text)
        self.assertIn("contextShare.take({", text)
        self.assertIn("contextShare.revoke(authorization)", text)
        self.assertIn("revokeShared(shared);", text)

        offer_index = text.index("shared = offerWorkspaceSelectionToIntelligence")
        publish_index = text.index("activation.publish({", offer_index)
        release_index = text.index("shared = null;", publish_index)
        self.assertLess(offer_index, publish_index)
        self.assertLess(publish_index, release_index)

    def test_native_composition_mounts_and_destroys_controller(self):
        text = NATIVE.read_text(encoding="utf-8")
        self.assertIn("mountWorkspaceIntelligenceHandoffControls", text)
        self.assertIn(
            "const workspaceIntelligenceHandoffControls = mountWorkspaceIntelligenceHandoffControls(",
            text,
        )
        self.assertIn("workspaceIntelligenceHandoffControls.destroy();", text)


if __name__ == "__main__":
    unittest.main()
