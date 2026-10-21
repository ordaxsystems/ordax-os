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
        self.assertIn('LABEL="ORDAX"', root)
        self.assertIn('[ -b "$device" ]', root)
        self.assertIn('mount -o remount,ro "$device" /', seal)
        self.assertNotIn("mount -o remount,bind,ro", seal)
        self.assertIn("owner_usb_all_root_mounts_read_only", seal)
        self.assertIn('mount -o remount,rw "$OWNER_USB_ROOT_SOURCE" /', restore)
        self.assertIn("owner_usb_foreign_persistent_mounts_quiesced", seal)
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

    def _probe_foreign_persistent_mounts(self, *, mount_device: str, identity: str) -> int:
        source = GUARDIAN.read_text(encoding="utf-8")
        function = extract_function(source, "owner_usb_foreign_persistent_mounts_quiesced")
        function = function.replace("/proc/mounts", '"$MOUNTS"')
        function = function.replace("/bin/busybox awk", "awk")
        function = function.replace("/bin/busybox blkid", "mock_blkid")
        with tempfile.TemporaryDirectory(prefix="ordax-mounted-usb-fs-") as directory:
            mounts = Path(directory) / "mounts"
            mounts.write_text(
                f"{mount_device} /ordax-esp vfat rw,relatime 0 0\n",
                encoding="utf-8",
            )
            script = (
                'mock_blkid() { printf "%s\\n" "$MOCK_IDENTITY"; }\n'
                + function
                + "\nowner_usb_foreign_persistent_mounts_quiesced\n"
            )
            return subprocess.run(
                ["sh", "-c", script],
                env={**os.environ, "MOUNTS": str(mounts), "MOCK_IDENTITY": identity},
                capture_output=True, text=True, timeout=5,
            ).returncode

    def test_mounted_ordax_esp_rw_blocks_power(self) -> None:
        self.assertNotEqual(
            self._probe_foreign_persistent_mounts(
                mount_device="/dev/sde1", identity='/dev/sde1: LABEL="ORDAX-ESP" TYPE="vfat"',
            ), 0,
        )

    def test_unidentified_fat_source_blocks_power(self) -> None:
        self.assertNotEqual(
            self._probe_foreign_persistent_mounts(mount_device="/dev/sde1", identity=""), 0,
        )

    def test_identified_unrelated_fat_source_does_not_impersonate_ordax(self) -> None:
        self.assertEqual(
            self._probe_foreign_persistent_mounts(
                mount_device="/dev/sdf1", identity='/dev/sdf1: LABEL="OTHER" TYPE="vfat"',
            ), 0,
        )

    def test_all_aliases_and_superblock_readonly_pass(self) -> None:
        self.assertEqual(self._probe_mounts("ro,relatime"), 0)

    def test_one_writable_bind_alias_fails_closed(self) -> None:
        self.assertNotEqual(self._probe_mounts("rw,relatime"), 0)

    def test_writable_superblock_fails_even_with_readonly_aliases(self) -> None:
        self.assertNotEqual(self._probe_mounts("ro,relatime", "rw,errors=remount-ro"), 0)


if __name__ == "__main__":
    unittest.main()
