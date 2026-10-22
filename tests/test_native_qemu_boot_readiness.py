"""Guest-stage-driven Native QEMU unlock, without premature secret injection."""
from __future__ import annotations

import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / "bootstrap/native-initramfs/root/init").read_text(encoding="utf-8")
PROOF = ROOT / "tools/creator/proof/native_qemu_boot.py"
SPEC = importlib.util.spec_from_file_location("ordax_native_qemu_boot", PROOF)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NativeQemuReadinessTests(unittest.TestCase):
    def test_no_keystrokes_before_guest_readiness_or_grace(self):
        due = MODULE.unlock_input_due
        self.assertFalse(due(ready=False, next_at=None, now=100, attempts=0, unlocked=False))
        self.assertFalse(due(ready=False, next_at=0, now=100, attempts=0, unlocked=False))
        self.assertFalse(due(ready=True, next_at=None, now=100, attempts=0, unlocked=False))
        self.assertFalse(due(ready=True, next_at=105, now=100, attempts=0, unlocked=False))
        self.assertTrue(due(ready=True, next_at=105, now=105, attempts=0, unlocked=False))

    def test_only_three_attempts_and_never_after_pool_unlocked(self):
        due = MODULE.unlock_input_due
        for attempts in (0, 1, 2):
            self.assertTrue(due(ready=True, next_at=100, now=101,
                                attempts=attempts, unlocked=False))
        for attempts in (3, 4):
            self.assertFalse(due(ready=True, next_at=100, now=101,
                                 attempts=attempts, unlocked=False))
        self.assertFalse(due(ready=True, next_at=100, now=101, attempts=1, unlocked=True))

    def test_guest_serial_signal_only_after_real_luks_identity_validation(self):
        self.assertIn('signal_boot_stage init-ready', INIT)
        self.assertIn('signal_boot_stage unlock-ready', INIT)
        self.assertIn('signal_boot_stage pool-unlocked', INIT)
        self.assertIn('signal_boot_stage rescue', INIT)
        self.assertLess(INIT.index('OBSERVED_UUID'), INIT.index('signal_boot_stage unlock-ready'))
        self.assertLess(INIT.index('signal_boot_stage unlock-ready'), INIT.index('cryptsetup open --readonly'))
        self.assertLess(INIT.index('MAPPER_OPEN=1'), INIT.index('signal_boot_stage pool-unlocked'))
        self.assertIn('[ -c /dev/ttyS0 ] || return 0', INIT)
        self.assertIn("ORDAX_NATIVE_BOOT_STAGE=%s", INIT)

    def test_no_secret_is_logged_or_carried_via_serial(self):
        source = PROOF.read_text(encoding="utf-8")
        self.assertIn('NATIVE_READY_MARKER in text', source)
        self.assertIn('NATIVE_RESCUE_MARKER in text', source)
        self.assertIn('if unlock_input_due(', source)
        self.assertNotIn('next_injection = started + 15.0', source)
        self.assertIn("type_passphrase(client, passphrase)", source)
        self.assertNotIn('printf \'%s\\n\' "$passphrase"', INIT)
        self.assertNotIn('ordax.pool_key', INIT)
        self.assertNotIn('--key-file', INIT)
        self.assertEqual(MODULE.MAX_UNLOCK_INJECTIONS, 3)
        self.assertEqual(MODULE.NATIVE_READY_MARKER, "ORDAX_NATIVE_BOOT_STAGE=unlock-ready")


if __name__ == "__main__":
    unittest.main()
