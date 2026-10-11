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
        self.assertIn('wait_for_owner_initial_surface_health "$initial_sha" "$INITIAL_SURFACE_HEALTH_TIMEOUT"', SUPERVISOR)
        self.assertIn("RUNTIME_INSTALL_TIMEOUT=$" + "{ORDAX_RUNTIME_INSTALL_TIMEOUT_SECONDS:-600}", SURFACE)
        self.assertIn("OWNER_PROVISION_TIMEOUT=$" + "{ORDAX_OWNER_SURFACE_PROVISION_TIMEOUT_SECONDS:-660}", SUPERVISOR)
        self.assertIn("Stable/MVP requires the preverified offline graphical runtime", SURFACE)

    def probe(self, marker_value, healthy_after, profile="owner-development", budget=4):
        with tempfile.TemporaryDirectory() as directory:
            marker = Path(directory) / "runtime-provisioning-source-sha"
            if marker_value is not None:
                marker.write_text(marker_value + "\n", encoding="utf-8")
            function = extract_function(
                SUPERVISOR, "wait_for_owner_initial_surface_health"
            ).replace("/bin/busybox sleep 1", ":")
            script = (
                "set -eu\n"
                "SURFACE_RUNTIME_PROVISION_MARKER=$1\n"
                "DISTRIBUTION_PROFILE=$2\n"
                "OWNER_PROVISION_TIMEOUT=$3\n"
                "SURFACE_PID=$$\n"
                "attempts=0\n"
                "supervisor_heartbeat() { :; }\n"
                "log() { :; }\n"
                "surface_health_matches() {\n"
                "  attempts=$((attempts + 1))\n"
                "  [ \"$attempts\" -gt \"$healthy_after\" ]\n"
                "}\n"
                "wait_for_surface_health() { [ \"$2\" -eq 1 ]; }\n"
                + "healthy_after=" + str(healthy_after) + "\n"
                + function
                + "wait_for_owner_initial_surface_health " + SHA + " 1\n"
            )
            result = subprocess.run(
                ["sh", "-c", script, "test", str(marker), profile, str(budget)],
                capture_output=True, text=True, timeout=5,
            )
            return result.returncode, result.stderr

    def test_exact_sha_allows_first_boot_provisioning(self):
        rc, error = self.probe(SHA, healthy_after=3, budget=5)
        self.assertEqual(rc, 0, error)

    def test_wrong_sha_cannot_extend_regular_health(self):
        rc, _ = self.probe("b" * 40, healthy_after=3)
        self.assertNotEqual(rc, 0)

    def test_provisioning_timeout_is_bounded(self):
        rc, _ = self.probe(SHA, healthy_after=100, budget=3)
        self.assertNotEqual(rc, 0)

    def test_stable_preserves_its_regular_health_check(self):
        rc, error = self.probe(SHA, healthy_after=100, profile="stable-mvp")
        self.assertEqual(rc, 0, error)


if __name__ == "__main__":
    unittest.main()
