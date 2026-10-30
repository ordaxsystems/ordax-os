from pathlib import Path
import os
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
HELPER = (Path(os.environ["ORDAX_CREATOR_NATIVE_SOURCE"])
          / "cmd/ordax-creator-physical-test/main_windows.go"
          if os.environ.get("ORDAX_CREATOR_NATIVE_SOURCE") else None)
WORKFLOW = ROOT / ".github/workflows/creator-owner-dev-git.yml"


class OwnerDevHelperSourceBoundaryTests(unittest.TestCase):
    def test_owner_and_windows_ci_bind_the_helper_to_the_single_source_lock(self):
        pin = json.loads((ROOT / "docs/contracts/native-release-assembly.json").read_text(encoding="utf-8"))["creator_source"]
        self.assertEqual(pin["repository"], "ordaxsystems/ordax-creator")
        self.assertIs(pin["physical_apply_authorized"], False)
        owner = WORKFLOW.read_text(encoding="utf-8")
        physical = (ROOT / ".github/workflows/physical-usb-test-toolkit.yml").read_text(encoding="utf-8")
        self.assertIn("uses: ./.github/actions/resolve-creator-source", owner)
        self.assertIn("uses: ./.github/actions/resolve-creator-source", physical)
        self.assertIn("tests/test_owner_dev_helper_storage_profile.py", physical)
        self.assertIn("-X main.buildStorageProfile=owner-development", owner)


@unittest.skipUnless(os.environ.get("ORDAX_CREATOR_NATIVE_SOURCE"),
                     "Windows helper implementation is checked from pinned standalone source in Windows CI")
class OwnerDevHelperStorageProfileTests(unittest.TestCase):
    def test_owner_workflow_binds_development_storage_profile_into_split_helper(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("-X main.buildStorageProfile=owner-development", workflow)

    def test_split_helper_resolves_profile_once_per_prepare_and_apply(self):
        source = HELPER.read_text(encoding="utf-8")
        self.assertIn('buildStorageProfile                 = ""', source)
        self.assertIn('StorageProfile                  string `json:"storage_profile"`', source)
        self.assertIn("StorageProfile: buildStorageProfile", source)
        self.assertIn("func resolveStorageProfile(value string)", source)
        self.assertIn('case "":\n\t\treturn false, nil', source)
        self.assertIn('case "owner-development":\n\t\treturn true, nil', source)
        self.assertIn('return false, fmt.Errorf("unknown build storage profile %q", value)', source)
        self.assertEqual(source.count("resolveStorageProfile(b.StorageProfile)"), 2)
        self.assertIn("PrepareOwnerDevelopmentStorageImage", source)
        self.assertIn("StorageProfile: b.StorageProfile", source)

    def test_apply_reuses_owner_profile_for_data_format_layout_before_destructive_call(self):
        source = HELPER.read_text(encoding="utf-8")
        start = source.index("func runApply(args []string) error {")
        end = source.index("func usage()", start)
        apply_source = source[start:end]
        self.assertIn("resolveStorageProfile(b.StorageProfile)", apply_source)
        self.assertIn("creatorcore.PlanOwnerDevelopmentStorage(target.PhysicalDiskBytes)", apply_source)
        self.assertIn("creatorcore.PlanPhysicalStorage(target.PhysicalDiskBytes)", apply_source)
        self.assertIn(
            "windowsadapter.FormatPortableDataVolume(target, layout.DataStartLBA, layout.DataBytes)",
            apply_source,
        )
        self.assertLess(
            apply_source.index("resolveStorageProfile(b.StorageProfile)"),
            apply_source.index("windowsadapter.ApplyPhysicalTestWithProgress"),
        )

    def test_public_helper_default_remains_public_layout(self):
        source = HELPER.read_text(encoding="utf-8")
        self.assertIn(
            '} else {\n\t\tprepared, err = creatorcore.PreparePhysicalStorageImage(',
            source,
        )
        self.assertIn(
            '} else {\n\t\tlayout, err = creatorcore.PlanPhysicalStorage(',
            source,
        )


if __name__ == "__main__":
    unittest.main()
