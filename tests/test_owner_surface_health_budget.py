import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENTRYPOINT = ROOT / "system" / "entrypoint"
RUN = ROOT / "bootstrap" / "dev-base" / "ordax-run"
SUPERVISOR = ROOT / "system" / "supervisor"
SURFACE = ROOT / "system" / "surface" / "bin" / "ordax-surface"


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

    def test_owner_provisioning_marker_is_exact_sha_bounded_and_observable(self):
        supervisor = SUPERVISOR.read_text(encoding="utf-8")
        surface = SURFACE.read_text(encoding="utf-8")
        self.assertIn("OWNER_PROVISION_TIMEOUT=${ORDAX_OWNER_SURFACE_PROVISION_TIMEOUT_SECONDS:-660}", supervisor)
        # First-boot budgets now use one monotonic Supervisor event loop.
        self.assertIn('[ "$marker_source" = "$initial_sha" ]', supervisor)
        self.assertIn('OWNER_INITIAL_PROVISION_SINCE=$owner_now', supervisor)
        self.assertIn('[ $((owner_now - OWNER_INITIAL_PROVISION_SINCE)) -gt "$OWNER_PROVISION_TIMEOUT" ]', supervisor)
        self.assertIn('OWNER_INITIAL_NORMAL_SINCE=$owner_now', supervisor)
        self.assertIn('owner_monotonic_seconds()', supervisor)
        for state in ("starting", "provisioning", "waiting-health", "healthy", "failed"):
            self.assertIn(f"write_surface_health_state {state}", supervisor)
        marker_write = surface.index("printf '%s\\n' \"$SOURCE_SHA\" >\"$RUNTIME_PROVISIONING_FILE\"")
        ensure_runtime = surface.index('ensure_runtime || fallback_with_reason')
        marker_clear = surface.index('rm -f "$RUNTIME_PROVISIONING_FILE"', marker_write)
        self.assertLess(marker_write, ensure_runtime)
        self.assertLess(ensure_runtime, marker_clear)

    def test_owner_cold_boot_failure_reports_only_canonical_witness_classes(self):
        supervisor = SUPERVISOR.read_text(encoding="utf-8")
        failure = supervisor.split("owner_initial_surface_health_failed() {", 1)[1]
        failure = failure.split("\n}\n", 1)[0]
        self.assertIn('read_state_value "$HEALTH_FILE"', failure)
        self.assertIn('surface_heartbeat_sha', failure)
        self.assertIn('[ "$(read_state_value "$HEALTH_FILE")" = "$initial_sha" ]', failure)
        self.assertIn('[ "$(surface_heartbeat_sha)" = "$initial_sha" ]', failure)
        marker = "cold-boot Surface evidence: native_health="
        self.assertIn(marker, failure)
        self.assertLess(failure.index(marker), failure.index("clear_surface_health"))
        self.assertNotIn("echo $HEALTH_FILE", failure)
        self.assertNotIn("echo $SURFACE_HEARTBEAT_FILE", failure)
        # The debug witness is read-only. The original fail-closed recovery
        # and all real Surface health requirements remain unchanged.
        self.assertIn('owner_initial_surface_health_failed', supervisor)
        self.assertIn('[ "$healthy_sha" = "$expected_sha" ]', supervisor)
        self.assertIn('[ "$rendered_sha" = "$expected_sha" ]', supervisor)

    def test_stable_budget_remains_separate(self):
        entrypoint = ENTRYPOINT.read_text(encoding="utf-8")
        stable_block = entrypoint.split('if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]; then', 1)[1].split("\nfi", 1)[0]
        self.assertIn("ORDAX_INITIAL_SURFACE_HEALTH_TIMEOUT_SECONDS=60", stable_block)
        self.assertNotIn("ORDAX_SURFACE_HEALTH_TIMEOUT_SECONDS=90", stable_block)


if __name__ == "__main__":
    unittest.main()
