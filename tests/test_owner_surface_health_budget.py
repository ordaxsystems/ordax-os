import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = ROOT / "system" / "entrypoint"
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"


class OwnerSurfaceHealthBudgetTests(unittest.TestCase):
    def test_entrypoint_remains_valid_shell(self):
        subprocess.run(["/bin/sh", "-n", str(ENTRYPOINT)], check=True)

    def test_owner_guardian_owns_surface_health_defaults(self):
        entrypoint = ENTRYPOINT.read_text(encoding="utf-8")
        owner_block = entrypoint.split('if [ "$DISTRIBUTION_PROFILE" = "owner-development" ]; then', 1)[1].split("\nfi", 1)[0]

        self.assertIn(
            'if [ -z "${ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS+x}" ]; then',
            owner_block,
        )
        self.assertIn("ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS=90", owner_block)
        self.assertIn("export ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS", owner_block)
        self.assertIn(
            'if [ -z "${ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS+x}" ]; then',
            owner_block,
        )
        self.assertIn("ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS=90", owner_block)
        self.assertIn("export ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS", owner_block)

    def test_ordax_run_does_not_duplicate_health_policy(self):
        run = RUN.read_text(encoding="utf-8")
        self.assertNotIn("ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS", run)
        self.assertNotIn("ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS", run)

    def test_stable_budget_remains_separate(self):
        entrypoint = ENTRYPOINT.read_text(encoding="utf-8")
        stable_block = entrypoint.split('if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]; then', 1)[1].split("\nfi", 1)[0]
        self.assertIn("ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS=60", stable_block)
        self.assertNotIn("ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS=90", stable_block)


if __name__ == "__main__":
    unittest.main()
