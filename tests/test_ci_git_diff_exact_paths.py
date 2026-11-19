"""One exact Git path contract for independent CI impact gates.

Each classifier keeps its own policy; this fixture proves that the Git output
does not quote or split repository paths and cause an unnecessary heavy build.
"""
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from tools.ci import (
    creator_owner_impact,
    independent_surface_impact,
    portable_qemu_impact,
)


class CiGitDiffExactPathsTests(unittest.TestCase):
    def test_github_output_filename_line_breaks_cannot_add_required_false(self):
        injected = "unsafe\nrequired=false\r\nreason=spoof"
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            for index, (module, writer) in enumerate((
                (independent_surface_impact, independent_surface_impact.write_output),
                (portable_qemu_impact, portable_qemu_impact.write_github_output),
            )):
                with self.subTest(module=module.__name__):
                    output = root / f"impact-{index}.txt"
                    result = module.ImpactResult(True, (f"unclassified:{injected}",), (injected,))
                    writer(output, result)
                    lines = output.read_text(encoding="utf-8").splitlines()
                    self.assertEqual(len(lines), 3)
                    self.assertEqual(lines[0], "required=true")
                    self.assertIn(r"\nrequired=false\r\nreason=spoof", lines[1])
                    self.assertEqual(lines[2], "changed_count=1")

            creator_output = root / "creator.txt"
            with (
                patch.object(creator_owner_impact, "classify",
                             return_value=(True, f"real-or-unknown-usb-producer:{injected}")),
                patch.dict(os.environ, {"GITHUB_OUTPUT": str(creator_output),
                                        "GITHUB_EVENT_NAME": "push"}),
                patch.object(sys, "argv", ["creator_owner_impact.py", "classify",
                                           "--base", "a" * 40, "--head", "b" * 40]),
            ):
                self.assertEqual(creator_owner_impact.main(), 0)
            lines = creator_output.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 2)
            self.assertEqual(lines[0], "required=true")
            self.assertIn(r"\nrequired=false\r\nreason=spoof", lines[1])

    def test_utf8_markdown_paths_are_returned_verbatim_by_all_three_gates(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)

            def git(*args):
                return subprocess.check_output(
                    ["git", "-C", str(root), *args], stderr=subprocess.PIPE
                ).decode("utf-8").strip()

            git("init", "-q")
            git("config", "user.name", "CI")
            git("config", "user.email", "ci@example.invalid")
            git("config", "core.quotepath", "true")

            names = ("docs/Guia-á.md", "docs/normal.md")
            for name in names:
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("before\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "initial")
            base = git("rev-parse", "HEAD")

            for name in names:
                (root / name).write_text("after\n", encoding="utf-8")
            git("add", "-A")
            git("commit", "-qm", "update docs")
            head = git("rev-parse", "HEAD")

            extractors = (
                creator_owner_impact.changed_paths,
                independent_surface_impact.changed_paths_between,
                portable_qemu_impact.changed_paths_between,
            )
            for extractor in extractors:
                with self.subTest(extractor=extractor.__module__):
                    paths = extractor(base, head, root=root)
                    self.assertEqual(set(paths), set(names))
                    self.assertFalse(any(path.startswith('"') for path in paths))

            result = independent_surface_impact.classify_paths(
                independent_surface_impact.changed_paths_between(base, head, root=root)
            )
            self.assertFalse(result.required)
            self.assertEqual(result.reasons, ("contract-only",))

    def test_invalid_revision_still_fails_closed(self):
        for extractor in (
            creator_owner_impact.changed_paths,
            independent_surface_impact.changed_paths_between,
            portable_qemu_impact.changed_paths_between,
        ):
            with self.subTest(extractor=extractor.__module__):
                with self.assertRaises(ValueError):
                    extractor("0" * 40, "f" * 40)


if __name__ == "__main__":
    unittest.main()
