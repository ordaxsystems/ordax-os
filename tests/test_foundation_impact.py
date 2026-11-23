from pathlib import Path
import subprocess
import tempfile
import unittest

from tools.ci.foundation_impact import changed_paths_between, classify_changes


class FoundationImpactTests(unittest.TestCase):
    def test_exact_documentation_allowlist_uses_docs_mode(self):
        impact = classify_changes([("M", "docs/DEVELOPMENT-WORKFLOW.md")])
        self.assertEqual(impact.mode, "docs")

    def test_modified_test_modules_select_only_the_changed_modules(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_native_contract.py").write_text("", encoding="utf-8")
            (tests / "test_web_contract.mjs").write_text("", encoding="utf-8")

            impact = classify_changes(
                [
                    ("M", "tests/test_native_contract.py"),
                    ("M", "tests/test_web_contract.mjs"),
                ],
                root=root,
            )

        self.assertEqual(impact.mode, "tests")
        self.assertEqual(
            impact.test_paths,
            ("tests/test_native_contract.py", "tests/test_web_contract.mjs"),
        )

    def test_added_or_deleted_test_modules_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_native_contract.py").write_text("", encoding="utf-8")

            self.assertEqual(
                classify_changes([("A", "tests/test_native_contract.py")], root=root).mode,
                "full",
            )
            self.assertEqual(
                classify_changes([("D", "tests/test_native_contract.py")], root=root).mode,
                "full",
            )

    def test_source_unknown_or_empty_diffs_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_native_contract.py").write_text("", encoding="utf-8")
            cases = (
                [("M", "tests/test_native_contract.py"), ("M", "system/contracts/core.mjs")],
                [("M", "tests/fixture.json")],
                [("M", "unrecognized/path.txt")],
                [],
            )
            for changes in cases:
                with self.subTest(changes=changes):
                    self.assertEqual(classify_changes(changes, root=root).mode, "full")

    def test_test_symlink_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            tests = root / "tests"
            tests.mkdir()
            target = tests / "target.py"
            target.write_text("", encoding="utf-8")
            link = tests / "test_link.py"
            try:
                link.symlink_to(target)
            except (OSError, NotImplementedError):
                self.skipTest("symlink creation is unavailable")
            self.assertEqual(
                classify_changes([("M", "tests/test_link.py")], root=root).mode,
                "full",
            )

    def test_push_diff_includes_every_commit_in_the_range(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._git(root, "init", "-b", "main")
            self._git(root, "config", "user.name", "Foundation Impact Test")
            self._git(root, "config", "user.email", "foundation-impact@example.invalid")
            (root / "README.md").write_text("base\n", encoding="utf-8")
            tests = root / "tests"
            tests.mkdir()
            first = tests / "test_first.py"
            first.write_text("base\n", encoding="utf-8")
            second = tests / "test_second.mjs"
            second.write_text("base\n", encoding="utf-8")
            self._git(root, "add", "README.md", "tests/test_first.py", "tests/test_second.mjs")
            self._git(root, "commit", "-m", "base")
            base = self._git(root, "rev-parse", "HEAD")

            first.write_text("changed first\n", encoding="utf-8")
            self._git(root, "add", "tests/test_first.py")
            self._git(root, "commit", "-m", "first test")
            first_head = self._git(root, "rev-parse", "HEAD")

            second.write_text("changed second\n", encoding="utf-8")
            self._git(root, "add", "tests/test_second.mjs")
            self._git(root, "commit", "-m", "second test")
            second_parent = self._git(root, "rev-parse", "HEAD^")
            head = self._git(root, "rev-parse", "HEAD")

            changes = changed_paths_between(base, head, root=root)
            impact = classify_changes(changes, root=root)

        self.assertEqual(first_head, second_parent)
        self.assertEqual(impact.mode, "tests")
        self.assertEqual(
            impact.test_paths,
            ("tests/test_first.py", "tests/test_second.mjs"),
        )

    def test_pull_request_merge_base_excludes_target_only_changes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            self._git(root, "init", "-b", "main")
            self._git(root, "config", "user.name", "Foundation Impact Test")
            self._git(root, "config", "user.email", "foundation-impact@example.invalid")
            (root / "README.md").write_text("base\n", encoding="utf-8")
            self._git(root, "add", "README.md")
            self._git(root, "commit", "-m", "base")
            self._git(root, "branch", "feature")

            self._git(root, "checkout", "feature")
            tests = root / "tests"
            tests.mkdir()
            (tests / "test_feature.py").write_text("", encoding="utf-8")
            self._git(root, "add", "tests/test_feature.py")
            self._git(root, "commit", "-m", "feature test")

            self._git(root, "checkout", "main")
            (root / "main-only.txt").write_text("main\n", encoding="utf-8")
            self._git(root, "add", "main-only.txt")
            self._git(root, "commit", "-m", "target-only change")
            base = self._git(root, "rev-parse", "HEAD")
            head = self._git(root, "rev-parse", "feature")

            changes = changed_paths_between(base, head, root=root, use_merge_base=True)

        self.assertEqual(changes, (("A", "tests/test_feature.py"),))

    @staticmethod
    def _git(root: Path, *arguments: str) -> str:
        result = subprocess.run(
            ["git", "-C", str(root), *arguments],
            check=True,
            capture_output=True,
            text=True,
        )
        return result.stdout.strip()

if __name__ == "__main__":
    unittest.main()
