"""Owner USB: graphical startup is local, and First Run is update-safe."""
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / "bootstrap/dev-base/ordax-dev-init").read_text(encoding="utf-8")
NETWORK = (ROOT / "bootstrap/dev-base/ordax-network").read_text(encoding="utf-8")
SUPERVISOR = (ROOT / "system/supervisor").read_text(encoding="utf-8")
WATCHER = (ROOT / "bootstrap/dev-base/ordax-main-watch").read_text(encoding="utf-8")
SURFACE = (ROOT / "system/surface/bin/ordax-surface").read_text(encoding="utf-8")


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

    def test_owner_virtio_renderer_is_driver_scoped_and_does_not_affect_stable(self):
        subprocess.run(["/bin/sh", "-n", str(ROOT / "system/surface/bin/ordax-surface")], check=True)
        start = SURFACE.index("select_owner_virtio_webkit_transport() {")
        end = SURFACE.index("\nselect_owner_virtio_webkit_transport\n", start)
        body = SURFACE[start:end]
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "owner-development" ] || return 0', body)
        self.assertIn('drm_device=/sys/class/drm/card0/device', body)
        self.assertIn('/bin/busybox readlink -f "$drm_device/driver"', body)
        self.assertIn("*/virtio_gpu)", body)
        self.assertIn("grep -qx 'DRIVER=virtio_gpu'", body)
        self.assertIn("*/virtio[0-9]*)", body)
        self.assertIn('active_driver" = "/sys/bus/pci/drivers/virtio-pci"', body)
        self.assertIn("grep -qx '0x1af4'", body)
        self.assertIn("grep -qx '0x1050'", body)
        self.assertIn("export WEBKIT_DISABLE_DMABUF_RENDERER=1", body)
        self.assertEqual(SURFACE.count("WEBKIT_DISABLE_DMABUF_RENDERER=1"), 1)
        self.assertLess(end, SURFACE.index('START_URI="http://127.0.0.1:8765/'))

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
