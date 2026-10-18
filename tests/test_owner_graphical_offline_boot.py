"""Owner USB: graphical startup is local, and First Run is update-safe."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / "bootstrap/dev-base/ordax-dev-init").read_text(encoding="utf-8")
NETWORK = (ROOT / "bootstrap/dev-base/ordax-network").read_text(encoding="utf-8")
SUPERVISOR = (ROOT / "system/supervisor").read_text(encoding="utf-8")
WATCHER = (ROOT / "bootstrap/dev-base/ordax-main-watch").read_text(encoding="utf-8")


class OwnerGraphicalOfflineBootTests(unittest.TestCase):
    def test_shell_sources_parse(self):
        for path in ("bootstrap/dev-base/ordax-dev-init", "bootstrap/dev-base/ordax-network",
                     "bootstrap/dev-base/ordax-main-watch", "system/supervisor"):
            subprocess.run(["/bin/sh", "-n", str(ROOT / path)], check=True)

    def test_valid_local_checkout_boots_without_remote_or_terminal(self):
        self.assertIn("start_local_surface fast-graphical", INIT)
        self.assertIn('"$BIN_DIR/ordax-run"', INIT)
        self.assertNotIn('"$BIN_DIR/ordax-pull"', INIT)
        self.assertNotIn("fast-console", INIT)
        self.assertIn('"$BIN_DIR/ordax-network" --init-hardware', INIT)
        self.assertIn("record_boot_handoff recovery-no-checkout", INIT)

    def test_hardware_init_never_enters_dhcp_or_network_prompt(self):
        self.assertIn("--init-hardware) hardware_only=1", NETWORK)
        self.assertIn('[ "$hardware_only" -eq 1 ] && exit 0', NETWORK)
        self.assertLess(NETWORK.index('[ "$hardware_only" -eq 1 ] && exit 0'),
                        NETWORK.index("write_network_status no-ip startup"))

    def test_pid_scoped_atomic_state_staging_has_no_shared_literal_dollar_suffix(self):
        # The literal suffix .tmp.$ is NOT the process ID in BusyBox ash.
        # It causes concurrent Owner Git/guardian/health transactions to
        # overwrite one another before the atomic rename.
        for relative in (
            "bootstrap/dev-base/ordax-dev-init",
            "bootstrap/dev-base/ordax-pull",
            "system/entrypoint",
            "system/supervisor",
        ):
            with self.subTest(relative=relative):
                source = (ROOT / relative).read_text(encoding="utf-8")
                self.assertNotRegex(source, r"\\.tmp\\.\\$(?!\\$)")
                self.assertIn(".tmp.$$", source)
                subprocess.run(["/bin/sh", "-n", str(ROOT / relative)], check=True)

    def test_versioned_base_keeps_ephemeral_surface_mount_during_pivot(self):
        code = INIT
        self.assertIn("for shared in state workspace home proc sys dev run; do", code)
        self.assertLess(
            code.index("for shared in state workspace home proc sys dev run; do"),
            code.index("/bin/busybox pivot_root . .ordax-base"),
        )

    def test_durable_first_run_state_blocks_both_update_owners(self):
        marker = "$STATE_DIR/native-state/first-run.json"
        self.assertIn(marker, SUPERVISOR)
        self.assertIn(marker, WATCHER)
        s = SUPERVISOR.index("first_run_receipt=$STATE_DIR/native-state/first-run.json")
        w = WATCHER.index("first_run_receipt=$STATE_DIR/native-state/first-run.json")
        self.assertLess(s, SUPERVISOR.index("remote_output=$(run_bounded_git", s))
        self.assertLess(w, WATCHER.index("handoff_runtime_drift_if_needed \"$supervisor_pid\"", w))


if __name__ == "__main__":
    unittest.main()
