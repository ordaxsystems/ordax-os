import unittest
import os
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = (Path(os.environ["ORDAX_CREATOR_NATIVE_SOURCE"]) / "host/windows/portable_apply_windows.go"
           if os.environ.get("ORDAX_CREATOR_NATIVE_SOURCE") else None)


class PortableWindowsGPTSourceBoundaryTests(unittest.TestCase):
    def test_gpt_regression_uses_immutable_creator_source_in_windows_safety_ci(self):
        pin = json.loads((ROOT / "docs/contracts/native-release-assembly.json").read_text(encoding="utf-8"))["creator_source"]
        self.assertEqual(pin["repository"], "ordaxsystems/ordax-creator")
        workflow = (ROOT / ".github/workflows/physical-usb-test-toolkit.yml").read_text(encoding="utf-8")
        self.assertIn("uses: ./.github/actions/resolve-creator-source", workflow)
        self.assertIn("tests.test_portable_windows_gpt_idempotence", workflow)
        self.assertNotIn("Push-Location tools/creator", workflow)


@unittest.skipUnless(os.environ.get("ORDAX_CREATOR_NATIVE_SOURCE"),
                     "Windows PowerShell GPT implementation is checked from pinned independent Creator source")
class PortableWindowsGPTIdempotenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.runtime = RUNTIME.read_text(encoding="utf-8")

    def test_reuses_empty_gpt_after_clear_disk(self):
        self.assertIn("$style=([string]$disk.PartitionStyle).ToUpperInvariant()", self.runtime)
        self.assertIn("if ($style -eq 'RAW')", self.runtime)
        self.assertIn("elseif ($style -eq 'GPT')", self.runtime)
        self.assertIn("ORDAX_PORTABLE_GPT_STAGE=reuse-gpt", self.runtime)
        self.assertIn("Portable disk still has partitions after Clear-Disk", self.runtime)

    def test_initialize_disk_only_runs_for_raw(self):
        raw_branch = "if ($style -eq 'RAW') {\n    'ORDAX_PORTABLE_GPT_STAGE=initialize'\n    Initialize-Disk -Number $d -PartitionStyle GPT -ErrorAction Stop\n} elseif ($style -eq 'GPT') {"
        self.assertIn(raw_branch, self.runtime)

    def test_non_raw_non_gpt_style_fails_closed(self):
        self.assertIn("Portable disk has unsupported partition style after Clear-Disk", self.runtime)


if __name__ == "__main__":
    unittest.main()
