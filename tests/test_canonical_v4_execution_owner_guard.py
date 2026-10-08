"""Release signing request cannot authorize assembly under a redirected owner."""
from contextlib import redirect_stderr, redirect_stdout
import io
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools/release-operator"))
import select_active_signing_request as selector


class CanonicalV4ExecutionOwnerGuardTests(unittest.TestCase):
    def test_wrong_github_owner_is_blocked_before_active_request_selection(self):
        other = "untrusted/other-ordax-repository"
        self.assertNotEqual(other, selector.REPOSITORY)
        status = selector.selection(ROOT, execution_repository=other)
        self.assertEqual(status["status"], "blocked-execution-repository-identity-mismatch")
        self.assertFalse(status["active"])
        self.assertTrue(status["historical_request_preserved"])
        self.assertEqual(status["source_repository"], selector.REPOSITORY)
        self.assertEqual(status["execution_repository"], other)
        self.assertFalse(status["signing_performed"])
        self.assertFalse(status["publication_performed"])

    def test_github_output_marks_owner_mismatch_inactive_even_with_historical_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "result.txt"
            stdout = io.StringIO()
            with (
                mock.patch.dict(os.environ, {"GITHUB_REPOSITORY": "untrusted/other-ordax-repository"}),
                mock.patch.object(sys, "argv", ["release-selector", "--github-output", str(output)]),
                redirect_stdout(stdout),
            ):
                result = selector.main()
            self.assertEqual(result, 0)
            self.assertEqual(output.read_text(encoding="utf-8"), "active=false\n")
            self.assertIn("blocked-execution-repository-identity-mismatch", stdout.getvalue())

    def test_missing_github_execution_owner_fails_closed_in_cli(self):
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / "result.txt"
            stderr = io.StringIO()
            with (
                mock.patch.dict(os.environ, {}, clear=True),
                mock.patch.object(sys, "argv", ["release-selector", "--github-output", str(output)]),
                redirect_stderr(stderr),
            ):
                result = selector.main()
            self.assertEqual(result, 2)
            self.assertFalse(output.exists())
            self.assertIn("GitHub execution repository identity is unavailable", stderr.getvalue())

    def test_matching_explicit_owner_uses_existing_request_validation(self):
        status = selector.selection(ROOT, execution_repository=selector.REPOSITORY)
        self.assertNotEqual(status["status"], "blocked-execution-repository-identity-mismatch")
        self.assertEqual(status["source_repository"] if status["active"] else selector.REPOSITORY, selector.REPOSITORY)
        self.assertFalse(status["signing_performed"])
        self.assertFalse(status["publication_performed"])


if __name__ == "__main__":
    unittest.main()
