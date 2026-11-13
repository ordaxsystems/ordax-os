"""Regression contract: laptop power key routes into the existing OrdaX Guardian."""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
GUARDIAN = ROOT / "system/entrypoint"
ACTION = ROOT / "system/services/power/acpi-button-action.sh"
KERNEL = ROOT / "bootstrap/kernel/config/ordax.fragment"


class PhysicalPowerGuardianTests(unittest.TestCase):
    def test_acpi_button_driver_is_built_in(self):
        kernel = KERNEL.read_text(encoding="utf-8")
        self.assertIn("CONFIG_ACPI_BUTTON=y", kernel)

    def test_acpi_watcher_belongs_to_canonical_guardian(self):
        guardian = GUARDIAN.read_text(encoding="utf-8")
        self.assertIn("start_acpi_button_listener()", guardian)
        self.assertIn("stop_acpi_button_listener()", guardian)
        self.assertIn("EV_KEY 0x01 KEY_POWER 116 1", guardian)
        self.assertIn("PWRF shutdown", guardian)
        self.assertIn("ORDAX_HOST_POWER_REQUEST=\"$HOST_POWER_REQUEST\"", guardian)
        power_transition = guardian.split("perform_host_power_transition() {", 1)[1]
        self.assertLess(
            power_transition.index("    stop_acpi_button_listener"),
            power_transition.index("    if ! terminate_persistent_host_agents"),
        )
        self.assertIn("record_host_power_stage host-agents", power_transition)
        self.assertNotIn("busybox poweroff -f", ACTION.read_text(encoding="utf-8"))
        self.assertNotIn("busybox reboot -f", ACTION.read_text(encoding="utf-8"))

    def test_owner_acpid_logs_to_guardian_without_var_log_dependency(self):
        # Real offline QEMU showed BusyBox acpid aborting because its default
        # /var/log/acpid.log does not exist on the minimal Buildroot USB base.
        # Keep the single Guardian power authority and its existing FIFO.
        guardian = GUARDIAN.read_text(encoding="utf-8")
        listener = guardian.split("start_acpi_button_listener() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('/bin/busybox acpid -d -f -c "$ACPI_DIR"', listener)
        self.assertIn('>>"$GUARDIAN_LOG" 2>&1 &', listener)
        self.assertIn('ORDAX_HOST_POWER_REQUEST="$HOST_POWER_REQUEST"', listener)
        self.assertNotIn('acpid -f -c "$ACPI_DIR"', listener)
        self.assertNotIn(' -l /var/log/', listener)

    def test_shell_syntax(self):
        for script in (GUARDIAN, ACTION):
            subprocess.run(["sh", "-n", str(script)], check=True)

    def test_button_action_rejects_missing_guardian_fifo(self):
        with tempfile.TemporaryDirectory() as directory:
            env = {**os.environ, "ORDAX_HOST_POWER_REQUEST": str(Path(directory) / "absent")}
            result = subprocess.run(["sh", str(ACTION)], env=env, capture_output=True, timeout=5)
            self.assertNotEqual(result.returncode, 0)

    def test_button_action_sends_shutdown_to_existing_fifo(self):
        with tempfile.TemporaryDirectory() as directory:
            fifo = Path(directory) / "host-power-request"
            os.mkfifo(fifo, mode=0o600)
            received = []
            def collect_event():
                with fifo.open() as handle:
                    received.append(handle.readline())
            reader = threading.Thread(target=collect_event, daemon=True)
            reader.start()
            env = {**os.environ, "ORDAX_HOST_POWER_REQUEST": str(fifo)}
            result = subprocess.run(["sh", str(ACTION)], env=env, capture_output=True, timeout=5)
            reader.join(timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(received, ["shutdown\n"])

if __name__ == "__main__":
    unittest.main()
