"""One exact Git path contract for independent CI impact gates.

Each classifier keeps its own policy; this fixture proves that the Git output
does not quote or split repository paths and cause an unnecessary heavy build.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

from tools.ci import (
    creator_owner_impact,
    independent_surface_impact,
    portable_qemu_impact,
)


class CiGitDiffExactPathsTests(unittest.TestCase):
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
