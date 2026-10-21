#!/usr/bin/env python3
"""Hermetic proof that the Guardian checks every ext4 alias, not just /.

This deliberately does not remount the CI runner's root filesystem.
"""
from __future__ import annotations

import os
from pathlib import Path
import subprocess
import tempfile
import unittest

GUARDIAN = Path(__file__).resolve().parents[1] / "system/entrypoint"


def extract_function(source: str, name: str) -> str:
    token = f"{name}() {{\n"
    assert source.count(token) == 1, name
    return token + source.split(token, 1)[1].split("\n}\n", 1)[0] + "\n}\n"


class OwnerUsbSuperblockSealTests(unittest.TestCase):
    def test_source_has_one_superblock_owner_and_block_identity_gate(self) -> None:
        source = GUARDIAN.read_text(encoding="utf-8")
        subprocess.run(["sh", "-n", str(GUARDIAN)], check=True)
        root = extract_function(source, "owner_usb_root_source")
        seal = extract_function(source, "owner_usb_seal_root_for_power")
        restore = extract_function(source, "owner_usb_restore_root_after_abort")
        self.assertIn('sys=/sys/class/block/$name', root)
        self.assertIn('[ "$partition" = 2 ] && [ "$removable" = 1 ]', root)
        self.assertIn('[ "$root_id" = "$device_id" ]', root)
        self.assertIn('[ -b "$device" ]', root)
        self.assertIn('mount -o remount,ro "$device" /', seal)
        self.assertNotIn("mount -o remount,bind,ro", seal)
        self.assertIn("owner_usb_all_root_mounts_read_only", seal)
        self.assertIn('mount -o remount,rw "$OWNER_USB_ROOT_SOURCE" /', restore)
        self.assertIn("owner_usb_auxiliary_partitions_quiesced", seal)
        self.assertNotIn("/proc/sysrq-trigger", source)

    def _probe_mounts(self, alias_options: str, superblock_options: str = "ro,errors=remount-ro") -> int:
        source = GUARDIAN.read_text(encoding="utf-8")
        function = extract_function(source, "owner_usb_all_root_mounts_read_only")
        # Only the proc path is redirected to a disposable fixture. No actual
        # mount state can be changed by this test.
        function = function.replace("/proc/self/mountinfo", '"$MOUNTINFO"')
        function = function.replace("/bin/busybox awk", "awk")
        with tempfile.TemporaryDirectory(prefix="ordax-ext4-alias-proof-") as directory:
            info = Path(directory) / "mountinfo"
            info.write_text(
                "12 1 8:34 /dev-base / ro,relatime - ext4 /dev/sde2 " + superblock_options + "\n"
                "13 12 8:34 /state /state " + alias_options + " - ext4 /dev/sde2 " + superblock_options + "\n"
                "14 12 8:34 /workspace /workspace ro,relatime - ext4 /dev/sde2 " + superblock_options + "\n"
                "15 12 0:29 / /proc rw,nosuid,nodev,noexec - proc proc rw\n",
                encoding="utf-8",
            )
            run = subprocess.run(
                ["sh", "-c", function + "\nowner_usb_all_root_mounts_read_only"],
                env={**os.environ, "MOUNTINFO": str(info)},
                capture_output=True, text=True, timeout=5,
            )
            return run.returncode

    def _probe_auxiliary_partitions(
        self, *, major_minor: str, vfs: str = "rw", superblock: str = "rw",
        absent_sysfs: bool = False,
    ) -> int:
        source = GUARDIAN.read_text(encoding="utf-8")
        function = extract_function(source, "owner_usb_auxiliary_partitions_quiesced")
        function = function.replace("/proc/self/mountinfo", '"$MOUNTINFO"')
        function = function.replace("/bin/busybox awk", "awk")
        function = function.replace("/bin/busybox cat", "mock_cat")
        with tempfile.TemporaryDirectory(prefix="ordax-auxiliary-mounts-") as directory:
            info = Path(directory) / "mountinfo"
            info.write_text(
                f"31 1 {major_minor} / /aux {vfs},relatime - vfat /dev/anything {superblock}\n",
                encoding="utf-8",
            )
            script = (
                'owner_usb_root_source() { printf "/dev/sde2\\n"; }\n'
                'mock_cat() {\n'
                '  [ "$MISSING_SYSFS" = 1 ] && return 1\n'
                '  case "$1" in */sde1/dev) printf "8:33\\n" ;;\n'
                '                 */sde3/dev) printf "8:35\\n" ;;\n'
                '                 *) return 1 ;; esac\n'
                '}\n'
                + function
                + "\nowner_usb_auxiliary_partitions_quiesced\n"
            )
            # Sysfs existence is redirected to disposable fixtures, too.
            sysdir = Path(directory) / "sys"
            (sysdir / "sde1").mkdir(parents=True)
            (sysdir / "sde3").mkdir(parents=True)
            for part in ("sde1", "sde3"):
                (sysdir / part / "dev").write_text("unused\n", encoding="ascii")
            script = script.replace("/sys/class/block/", str(sysdir) + "/")
            run = subprocess.run(
                ["sh", "-c", script],
                env={
                    **os.environ,
                    "MOUNTINFO": str(info),
                    "MISSING_SYSFS": "1" if absent_sysfs else "0",
                },
                capture_output=True, text=True, timeout=5,
            )
            return run.returncode

    def test_writable_esp_alias_blocks_power_regardless_of_device_path(self) -> None:
        self.assertNotEqual(self._probe_auxiliary_partitions(major_minor="8:33"), 0)

    def test_writable_data_alias_blocks_power(self) -> None:
        self.assertNotEqual(self._probe_auxiliary_partitions(major_minor="8:35"), 0)

    def test_readonly_alias_on_writable_esp_superblock_blocks_power(self) -> None:
        self.assertNotEqual(
            self._probe_auxiliary_partitions(
                major_minor="8:33", vfs="ro", superblock="rw",
            ), 0,
        )

    def test_readonly_esp_does_not_block_power(self) -> None:
        self.assertEqual(
            self._probe_auxiliary_partitions(
                major_minor="8:33", vfs="ro", superblock="ro",
            ), 0,
        )

    def test_unrelated_writable_filesystem_is_not_targeted(self) -> None:
        self.assertEqual(self._probe_auxiliary_partitions(major_minor="8:49"), 0)

    def test_unavailable_auxiliary_identity_fails_closed(self) -> None:
        self.assertNotEqual(
            self._probe_auxiliary_partitions(major_minor="8:49", absent_sysfs=True), 0,
        )

    def test_all_aliases_and_superblock_readonly_pass(self) -> None:
        self.assertEqual(self._probe_mounts("ro,relatime"), 0)

    def test_one_writable_bind_alias_fails_closed(self) -> None:
        self.assertNotEqual(self._probe_mounts("rw,relatime"), 0)

    def test_writable_superblock_fails_even_with_readonly_aliases(self) -> None:
        self.assertNotEqual(self._probe_mounts("ro,relatime", "rw,errors=remount-ro"), 0)


    def test_disposable_ext4_bind_topology_in_private_mount_namespace(self) -> None:
        """Optional privileged integration: never touches host root or real USB."""
        if os.environ.get("ORDAX_OWNER_USB_MOUNT_INTEGRATION") != "1":
            self.skipTest("requires explicit disposable mount integration gate")
        self.assertEqual(os.geteuid(), 0, "privileged isolated integration required")
        source = GUARDIAN.read_text(encoding="utf-8")
        function = extract_function(source, "owner_usb_all_root_mounts_read_only")
        old = (
            "mount_id=$(/bin/busybox awk '$5 == \"/\" { print $3; exit }' "
            "/proc/self/mountinfo 2>/dev/null || true)"
        )
        self.assertIn(old, function)
        function = function.replace(
            old,
            "mount_id=$(/bin/busybox awk -v target=\"$ROOTMOUNT\" "
            "'$5 == target { print $3; exit }' /proc/self/mountinfo 2>/dev/null || true)",
        )
        # unshare -m creates a private Linux mount namespace. The only block
        # device used is a 128 MiB loop of a disposable regular file.
        script = r"""
set -eu
mount --make-rprivate /
scratch=$(mktemp -d /tmp/ordax-owner-mount-XXXXXXXX)
loop=""
cleanup() {
    set +e
    for name in workspace state home root base; do
        umount "$scratch/$name" >/dev/null 2>&1 || true
    done
    [ -z "$loop" ] || losetup -d "$loop" >/dev/null 2>&1
    rm -rf "$scratch"
}
trap cleanup EXIT HUP INT TERM
mkdir -p "$scratch/base" "$scratch/root" "$scratch/state" "$scratch/workspace" "$scratch/home"
truncate -s 134217728 "$scratch/usb.img"
mkfs.ext4 -q -F "$scratch/usb.img"
loop=$(losetup --find --show "$scratch/usb.img")
mount -t ext4 "$loop" "$scratch/base"
mkdir -p "$scratch/base/dev-base" "$scratch/base/state" "$scratch/base/workspace" "$scratch/base/home"
mount -o bind "$scratch/base/dev-base" "$scratch/root"
mount -o bind "$scratch/base/state" "$scratch/state"
mount -o bind "$scratch/base/workspace" "$scratch/workspace"
mount -o bind "$scratch/base/home" "$scratch/home"
printf 'written-before-seal\n' >"$scratch/state/receipt"
ROOTMOUNT=$scratch/root
""" + function + r"""
if owner_usb_all_root_mounts_read_only; then
    echo BAD_PRE_SEAL_PROOF
    exit 30
fi
/bin/busybox mount -o remount,ro "$loop" "$scratch/root"
owner_usb_all_root_mounts_read_only || {
    echo POST_SEAL_ALIASES >&2
    for name in base root state workspace home; do
        grep -F " $scratch/$name " /proc/self/mountinfo >&2 || true
    done
    exit 31
}
for name in workspace state home root base; do
    umount "$scratch/$name"
done
e2fsck -fn "$loop" >"$scratch/e2fsck.log" 2>&1 || {
    cat "$scratch/e2fsck.log"
    exit 32
}
echo PRIVATE_EXT4_MOUNT_SEAL_AND_FSCK_OK
"""
        completed = subprocess.run(
            ["unshare", "-m", "/bin/sh", "-c", script],
            capture_output=True, text=True, timeout=90,
        )
        self.assertEqual(completed.returncode, 0, completed.stdout + completed.stderr)
        self.assertIn("PRIVATE_EXT4_MOUNT_SEAL_AND_FSCK_OK", completed.stdout)


if __name__ == "__main__":
    unittest.main()
