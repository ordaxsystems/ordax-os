from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HEARTBEAT_ADAPTER = ROOT / "system/adapters/native/surface-heartbeat.mjs"
NATIVE_MAIN = ROOT / "system/composition/native/main.mjs"
NATIVE_HOST = ROOT / "system/surface/runtime/native_host_server.py"
SUPERVISOR = ROOT / "system/supervisor"
COLD_HEALTH_RUNNER = ROOT / "bootstrap/portable-v2/qemu_cold_health_commit.py"
QEMU_BASE = ROOT / "bootstrap/portable-v2/qemu_boot.py"


class IndependentSurfaceColdHealthContractTests(unittest.TestCase):
    def test_heartbeat_originates_inside_rendered_surface_page(self):
        adapter = HEARTBEAT_ADAPTER.read_text(encoding="utf-8")
        native_main = NATIVE_MAIN.read_text(encoding="utf-8")
        self.assertIn('SURFACE_HEARTBEAT_PATH = "/__ordax/native/surface-heartbeat"', adapter)
        self.assertIn('new URL(windowRef.location.href).searchParams.get("source")', adapter)
        self.assertIn("windowRef.fetch(SURFACE_HEARTBEAT_PATH", adapter)
        self.assertIn("JSON.stringify({ sourceSha })", adapter)
        self.assertIn("createNativeSurfaceHeartbeat", native_main)

    def test_native_host_records_same_source_bound_heartbeat(self):
        host = NATIVE_HOST.read_text(encoding="utf-8")
        self.assertIn('SURFACE_HEARTBEAT_PATH = "/__ordax/native/surface-heartbeat"', host)
        self.assertIn('SURFACE_HEARTBEAT_FILE = "/run/ordax-update/surface-heartbeat.json"', host)
        self.assertIn("if self.path == SURFACE_HEARTBEAT_PATH:", host)
        self.assertIn("valid_surface_heartbeat_payload(payload)", host)
        self.assertIn('payload.get("sourceSha")', host)

    def test_supervisor_binds_health_to_rendered_sha_before_commit(self):
        supervisor = SUPERVISOR.read_text(encoding="utf-8")
        self.assertIn("SURFACE_HEARTBEAT_FILE=$UPDATE_RUN_DIR/surface-heartbeat.json", supervisor)
        self.assertIn("surface_heartbeat_sha()", supervisor)
        self.assertIn("wait_for_surface_health()", supervisor)
        self.assertIn('[ "$healthy_sha" = "$expected_sha" ] && [ "$rendered_sha" = "$expected_sha" ]', supervisor)
        self.assertLess(
            supervisor.index('wait_for_surface_health "$pending_boot_sha"'),
            supervisor.index('portable_commit_candidate "$pending_boot_sha"'),
        )

    def test_cold_health_runner_uses_real_graphics_and_second_boot(self):
        runner = COLD_HEALTH_RUNNER.read_text(encoding="utf-8")
        qemu = QEMU_BASE.read_text(encoding="utf-8")
        self.assertEqual(runner.count("graphical_hardware=True"), 2)
        self.assertIn("required_post_marker=commit_marker", runner)
        self.assertIn('"cold_health_commit_proven": True', runner)
        self.assertIn('"adapter": "virtio-vga"', runner)
        self.assertIn('"surface_path": "cage-wayland-webkit-seatd"', runner)
        self.assertIn('"synthetic_health": False', runner)
        self.assertIn('"physical_target_device_touched": False', runner)
        self.assertIn('"public_physical_promotion_allowed": False', runner)
        self.assertIn('"virtio_graphics_both_boots"', runner)
        self.assertIn('"second_boot_current_selected"', runner)
        self.assertIn('"-vga", "virtio"', qemu)


if __name__ == "__main__":
    unittest.main()
