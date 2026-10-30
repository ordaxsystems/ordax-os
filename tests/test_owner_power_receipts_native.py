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
                "lastMountError": "unavailable",
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
                "lastMountError": "unavailable",
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

    def test_classifies_exact_remount_error_without_exposing_kernel_log(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / "last-request").write_text("shutdown|private-boot-id|1234|failed\n")
            (root / "last-failure").write_text("remount-failed\n")
            log = root / "guardian.log"
            log.write_text(
                "2026-10-21 ordax-guardian: host power owner accepted shutdown; stopping supervised runtime\n"
                "mount: mounting / on / failed: Device or resource busy TOKEN-SECRET\n"
                "2026-10-21 ordax-guardian: root filesystem could not be remounted read-only for shutdown; restoring supervised runtime\n"
            )
            result = native_host.read_owner_usb_power_receipts(str(root), log_path=str(log))
            self.assertEqual(result["lastMountError"], "device-busy")
            self.assertNotIn("TOKEN-SECRET", str(result))
            log.write_text(
                "2026-10-21 ordax-guardian: host power owner accepted shutdown; stopping supervised runtime\n"
                "mount: mounting / on / failed: Invalid argument SECRET\n"
                "2026-10-21 ordax-guardian: root filesystem could not be remounted read-only for shutdown; restoring supervised runtime\n"
            )
            self.assertEqual(
                native_host.read_owner_usb_power_receipts(str(root), log_path=str(log))["lastMountError"],
                "invalid-argument",
            )

    def test_log_reader_is_bounded_and_rejects_symlinks_and_stale_errors(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            log = root / "guardian.log"
            log.write_text(
                "mount: Device or resource busy PRIVATE\n"
                "2026 ordax-guardian: host power owner accepted shutdown; stopping supervised runtime\n"
                "2026 ordax-guardian: root filesystem could not be remounted read-only for shutdown; restoring supervised runtime\n"
            )
            self.assertEqual(native_host.read_guardian_remount_error(str(log)), "no-mount-error-output")
            log.write_text(
                "2026 ordax-guardian: host power owner accepted shutdown; stopping supervised runtime\n"
                "mount: INTERNAL SECRET DETAILS\n"
                "2026 ordax-guardian: root filesystem could not be remounted read-only for shutdown; restoring supervised runtime\n"
            )
            self.assertEqual(native_host.read_guardian_remount_error(str(log)), "unclassified-mount-error")
            linked = root / "link.log"
            linked.symlink_to(log)
            self.assertEqual(native_host.read_guardian_remount_error(str(linked)), "unavailable")
            self.assertEqual(native_host.read_guardian_remount_error(str(root / "missing")), "unavailable")
            self.assertEqual(native_host.read_guardian_remount_error(str(root)), "unavailable")

    def test_power_diagnostics_are_only_added_to_owner_usb_update_endpoint(self):
        text = SERVER.read_text(encoding="utf-8")
        self.assertIn('OWNER_USB_POWER_RECEIPTS = "/srv/ordax-power-receipts"', text)
        self.assertIn('if owner_usb:\n                update_state["hostPower"] = read_owner_usb_power_receipts()', text)
        self.assertIn('update_state["manualCheckAvailable"] = owner_usb', text)


if __name__ == "__main__":
    unittest.main()
