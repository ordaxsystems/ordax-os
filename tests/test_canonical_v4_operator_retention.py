"""Keep the canonical v4 operator artifacts available for unsigned assembly."""
from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"
OWNERS = {
    "system": "portable-release-image.yml",
    "surface": "surface-runtime-lock-discovery.yml",
    "local-ai": "local-ai-runtime-candidate.yml",
}


class CanonicalV4OperatorRetentionTests(unittest.TestCase):
    def operator_block(self, kind, filename):
        source = (WORKFLOWS / filename).read_text(encoding="utf-8")
        marker = "name: canonical-v4-operator-" + kind + "-" + "$" + "{{ github.sha }}"
        self.assertEqual(source.count(marker), 1)
        before, after = source.split(marker)
        return before.rsplit("- name:", 1)[-1], after.split("\n      - name:", 1)[0]

    def test_operator_artifact_retention_matches_assembly_window(self):
        for kind, filename in OWNERS.items():
            with self.subTest(kind=kind):
                _, block = self.operator_block(kind, filename)
                self.assertIn("operator-receipt.json", block)
                self.assertIn("if-no-files-found: error", block)
                matches = re.findall(r"(?m)^\s+retention-days: (\d+)\s*$", block)
                self.assertEqual(len(matches), 1, filename)
                self.assertGreaterEqual(int(matches[0]), 14)
                self.assertLessEqual(int(matches[0]), 30)

    def test_operator_payloads_stay_manual_only(self):
        for kind, filename in OWNERS.items():
            with self.subTest(kind=kind):
                before, _ = self.operator_block(kind, filename)
                self.assertIn("github.event_name == 'workflow_dispatch'", before)


if __name__ == "__main__":
    unittest.main()
