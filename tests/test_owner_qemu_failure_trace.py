"""Fail-closed QEMU diagnostics must not leak guest logs on real hardware."""
import unittest
from pathlib import Path

SUPERVISOR = (Path(__file__).resolve().parents[1] / "system" / "supervisor")


class OwnerQemuFailureTraceTests(unittest.TestCase):
    def test_bounded_serial_trace_only_with_explicit_qemu_probe(self):
        script = SUPERVISOR.read_text(encoding="utf-8")
        block = script.split("owner_qemu_surface_failure_diagnostics() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("/proc/cmdline", block)
        self.assertIn("ordax.owner_qemu_graphics_probe=1", block)
        self.assertIn("/bin/busybox tail -n 24", block)
        self.assertIn("[ ! -L \"$report\" ]", block)
        self.assertNotIn("healthy-sha", block)
        self.assertNotIn("surface-heartbeat.json", block)

    def test_exact_failure_only_uses_existing_native_witnesses(self):
        script = SUPERVISOR.read_text(encoding="utf-8")
        block = script.split("owner_initial_surface_health_failed() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn("wait \"$SURFACE_PID\"", block)
        self.assertIn("owner_qemu_surface_failure_diagnostics", block)
        self.assertLess(block.index("owner_qemu_surface_failure_diagnostics"), block.index("write_surface_health_state failed"))
        self.assertIn("rollback_boot_candidate", block)
        self.assertIn("retrying current checkout once", block)
        self.assertNotIn("write_surface_health_state healthy", block)


if __name__ == "__main__":
    unittest.main()
