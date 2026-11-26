"""Ensure operational docs cannot silently become historical state authority again."""
from pathlib import Path
import re
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
DOCUMENT = ROOT / "docs/CURRENT-STATE.md"


class CurrentStateIndexTests(unittest.TestCase):
    def test_index_is_bounded_and_contains_no_frozen_commit_pins(self):
        text = DOCUMENT.read_text(encoding="utf-8")
        self.assertLessEqual(len(text.splitlines()), 120)
        self.assertIn("código da revisão efetivamente integrada", text)
        self.assertIn("recibos do destino", text)
        self.assertIn("documento NÃO é um snapshot", text)
        self.assertNotRegex(text, r"\b[0-9a-f]{40}\b")
        self.assertNotIn("Execução operacional paralela por owner", text)

    def test_index_points_at_source_in_git_not_archived_document_claims(self):
        text = DOCUMENT.read_text(encoding="utf-8")
        for name in (
            "bootstrap/initramfs/root/init",
            "bootstrap/dev-base/ordax-pull",
            "system/supervisor",
            "desktop/dev-update.cjs",
            "creator/core/storage_image.go",
            "creator/cmd/ordax-creator/main.go",
        ):
            with self.subTest(path=name):
                self.assertIn(name, text)
                result = subprocess.run(
                    ["git", "-C", str(ROOT), "cat-file", "-e", "HEAD:" + name],
                    capture_output=True, timeout=15,
                )
                self.assertEqual(result.returncode, 0, name)

    def test_legacy_mentions_are_prohibitions_not_old_instructions(self):
        text = DOCUMENT.read_text(encoding="utf-8")
        self.assertIn("Não restaurar bootstrap/dev-base/build.py", text)
        self.assertIn("não** reativadas", text)
        self.assertIn("Não acrescentar cronologias", text)


if __name__ == "__main__":
    unittest.main()
