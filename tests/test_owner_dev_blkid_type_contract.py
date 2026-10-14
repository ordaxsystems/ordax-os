from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
BUILDER = (ROOT / "bootstrap/initramfs/build.py").read_text(encoding="utf-8")
INIT = (ROOT / "bootstrap/initramfs/root/init").read_text(encoding="utf-8")


class OwnerDevelopmentBlkidTypeContractTests(unittest.TestCase):
    def test_busybox_blkid_must_print_filesystem_type(self):
        self.assertIn('"CONFIG_BLKID": "y"', BUILDER)
        self.assertIn('"CONFIG_FEATURE_BLKID_TYPE": "y"', BUILDER)

    def test_owner_pid1_keeps_strong_filesystem_type_checks(self):
        self.assertIn("*'TYPE=\"ext4\"'*", INIT)
        self.assertIn("*'TYPE=\"vfat\"'*", INIT)


if __name__ == "__main__":
    unittest.main()
