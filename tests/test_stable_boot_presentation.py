import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
KERNEL = ROOT / "bootstrap" / "kernel" / "config" / "ordax.fragment"
NORMAL = ROOT / "boot" / "portable-v2" / "loader" / "entries" / "ordax-portable.conf"
RECOVERY = ROOT / "boot" / "portable-v2" / "loader" / "entries" / "ordax-portable-recovery.conf"


class StableBootPresentationTests(unittest.TestCase):
    def test_production_kernel_does_not_embed_linux_logo(self):
        fragment = KERNEL.read_text(encoding="utf-8")
        self.assertIn("# CONFIG_LOGO is not set", fragment)
        self.assertNotIn("CONFIG_LOGO=y", fragment)

    def test_normal_boot_is_quiet_but_preserves_serial_evidence(self):
        normal = NORMAL.read_text(encoding="utf-8")
        self.assertIn("console=ttyS0,115200n8", normal)
        self.assertIn("rdinit=/sbin/ordax-portable-init", normal)
        self.assertIn("quiet", normal)
        self.assertIn("loglevel=3", normal)
        self.assertIn("logo.nologo", normal)
        self.assertIn("vt.global_cursor_default=0", normal)
        self.assertNotIn("console=tty0", normal)
        self.assertNotIn("ignore_loglevel", normal)

    def test_recovery_boot_is_explicitly_visible_and_verbose(self):
        recovery = RECOVERY.read_text(encoding="utf-8")
        self.assertIn("console=ttyS0,115200n8", recovery)
        self.assertIn("console=tty0", recovery)
        self.assertIn("rdinit=/sbin/ordax-portable-init", recovery)
        self.assertIn("loglevel=7", recovery)
        self.assertIn("ignore_loglevel", recovery)
        self.assertIn("logo.nologo", recovery)
        self.assertIn("ordax.mode=recovery", recovery)
        self.assertNotIn(" quiet ", f" {recovery} ")


if __name__ == "__main__":
    unittest.main()
