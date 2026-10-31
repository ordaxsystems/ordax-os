"""Read-only TPM2 admission proof for the future OrdaX short-PIN account vault."""
import os
from pathlib import Path
import stat
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "system/surface/runtime"))
from native_account_vault import tpm2_pin_preflight


class TPM2AccountPreflightTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.version = str(Path(self.tmp.name) / "tpm_version_major")
        self.device = str(Path(self.tmp.name) / "tpmrm0")

    def _probe(self):
        return tpm2_pin_preflight(self.version, self.device)

    def test_missing_device_or_version_never_enables_pin_reboot(self):
        self.assertEqual(self._probe()["status"], "tpm2-unavailable")
        Path(self.version).write_text("2\n")
        result = self._probe()
        self.assertTrue(result["tpm2_detected"])
        self.assertFalse(result["resource_manager_accessible"])
        self.assertFalse(result["short_pin_reboot_enabled"])
        self.assertFalse(result["hardware_key_enrolled"])

    def test_tpm12_and_fake_regular_device_never_enable(self):
        Path(self.version).write_text("1\n")
        Path(self.device).write_text("not a character device")
        self.assertFalse(self._probe()["tpm2_detected"])
        self.assertFalse(self._probe()["short_pin_reboot_enabled"])
        Path(self.version).write_text("2\n")
        result = self._probe()
        self.assertTrue(result["tpm2_detected"])
        self.assertEqual(result["status"], "tpm2-resource-manager-unavailable")
        self.assertFalse(result["short_pin_reboot_enabled"])

    @unittest.skipUnless(os.name == "posix", "Device-mode proof uses POSIX character device types")
    def test_accessible_tpm2_character_device_is_candidate_not_authentication(self):
        Path(self.version).write_text("2\n")
        original_lstat = os.lstat
        original_access = os.access

        def checked_lstat(path, *args, **kwargs):
            if path == self.device:
                return type("Info", (), {"st_mode": stat.S_IFCHR | 0o600})()
            return original_lstat(path, *args, **kwargs)

        def checked_access(path, mode, *args, **kwargs):
            if path == self.device:
                return mode == os.R_OK | os.W_OK
            return original_access(path, mode, *args, **kwargs)

        with patch("native_account_vault.os.lstat", side_effect=checked_lstat), patch(
            "native_account_vault.os.access", side_effect=checked_access
        ):
            result = self._probe()
        self.assertEqual(result["status"], "tpm2-hardware-candidate-only-not-enrolled")
        self.assertTrue(result["tpm2_detected"])
        self.assertTrue(result["resource_manager_accessible"])
        self.assertFalse(result["hardware_key_enrolled"])
        self.assertFalse(result["short_pin_reboot_enabled"])
        self.assertEqual(set(result), {
            "tpm2_detected", "resource_manager_accessible",
            "hardware_key_enrolled", "short_pin_reboot_enabled", "status",
        })

    def test_symlink_version_is_not_accepted_and_requires_no_device_writes(self):
        other = Path(self.tmp.name) / "fake-tpm"
        other.write_text("2\n")
        Path(self.version).symlink_to(other)
        self.assertEqual(self._probe()["status"], "tpm2-unavailable")

    def test_kernel_remains_pinned_and_pin_gate_stays_closed(self):
        import json
        contract = json.loads(
            (ROOT / "docs/contracts/native-account-session.json").read_text()
        )
        foundation = contract["tpm2_foundation"]
        fragment = (ROOT / "bootstrap/kernel/config/ordax.fragment").read_text()
        self.assertFalse(contract["short_pin_reboot_gate"]["enabled"])
        self.assertFalse(foundation["kernel_prerequisites_in_current_shipped_kernel"])
        self.assertNotIn("CONFIG_TCG_TPM=y", fragment)
        self.assertNotIn("CONFIG_TRUSTED_KEYS_TPM=y", fragment)
        self.assertFalse(foundation["pin_enrollment_implemented"])
        self.assertFalse(foundation["hardware_key_seal_unseal_implemented"])
        self.assertFalse(foundation["physical_proof_passed"])
        self.assertTrue(foundation["hardware_probe_does_not_establish_kernel_capability"])

    def test_probe_never_opens_tpm_resource_manager(self):
        Path(self.version).write_text("2\n")
        with patch("native_account_vault.os.open", wraps=os.open) as opened:
            self._probe()
        opened_paths = [call.args[0] for call in opened.call_args_list]
        self.assertNotIn(self.device, opened_paths)


if __name__ == "__main__":
    unittest.main()
