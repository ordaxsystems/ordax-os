import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
RUNTIME = ROOT / "tools/creator/host/windows/portable_apply_windows.go"


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
