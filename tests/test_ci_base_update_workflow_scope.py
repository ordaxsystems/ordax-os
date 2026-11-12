from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOW_DIR = ROOT / ".github" / "workflows"
FAT32_WORKFLOW = WORKFLOW_DIR / "base-update-fat32-proof.yml"
OWNER_WORKFLOW = WORKFLOW_DIR / "owner-remote-recovery-contract.yml"
OWNER_BASE_UPDATE_DIR = ROOT / "bootstrap" / "base-update" / "owner-development"

BASE_UPDATE_INCLUDE = "      - 'bootstrap/base-update/**'"
OWNER_EXCLUDE = "      - '!bootstrap/base-update/owner-development/**'"
FAT32_SELF_TRIGGER = "      - '.github/workflows/base-update-fat32-proof.yml'"
OWNER_INCLUDE = "      - \"bootstrap/base-update/owner-development/**\""
OWNER_ONLY_FILES = {
    "ordax-remote",
    "owner-recovery-source.json",
    "product-control-plane-origin",
}


class BaseUpdateWorkflowScopeTests(unittest.TestCase):
    def test_owner_only_slice_is_excluded_after_broad_base_update_include(self):
        text = FAT32_WORKFLOW.read_text(encoding="utf-8")
        ordered_pair = f"{BASE_UPDATE_INCLUDE}\n{OWNER_EXCLUDE}"
        self.assertEqual(text.count(BASE_UPDATE_INCLUDE), 2)
        self.assertEqual(text.count(OWNER_EXCLUDE), 2)
        self.assertEqual(text.count(ordered_pair), 2)

    def test_excluded_owner_directory_contains_only_explicit_owner_inputs(self):
        actual = {
            path.relative_to(OWNER_BASE_UPDATE_DIR).as_posix()
            for path in OWNER_BASE_UPDATE_DIR.rglob("*")
            if path.is_file()
        }
        self.assertEqual(actual, OWNER_ONLY_FILES)

    def test_real_base_update_inputs_and_workflow_self_proof_remain_in_scope(self):
        text = FAT32_WORKFLOW.read_text(encoding="utf-8")
        for trigger in (
            "      - 'bootstrap/release-acquisition/**'",
            "      - 'system/services/base-update/*.py'",
            "      - 'tools/release-manifest/**'",
            "      - 'tools/release-signing/**'",
            "      - 'docs/contracts/base-update.json'",
            "      - 'tests/test_base_update_*.py'",
            FAT32_SELF_TRIGGER,
        ):
            with self.subTest(trigger=trigger):
                self.assertEqual(text.count(trigger), 2)

    def test_owner_slice_retains_its_own_focused_gate(self):
        text = OWNER_WORKFLOW.read_text(encoding="utf-8")
        self.assertEqual(text.count(OWNER_INCLUDE), 2)
        self.assertIn("Verify Owner recovery contract and helper policy", text)
        self.assertIn("Verify exact Runtime release bytes", text)


if __name__ == "__main__":
    unittest.main()
