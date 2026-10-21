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


if __name__ == "__main__":
    unittest.main()
