#!/usr/bin/env python3
"""Regression contract for development pull/helper activation status."""

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
PULL = ROOT / "bootstrap/dev-base/ordax-pull"


class DevPullHelperRefreshContractTests(unittest.TestCase):
    def test_pull_shell_is_syntactically_valid(self) -> None:
        subprocess.run(["/bin/sh", "-n", str(PULL)], check=True)

    def test_helper_refresh_failure_is_not_reported_as_pull_success(self) -> None:
        text = PULL.read_text(encoding="utf-8")
        refresh = text.split("refresh_dev_helpers() {", 1)[1].split("\n}\n", 1)[0]

        self.assertIn("helper activation is incomplete", refresh)
        self.assertIn("return 1", refresh)
        self.assertNotIn(
            "development Base helper refresh failed; runtime checkout remains active",
            refresh,
        )
        self.assertIn('refresh_dev_helpers "$current" || exit 1', text)
        self.assertLess(
            text.index('refresh_dev_helpers "$current" || exit 1'),
            text.index("printf 'ORDAX_SOURCE_SHA=%s\\n' \"$current\""),
        )

    def test_helper_refresh_is_a_separate_activation_receipt(self) -> None:
        text = PULL.read_text(encoding="utf-8")

        self.assertIn('write_state "$CURRENT_FILE" "$current"', text)
        self.assertIn('refresh_dev_helpers "$current" || exit 1', text)
        self.assertLess(
            text.rindex('write_state "$CURRENT_FILE" "$current"'),
            text.index('refresh_dev_helpers "$current" || exit 1'),
        )


if __name__ == "__main__":
    unittest.main()
