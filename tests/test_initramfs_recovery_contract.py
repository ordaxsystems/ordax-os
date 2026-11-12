from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INIT = (ROOT / "bootstrap/initramfs/root/init").read_text(encoding="utf-8")


class InitramfsRecoveryContractTests(unittest.TestCase):
    def test_ext4_recovery_mount_is_read_only_without_journal_replay(self):
        start = INIT.index("enter_recovery() {")
        end = INIT.index("\n}\n", start)
        recovery = INIT[start:end]

        self.assertIn(
            'mount -t ext4 -o ro,noload "$ORDAX_DEVICE" /ordax',
            recovery,
        )
        self.assertNotIn("-o rw", recovery)

    def test_initramfs_never_repairs_ext4_automatically(self):
        lowered = INIT.lower()
        self.assertNotIn("e2fsck", lowered)
        self.assertNotIn("fsck", lowered)


if __name__ == "__main__":
    unittest.main()
