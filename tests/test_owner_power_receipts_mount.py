"""Verify the real Guardian-to-Native read-only receipt mount and lifecycle."""

from pathlib import Path
import os
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system/surface/bin/ordax-surface"
NATIVE = ROOT / "system/surface/runtime/native_host_server.py"
MOUNT_RELATIVE = "/srv/ordax-power-receipts"


class OwnerPowerReceiptsMountTests(unittest.TestCase):
    def test_surface_binds_only_host_power_receipts_and_remounts_readonly(self):
        source = SURFACE.read_text(encoding="utf-8")
        native = NATIVE.read_text(encoding="utf-8")
        subprocess.run(["/bin/sh", "-n", str(SURFACE)], check=True)
        self.assertIn("POWER_STATE_DIR=$STATE_ROOT/power", source)
        self.assertIn("POWER_RECEIPTS_MOUNT_RELATIVE=/srv/ordax-power-receipts", source)
        self.assertIn('mount -o bind "$POWER_STATE_DIR" "$receipts_target"', source)
        self.assertIn('mount -o remount,bind,ro "$receipts_target"', source)
        self.assertIn('POWER_RECEIPTS_BOUND=1', source)
        self.assertIn('POWER_RECEIPTS_BOUND=0', source)
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = "owner-development" ] && [ "$PRODUCT_MODE" = "usb" ]', source)
        self.assertIn("*,ro,*)", source)
        self.assertIn('OWNER_USB_POWER_RECEIPTS = "/srv/ordax-power-receipts"', native)
        self.assertNotIn('OWNER_USB_POWER_RECEIPTS = "/ordax/dev-base/state/ordax/power"', native)
        self.assertLess(
            source.index('mount -o bind "$POWER_STATE_DIR" "$receipts_target"'),
            source.index('mount -o remount,bind,ro "$receipts_target"'),
        )

    def test_stale_mounted_root_is_unmounted_and_normal_cleanup_unbinds_receipts(self):
        source = SURFACE.read_text(encoding="utf-8")
        self.assertIn('"$runtime_root/srv/ordax-power-receipts"', source)
        self.assertIn('if [ "$POWER_RECEIPTS_BOUND" -eq 1 ]; then', source)
        self.assertIn('umount "$RUNTIME_ROOT$POWER_RECEIPTS_MOUNT_RELATIVE"', source)
        self.assertLess(
            source.index('if [ "$POWER_RECEIPTS_BOUND" -eq 1 ]; then'),
            source.index('if [ "$ORDAX_BOUND" -eq 1 ]; then'),
        )

    def test_binder_really_restricts_writes_inside_disposable_mount_namespace(self):
        if not shutil.which("unshare") or not shutil.which("mount"):
            self.skipTest("mount namespace tools not installed")
        with tempfile.TemporaryDirectory(prefix="ordax-power-readonly-") as temp:
            root = Path(temp)
            source = root / "host-power"
            target = root / "chroot" / "srv" / "ordax-power-receipts"
            source.mkdir(parents=True)
            target.mkdir(parents=True)
            (source / "last-request").write_text("shutdown|opaque|123|failed\n", encoding="ascii")
            script = "\n".join([
                "set -eu",
                'mount -o bind "$1" "$2"',
                'mount -o remount,bind,ro "$2"',
                'grep -F " $2 " /proc/mounts | grep -q " ro,"',
                'test -r "$2/last-request"',
                # A read-only bind must reject creation even if the source is writable.
                'if touch "$2/must-not-write" 2>/dev/null; then exit 9; fi',
                'umount "$2"',
            ])
            result = subprocess.run(
                ["unshare", "-m", "--propagation", "private", "--",
                 "/bin/sh", "-c", script, "mount-proof", str(source), str(target)],
                capture_output=True, text=True, timeout=15,
            )
            if result.returncode != 0 and "Operation not permitted" in result.stderr:
                self.skipTest("runner lacks CAP_SYS_ADMIN for private mount namespace")
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertFalse((source / "must-not-write").exists())


if __name__ == "__main__":
    unittest.main()
