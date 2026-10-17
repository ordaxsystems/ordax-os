#!/usr/bin/env python3
"""Contracts for bounded Owner/Development cold-start Surface health."""

from __future__ import annotations

from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUN = ROOT / "bootstrap/dev-base/ordax-run"


class DevRunInitialHealthBudgetTest(unittest.TestCase):
    def test_runner_remains_valid_shell(self) -> None:
        subprocess.run(["/bin/sh", "-n", str(RUN)], check=True)

    def test_owner_cold_start_budget_matches_existing_surface_liveness_window(self) -> None:
        text = RUN.read_text(encoding="utf-8")
        self.assertIn(
            "OWNER_INITIAL_HEALTH_TIMEOUT=${ORDAX_OWNER_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS:-90}",
            text,
        )
        self.assertIn(
            'ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS="$OWNER_INITIAL_HEALTH_TIMEOUT"',
            text,
        )
        self.assertIn(
            '[ "$OWNER_INITIAL_HEALTH_TIMEOUT" -ge 30 ] 2>/dev/null || OWNER_INITIAL_HEALTH_TIMEOUT=90',
            text,
        )
        self.assertIn(
            '[ "$OWNER_INITIAL_HEALTH_TIMEOUT" -le 300 ] 2>/dev/null || OWNER_INITIAL_HEALTH_TIMEOUT=300',
            text,
        )

    def test_stable_profile_is_not_modified_by_owner_runner_policy(self) -> None:
        text = RUN.read_text(encoding="utf-8")
        self.assertIn("ORDAX_DISTRIBUTION_PROFILE=owner-development", text)
        self.assertNotIn("ORDAX_DISTRIBUTION_PROFILE=stable-mvp", text)


if __name__ == "__main__":
    unittest.main()
