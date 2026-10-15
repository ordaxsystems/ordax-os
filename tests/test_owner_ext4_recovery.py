import json
import subprocess
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
INIT_PATH = ROOT / "bootstrap/initramfs/root/init"
SOURCE_PATH = ROOT / "bootstrap/initramfs/source.json"
DEV_BASE_PATH = ROOT / "bootstrap/dev-base/build.py"


class OwnerExt4RecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.init = INIT_PATH.read_text(encoding="utf-8")
        cls.contract = json.loads(SOURCE_PATH.read_text(encoding="utf-8"))
        cls.dev_base = DEV_BASE_PATH.read_text(encoding="utf-8")

    def test_pid1_shell_syntax_is_valid(self):
        result = subprocess.run(
            ["sh", "-n", str(INIT_PATH)],
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_recovery_mount_disables_ext4_journal_replay(self):
        safe_mount = 'mount -t ext4 -o ro,noload,nodev,nosuid "$ORDAX_DEVICE" /ordax'
        unsafe_mount = 'mount -t ext4 -o ro "$ORDAX_DEVICE" /ordax'
        self.assertIn(safe_mount, self.init)
        self.assertNotIn(unsafe_mount, self.init)

        recovery = self.contract["recovery"]
        self.assertEqual(recovery["main_partition_mount"], "read-only")
        self.assertFalse(recovery["journal_replay"])
        self.assertEqual(recovery["mount_options"], "ro,noload,nodev,nosuid")
        self.assertFalse(recovery["network_started"])

    def test_bounded_preen_is_owner_development_only(self):
        self.assertIn('case "$OWNER_DEVELOPMENT" in', self.init)
        self.assertIn('"$OWNER_FS_REPAIR_ROOT/e2fsck" -p "$ORDAX_DEVICE"', self.init)
        self.assertNotIn('e2fsck -y', self.init)
        self.assertNotIn('e2fsck -f', self.init)

        health = self.contract["storage_health"]
        self.assertFalse(health["automatic_destructive_repair"])
        preen = health["owner_development_safe_preen"]
        self.assertTrue(preen["enabled"])
        self.assertEqual(preen["distribution_profile"], "owner-development")
        self.assertEqual(preen["mode"], "e2fsck -p")
        self.assertEqual(preen["accepted_exit_codes"], [0, 1])
        self.assertFalse(preen["stable_mvp_enabled"])
        self.assertEqual(preen["failure_policy"], "read-only-recovery")

    def test_filesystem_is_unmounted_before_preen_and_rechecked_afterward(self):
        stage_mount = self.init.index(
            'mount -t ext4 -o ro,noload,nodev,nosuid "$ORDAX_DEVICE" /ordax',
            self.init.index("stage_owner_development_repair_runtime()"),
        )
        stage_unmount = self.init.index(
            "if ! umount /ordax; then",
            stage_mount,
        )
        preen = self.init.index(
            '"$OWNER_FS_REPAIR_ROOT/e2fsck" -p "$ORDAX_DEVICE"',
            stage_unmount,
        )
        recheck = self.init.index(
            '/sbin/ordax-grow-ext4 --check "$ORDAX_DEVICE"',
            preen,
        )
        writable_mount = self.init.rindex(
            'mount -t ext4 -o rw,errors=remount-ro "$ORDAX_DEVICE" /ordax'
        )

        self.assertLess(stage_mount, stage_unmount)
        self.assertLess(stage_unmount, preen)
        self.assertLess(preen, recheck)
        self.assertLess(recheck, writable_mount)
        self.assertTrue(
            self.contract["storage_health"]["owner_development_safe_preen"][
                "filesystem_must_be_unmounted_during_repair"
            ]
        )
        self.assertTrue(
            self.contract["storage_health"]["owner_development_safe_preen"][
                "post_repair_health_recheck_required"
            ]
        )

    def test_only_safe_e2fsck_exit_codes_can_resume_boot(self):
        self.assertIn('case "$repair_rc" in', self.init)
        self.assertIn('0|1)', self.init)
        self.assertIn(
            "bounded e2fsck preen did not safely repair ORDAX",
            self.init,
        )
        self.assertIn(
            "ext4 repair completed but health revalidation still failed",
            self.init,
        )
        self.assertIn(
            "Owner/Development ext4 repair passed revalidation; resuming normal boot",
            self.init,
        )

    def test_dev_base_seeds_e2fsprogs_but_fixed_initramfs_does_not(self):
        self.assertIn('PACKAGES = [*CORE.PACKAGES, "e2fsprogs"]', self.dev_base)
        self.assertIn('/sbin/e2fsck', self.dev_base)
        self.assertNotIn("e2fsprogs", (ROOT / "bootstrap/initramfs/build.py").read_text(encoding="utf-8"))


if __name__ == "__main__":
    unittest.main()
