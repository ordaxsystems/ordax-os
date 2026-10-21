"""Read-only Owner USB power diagnostics are bounded and redact boot identity."""

import importlib.util
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SERVER = ROOT / "system/surface/runtime/native_host_server.py"
spec = importlib.util.spec_from_file_location("ordax_power_receipts_native_test", SERVER)
native_host = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(native_host)


class OwnerPowerReceiptsNativeTests(unittest.TestCase):
    def test_valid_shutdown_failure_does_not_expose_boot_id_or_epoch(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            (path / "last-request").write_text("shutdown|private-boot-id|123456789|failed\n", encoding="ascii")
            (path / "last-stage").write_text("supervisor-quiesce\n", encoding="ascii")
            (path / "last-failure").write_text("supervisor-quiesce-failed\n", encoding="ascii")
            status = native_host.read_owner_usb_power_receipts(temp)
            self.assertEqual(status, {
                "lastAction": "shutdown",
                "lastStatus": "failed",
                "lastStage": "supervisor-quiesce",
                "lastFailure": "supervisor-quiesce-failed",
            })
            self.assertNotIn("private-boot-id", str(status))
            self.assertNotIn("123456789", str(status))

    def test_missing_and_symlinked_receipts_remain_unavailable(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            self.assertEqual(native_host.read_owner_usb_power_receipts(temp), {
                "lastAction": "unavailable",
                "lastStatus": "unavailable",
                "lastStage": "unavailable",
                "lastFailure": "unavailable",
            })
            elsewhere = path / "outside"
            elsewhere.write_text("kernel-transition-returned\n", encoding="ascii")
            (path / "last-failure").symlink_to(elsewhere)
            self.assertEqual(native_host.read_owner_usb_power_receipts(temp)["lastFailure"], "unavailable")

    def test_unrecognized_and_oversized_receipts_are_never_echoed(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp)
            (path / "last-request").write_text("shutdown|private|123|unexpected\n", encoding="ascii")
            (path / "last-stage").write_text("tokens-secret\n", encoding="ascii")
            (path / "last-failure").write_text("s" * 300 + "\n", encoding="ascii")
            status = native_host.read_owner_usb_power_receipts(temp)
            self.assertEqual(status["lastAction"], "shutdown")
            self.assertEqual(status["lastStatus"], "unknown")
            self.assertEqual(status["lastStage"], "unknown")
            self.assertEqual(status["lastFailure"], "unavailable")
            self.assertNotIn("tokens-secret", str(status))
            self.assertNotIn("s" * 300, str(status))

    def test_power_diagnostics_are_only_added_to_owner_usb_update_endpoint(self):
        text = SERVER.read_text(encoding="utf-8")
        self.assertIn('OWNER_USB_POWER_RECEIPTS = "/srv/ordax-power-receipts"', text)
        self.assertIn('if owner_usb:\n                update_state["hostPower"] = read_owner_usb_power_receipts()', text)
        self.assertIn('update_state["manualCheckAvailable"] = owner_usb', text)


if __name__ == "__main__":
    unittest.main()
