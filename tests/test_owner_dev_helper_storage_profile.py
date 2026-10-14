from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = ROOT / "tools/creator/cmd/ordax-creator-physical-test/main_windows.go"
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"


class OwnerDevHelperStorageProfileTests(unittest.TestCase):
    def test_owner_workflow_binds_development_storage_profile_into_split_helper(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("-X main.buildStorageProfile=owner-development", workflow)

    def test_split_helper_uses_build_profile_for_prepare_and_apply(self):
        source = HELPER.read_text(encoding="utf-8")
        self.assertIn('buildStorageProfile                 = ""', source)
        self.assertIn('StorageProfile                  string `json:"storage_profile"`', source)
        self.assertIn("StorageProfile: buildStorageProfile", source)
        self.assertIn(
            'case "owner-development":\n'
            '\t\tprepared, err = creatorcore.PrepareOwnerDevelopmentStorageImage(',
            source,
        )
        self.assertIn("StorageProfile: b.StorageProfile", source)
        self.assertIn(
            'default:\n\t\treturn fmt.Errorf("unknown build storage profile %q", b.StorageProfile)',
            source,
        )

    def test_public_helper_default_remains_public_layout(self):
        source = HELPER.read_text(encoding="utf-8")
        match = re.search(
            r'switch b\.StorageProfile \{\n'
            r'\tcase "":\n'
            r'\t\tprepared, err = creatorcore\.PreparePhysicalStorageImage\(',
            source,
        )
        self.assertIsNotNone(match)


if __name__ == "__main__":
    unittest.main()