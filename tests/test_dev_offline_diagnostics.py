"""Read-only boot diagnosis is available before Cage/WebKit or network pairing."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DIAGNOSTIC = ROOT / "bootstrap/dev-base/ordax-diagnose"
BOOTSTRAP = (ROOT / "bootstrap/base/alpine_core.py").read_text(encoding="utf-8")
INIT = (ROOT / "bootstrap/dev-base/ordax-dev-init").read_text(encoding="utf-8")
CODE = DIAGNOSTIC.read_text(encoding="utf-8")


def run_snapshot(source, args=()):
    # Ubuntu runner does not require a preinstalled standalone BusyBox binary.
    portable = source.replace("/bin/busybox ", "")
    return subprocess.run(
        ["sh", "-c", portable, "ordax-diagnose", *args],
        text=True, capture_output=True, timeout=8,
    )


class DevOfflineDiagnosticsTests(unittest.TestCase):
    def test_posix_parse_and_dev_base_distribution(self):
        subprocess.run(["sh", "-n", str(DIAGNOSTIC)], check=True)
        self.assertIn('for helper in inventory["runtime_helpers"]:', BOOTSTRAP)
        self.assertIn('copy_script(ROOT / helper["source"], rootfs / helper["target"])', BOOTSTRAP)
        manifest = (ROOT / "system/services/base-update/dev-helper-manifest.tsv").read_text(encoding="utf-8")
        self.assertEqual(
            manifest.splitlines().count(
                "bootstrap/dev-base/ordax-diagnose\\tusr/local/bin/ordax-diagnose"
            ),
            1,
        )
        self.assertIn("ordax-diagnose (somente leitura)", INIT)

    def test_snapshot_is_bounded_read_only_and_not_a_remote_executor(self):
        result = run_snapshot(CODE)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("schema=ordax.dev-boot-diagnostics/1", result.stdout)
        self.assertIn("scope=owner-development-local-only", result.stdout)
        self.assertIn("network_actions=none", result.stdout)
        self.assertIn("device_writes=none", result.stdout)
        self.assertIn("fs.root.", result.stdout)
        self.assertIn("surface.health_marker=", result.stdout)
        self.assertIn("guardian.crash_budget=", result.stdout)
        self.assertLess(len(result.stdout), 8192)
        for prohibited in ("apk add", "mkfs", "wipefs", "dd if=", "curl ", "wget ", "nc ", "ssh ", "git fetch", "git pull", "mount -o"):
            self.assertNotIn(prohibited, CODE)

    def test_known_failures_are_classified_without_copying_raw_log_contents(self):
        with tempfile.TemporaryDirectory() as tmp:
            surface = Path(tmp) / "surface.log"
            guardian = Path(tmp) / "guardian.log"
            surface.write_text(
                "secret-token=DO_NOT_EXPOSE\nNo space left on device\n"
                "graphical runtime provisioning timed out or failed\n",
                encoding="utf-8",
            )
            guardian.write_text(
                "session-credential=DO_NOT_EXPOSE\nsupervisor heartbeat stale\n",
                encoding="utf-8",
            )
            code = CODE.replace(
                "SURFACE_LOG=/run/ordax-surface/host.log",
                "SURFACE_LOG=" + str(surface),
            ).replace(
                "GUARDIAN_LOG=/run/ordax-update/guardian.log",
                "GUARDIAN_LOG=" + str(guardian),
            )
            result = run_snapshot(code)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("surface.disk_full=observed", result.stdout)
            self.assertIn("surface.apk_failed=observed", result.stdout)
            self.assertIn("guardian.stale_heartbeat=observed", result.stdout)
            self.assertNotIn("DO_NOT_EXPOSE", result.stdout)
            self.assertNotIn("secret-token", result.stdout)
            self.assertNotIn("session-credential", result.stdout)

    def test_arguments_are_rejected_without_state_mutation(self):
        result = run_snapshot(CODE, ["--upload"])
        self.assertEqual(result.returncode, 2)
        self.assertIn("Usage: ordax-diagnose", result.stderr)


if __name__ == "__main__":
    unittest.main()
