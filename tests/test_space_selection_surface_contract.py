from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "system" / "contracts" / "space-selection.mjs"
RUNTIME = ROOT / "system" / "services" / "spaces" / "selection.mjs"
NATIVE_STORE = ROOT / "system" / "adapters" / "native" / "space-selection.mjs"
ACCOUNT_UI = ROOT / "system" / "surface" / "ui" / "account-overview-controls.mjs"
NATIVE_MAIN = ROOT / "system" / "composition" / "native" / "main.mjs"
WEB_MAIN = ROOT / "system" / "composition" / "web" / "main.tsx"
WORKSPACE = ROOT / "system" / "contracts" / "workspace-store.mjs"
ACCOUNT_I18N = ROOT / "system" / "services" / "i18n" / "catalog" / "account.mjs"


class SpaceSelectionSurfaceContractTests(unittest.TestCase):
    def test_space_selection_is_separate_from_visual_workspace_and_sync(self):
        contract = CONTRACT.read_text(encoding="utf-8")
        runtime = RUNTIME.read_text(encoding="utf-8")
        workspace = WORKSPACE.read_text(encoding="utf-8")

        self.assertIn('SPACE_SELECTION_SCHEMA = "ordax.space-selection/1"', contract)
        self.assertIn('SPACE_SELECTION_RECORD_SCHEMA = "ordax.space-selection-record/1"', contract)
        self.assertIn("subjectId", contract)
        self.assertIn("selectedSpaceId", contract)
        self.assertIn("assertIdentitySessionPort", runtime)
        self.assertIn("assertSpacesPort", runtime)
        self.assertIn("record.subjectId !== identitySnapshot.subjectId", runtime)
        self.assertIn('space.state !== "active"', runtime)
        self.assertNotIn("selectedSpaceId", workspace)
        self.assertNotIn("SPACE_SELECTION", workspace)

    def test_native_persists_only_identity_bound_space_selection(self):
        adapter = NATIVE_STORE.read_text(encoding="utf-8")
        native = NATIVE_MAIN.read_text(encoding="utf-8")
        web = WEB_MAIN.read_text(encoding="utf-8")

        self.assertIn('STORAGE_KEY = "ordax.native.space-selection.v1"', adapter)
        self.assertNotIn("profilePack", adapter)
        self.assertNotIn("content", adapter)
        self.assertIn("createNativeSpaceSelectionStore", native)
        self.assertIn("createSpaceSelectionRuntime", native)
        self.assertIn("spaceSelection.dispose()", native)
        self.assertNotIn("createNativeSpaceSelectionStore", web)

    def test_account_surface_requires_explicit_user_selection(self):
        ui = ACCOUNT_UI.read_text(encoding="utf-8")
        catalog = ACCOUNT_I18N.read_text(encoding="utf-8")

        self.assertIn("assertSpaceSelectionPort", ui)
        self.assertIn("data-account-space-select", ui.replace("dataset.accountSpaceSelect", "data-account-space-select"))
        self.assertIn("spaceSelectionPort.select", ui)
        self.assertIn("space.state === \"active\"", ui)
        self.assertIn('"account.spaces.selection.use": "Usar este Space"', catalog)
        self.assertIn('"account.spaces.selection.selected": "Space em uso"', catalog)
        self.assertIn('"account.spaces.selection.use": "Use this Space"', catalog)


if __name__ == "__main__":
    unittest.main()
