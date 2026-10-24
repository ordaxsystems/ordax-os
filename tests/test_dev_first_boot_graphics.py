"""Behavioral regression for first-boot native graphics provisioning on development USB."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARDIAN = (ROOT / "system" / "entrypoint").read_text(encoding="utf-8")
SUPERVISOR = (ROOT / "system" / "supervisor").read_text(encoding="utf-8")
SURFACE = (ROOT / "system" / "surface" / "bin" / "ordax-surface").read_text(encoding="utf-8")
SHA = "a" * 40


def extract_function(source, name):
    header = name + "() {\n"
    assert source.count(header) == 1, name
    return header + source.split(header, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class FirstBootGraphicsTests(unittest.TestCase):
    def test_scripts_parse(self):
        for name in ("system/entrypoint", "system/supervisor",
                     "system/surface/bin/ordax-surface"):
            subprocess.run(["sh", "-n", str(ROOT / name)], check=True)

    def test_provisioning_and_liveness_are_explicit_exact_sha_contracts(self):
        self.assertIn("RUNTIME_PROVISIONING_FILE=$SESSION_DIR/runtime-provisioning-source-sha", SURFACE)
        self.assertIn("printf '%s\\n' \"$SOURCE_SHA\" >\"$RUNTIME_PROVISIONING_FILE\"", SURFACE)
        self.assertIn('rm -f "$RUNTIME_PROVISIONING_FILE"', SURFACE)
        self.assertIn("SUPERVISOR_HEARTBEAT_FILE=$UPDATE_RUN_DIR/supervisor-heartbeat", GUARDIAN)
        self.assertIn("SUPERVISOR_HEARTBEAT_FILE=$UPDATE_RUN_DIR/supervisor-heartbeat", SUPERVISOR)
        self.assertIn('[ "$beat_owner" = "$SUPERVISOR_PID" ]', GUARDIAN)
        self.assertIn('supervisor_heartbeat || return 1', SUPERVISOR)
        self.assertIn("begin_owner_initial_surface_health", SUPERVISOR)
        self.assertNotIn("RUNTIME_INSTALL_TIMEOUT=", SURFACE)
        self.assertIn("RUNTIME_ROOT=$VERIFIED_RUNTIME_ROOT", SURFACE)
        self.assertIn("OWNER_PROVISION_TIMEOUT=$" + "{ORDAX_OWNER_SURFACE_PROVISION_TIMEOUT_SECONDS:-660}", SUPERVISOR)
        self.assertIn("verified offline EROFS graphical runtime is unavailable", SURFACE)
        self.assertIn("resolve_source_identity() {", SURFACE)
        self.assertIn('is_source_sha "$SOURCE_SHA_HINT"', SURFACE)
        self.assertIn('[ "$candidate_sha" = "$SOURCE_SHA_HINT" ]', SURFACE)
        identity = SURFACE.index(
            'resolve_source_identity || fallback_with_reason "failed to resolve exact Surface source identity"'
        )
        marker = SURFACE.index(
            "printf '%s\\n' \"$SOURCE_SHA\" >\"$RUNTIME_PROVISIONING_FILE\""
        )
        provision = SURFACE.index(
            'ensure_runtime || fallback_with_reason "graphical runtime is unavailable after bounded provisioning attempt"'
        )
        self.assertLess(identity, marker)
        self.assertLess(marker, provision)

    def probe(self, marker_value, healthy_after, budget=4):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            marker = root / "runtime-provisioning-source-sha"
            now = root / "monotonic"
            calls = root / "health-calls"
            activated = root / "activation"
            now.write_text("1\n", encoding="ascii")
            calls.write_text("0\n", encoding="ascii")
            if marker_value is not None:
                marker.write_text(marker_value + "\n", encoding="ascii")
            functions = "".join(
                extract_function(SUPERVISOR, name)
                for name in (
                    "begin_owner_initial_surface_health",
                    "owner_initial_surface_health_failed",
                    "check_owner_initial_surface_health",
                )
            )
            script = (
                "set -eu\n"
                'DISTRIBUTION_PROFILE=owner-development\n'
                "initial_sha=" + SHA + "\n"
                "boot_runtime_sha=" + SHA + "\n"
                "SURFACE_PID=$$\n"
                "OWNER_INITIAL_HEALTH_PENDING=0\n"
                "OWNER_INITIAL_HEALTH_RETRIES=0\n"
                "OWNER_INITIAL_PROVISION_PHASE=0\n"
                "OWNER_INITIAL_HEALTH_STATE=''\n"
                "OWNER_INITIAL_PROVISION_TIMEOUT=3\n"
                "OWNER_PROVISION_TIMEOUT=3\n"
                "INITIAL_SURFACE_HEALTH_TIMEOUT=1\n"
                'SURFACE_RUNTIME_PROVISION_MARKER="$1"\n'
                'CLOCK="$2"\n'
                'CALLS="$3"\n'
                'ACTIVATED="$4"\n'
                'HEALTHY_AFTER="$5"\n'
                'owner_monotonic_seconds() { cat "$CLOCK"; }\n'
                'supervisor_heartbeat() { :; }\n'
                'log() { :; }\n'
                'write_surface_health_state() { :; }\n'
                'set_update_context() { :; }\n'
                'clear_update_context() { :; }\n'
                'write_update_state() { :; }\n'
                'record_runtime_surface_sha() { printf "%s\n" "$1" > "$ACTIVATED"; }\n'
                'clear_surface_health() { :; }\n'
                'stop_surface() { :; }\n'
                'start_surface() { :; }\n'
                'rollback_boot_candidate() { return 1; }\n'
                'fail_closed() { exit 86; }\n'
                'surface_health_matches() {\n'
                '  count=$(cat "$CALLS")\n'
                '  count=$((count + 1))\n'
                '  printf "%s\n" "$count" > "$CALLS"\n'
                '  [ "$count" -gt "$HEALTHY_AFTER" ]\n'
                '}\n'
                + functions
                + "begin_owner_initial_surface_health\n"
                + 'for tick in 2 3 4 5 6 7 8 9 10 11 12; do\n'
                + '  printf "%s\n" "$tick" > "$CLOCK"\n'
                + "  check_owner_initial_surface_health\n"
                + '  [ "$OWNER_INITIAL_HEALTH_PENDING" -eq 1 ] || break\n'
                + "done\n"
                + 'printf "pending=%s retries=%s\n" "$OWNER_INITIAL_HEALTH_PENDING" "$OWNER_INITIAL_HEALTH_RETRIES"\n'
            )
            result = subprocess.run(
                ["sh", "-c", script, "test", str(marker), str(now), str(calls),
                 str(activated), str(healthy_after)],
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode, result.stdout, activated.exists()

    def test_exact_sha_allows_first_boot_provisioning(self):
        rc, output, activated = self.probe(SHA, healthy_after=3)
        self.assertEqual(rc, 0, output)
        self.assertIn("pending=0", output)
        self.assertTrue(activated)

    def test_wrong_sha_cannot_extend_regular_health(self):
        rc, _, activated = self.probe("b" * 40, healthy_after=100)
        self.assertEqual(rc, 86)
        self.assertFalse(activated)

    def test_provisioning_timeout_is_bounded(self):
        rc, _, activated = self.probe(SHA, healthy_after=100)
        self.assertEqual(rc, 86)
        self.assertFalse(activated)

    def test_pending_health_never_fakes_activation(self):
        rc, output, activated = self.probe(SHA, healthy_after=9)
        self.assertIn(rc, (0, 86))
        if rc == 0:
            self.assertEqual(activated, "pending=0" in output)

    def test_stable_preserves_its_regular_health_check(self):
        self.assertIn(
            'if [ "$DISTRIBUTION_PROFILE" = "stable-mvp" ]',
            SUPERVISOR,
        )
        self.assertIn(
            'wait_for_surface_health "$initial_sha" "$INITIAL_SURFACE_HEALTH_TIMEOUT"',
            SUPERVISOR,
        )


if __name__ == "__main__":
    unittest.main()
