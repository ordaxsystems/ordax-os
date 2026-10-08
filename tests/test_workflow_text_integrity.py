from __future__ import annotations

from pathlib import Path
import re
import unittest


ROOT = Path(__file__).resolve().parents[1]
WORKFLOWS = ROOT / ".github" / "workflows"

# This catches the exact corruption class that previously collapsed two YAML
# list items into one line, for example:  'first.py'`n      - 'second.py'
# It deliberately does not reject legitimate PowerShell `n escapes inside
# run-script bodies.
CORRUPTED_YAML_LIST_ESCAPE = re.compile(
    r"""['"]`n\s+-\s+['"]"""
)
CONFLICT_MARKER = re.compile(r"^(<<<<<<<|=======|>>>>>>>)(?:\s|$)")


class WorkflowTextIntegrityTests(unittest.TestCase):
    def workflow_files(self):
        return sorted([
            *WORKFLOWS.glob("*.yml"),
            *WORKFLOWS.glob("*.yaml"),
        ])

    def test_workflow_sources_are_utf8_text_without_nul(self):
        files = self.workflow_files()
        self.assertTrue(files, "repository must contain GitHub Actions workflows")
        for path in files:
            with self.subTest(path=path.name):
                payload = path.read_bytes()
                self.assertNotIn(b"\x00", payload)
                payload.decode("utf-8")

    def test_workflow_sources_have_no_merge_conflict_markers(self):
        for path in self.workflow_files():
            with self.subTest(path=path.name):
                for line_number, line in enumerate(
                    path.read_text(encoding="utf-8").splitlines(),
                    start=1,
                ):
                    self.assertIsNone(
                        CONFLICT_MARKER.match(line),
                        f"{path}:{line_number} contains a merge conflict marker",
                    )

    def test_yaml_list_items_cannot_be_joined_by_literal_powershell_newline_escape(self):
        for path in self.workflow_files():
            with self.subTest(path=path.name):
                text = path.read_text(encoding="utf-8")
                match = CORRUPTED_YAML_LIST_ESCAPE.search(text)
                self.assertIsNone(
                    match,
                    f"{path} contains a literal PowerShell newline between YAML list items",
                )


if __name__ == "__main__":
    unittest.main()
