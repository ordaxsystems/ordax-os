#!/usr/bin/env python3
"""Regression for the real UEFI efivarfs mount's chroot visibility.

The Surface's /sys bind is nonrecursive. Exercise its canonical optional
efivarfs binder with fake mountinfo and a mocked *mount syscall only*; no
firmware variables, host mounts or device images are touched.
"""
from __future__ import annotations

import os
from pathlib import Path
import shlex
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SURFACE = ROOT / "system/surface/bin/ordax-surface"


class OwnerEfivarfsChrootBindTests(unittest.TestCase):
    def _run(
        self,
        *,
        uefi=True,
        filesystem="efivarfs",
        duplicate=False,
        destination_mounted=False,
        symlink=False,
    ):
        with tempfile.TemporaryDirectory(prefix="ordax-efi-bind-test-") as d:
            root = Path(d)
            efi = root / "sys/firmware/efi"
            host = efi / "efivars"
            runtime = root / "runtime"
            target = runtime / host.relative_to("/")
            if uefi:
                efi.mkdir(parents=True)
                if symlink:
                    outside = root / "outside"
                    outside.mkdir()
                    host.symlink_to(outside, target_is_directory=True)
                else:
                    host.mkdir()
                target.mkdir(parents=True)
            mountinfo = root / "mountinfo"
            entry = f"42 31 0:41 / {host} rw,nosuid,nodev - {filesystem} {filesystem} rw\n"
            records = (entry * (2 if duplicate else 1)) if uefi else ""
            if destination_mounted:
                records += f"43 31 0:41 / {target} rw - efivarfs efivarfs rw\n"
            mountinfo.write_text(records, encoding="utf-8")
            mount_log = root / "mount.log"
            host_log = root / "host.log"
            host_log.touch()

            source = SURFACE.read_text(encoding="utf-8")
            function = "bind_owner_efivarfs_into_runtime() {" + source.split(
                "bind_owner_efivarfs_into_runtime() {", 1
            )[1].split("\n}\n", 1)[0] + "\n}\n"
            function = function.replace(
                "host_efivars=/sys/firmware/efi/efivars",
                "host_efivars=" + shlex.quote(str(host)),
            ).replace(
                "[ -d /sys/firmware/efi ]",
                "[ -d " + shlex.quote(str(efi)) + " ]",
            ).replace(
                '$5 == "/sys/firmware/efi/efivars"',
                '$5 == "' + str(host) + '"',
            ).replace(
                "/proc/self/mountinfo", shlex.quote(str(mountinfo)),
            ).replace(
                "/bin/busybox awk", "awk",
            ).replace(
                "/bin/busybox mount -o bind", "record_mount -o bind",
            )
            self.assertNotIn("/bin/busybox", function)

            script = (
                "set -eu\n"
                'record_mount() { printf "%s\\n" "$*" >> "$MOUNT_LOG"; }\n'
                + function
                + "\nbind_owner_efivarfs_into_runtime\n"
                + 'printf "EFIVARFS_BOUND=%s\\n" "$EFIVARFS_BOUND"\n'
            )
            env = {
                **os.environ,
                "DISTRIBUTION_PROFILE": "owner-development",
                "PRODUCT_MODE": "usb",
                "RUNTIME_ROOT": str(runtime),
                "HOST_LOG": str(host_log),
                "MOUNT_LOG": str(mount_log),
                "EFIVARFS_BOUND": "0",
            }
            result = subprocess.run(
                ["sh", "-c", script], env=env,
                capture_output=True, text=True, check=False,
            )
            return (
                result,
                mount_log.read_text() if mount_log.exists() else "",
                host_log.read_text(),
                str(host),
                str(target),
            )

    def test_real_host_efivarfs_is_directly_bound_into_chroot(self):
        result, calls, _, host, target = self._run()
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("EFIVARFS_BOUND=1", result.stdout)
        self.assertEqual(calls, f"-o bind {host} {target}\n")

    def test_unmounted_uefi_never_fakes_preflight_success(self):
        result, calls, log, _, _ = self._run(filesystem="sysfs")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("EFIVARFS_BOUND=0", result.stdout)
        self.assertEqual(calls, "")
        self.assertIn("not proven", log)

    def test_duplicate_host_mount_is_rejected(self):
        result, calls, _, _, _ = self._run(duplicate=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("EFIVARFS_BOUND=0", result.stdout)
        self.assertEqual(calls, "")

    def test_bios_boot_remains_operational_without_efivarfs(self):
        result, calls, _, _, _ = self._run(uefi=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("EFIVARFS_BOUND=0", result.stdout)
        self.assertEqual(calls, "")

    def test_symlinked_host_efivars_is_not_bound(self):
        result, calls, log, _, _ = self._run(symlink=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("EFIVARFS_BOUND=0", result.stdout)
        self.assertEqual(calls, "")
        self.assertIn("unavailable or unsafe", log)

    def test_preexisting_mount_is_never_overmounted(self):
        result, calls, log, _, _ = self._run(destination_mounted=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(calls, "")
        self.assertIn("already mounted", log)

    def test_nested_efi_bind_is_released_before_sys(self):
        source = SURFACE.read_text(encoding="utf-8")
        clear = source.split("clear_runtime_mounts_at() {", 1)[1].split("\n}\n", 1)[0]
        self.assertLess(
            clear.index('"$runtime_root/sys/firmware/efi/efivars"'),
            clear.index('"$runtime_root/sys"'),
        )
        cleanup = source.split("cleanup() {", 1)[1].split("\n}\n", 1)[0]
        self.assertLess(
            cleanup.index('if [ "$EFIVARFS_BOUND" -eq 1 ]'),
            cleanup.index('if [ "$SYS_BOUND" -eq 1 ]'),
        )
        self.assertIn(
            'bind_owner_efivarfs_into_runtime || return 1',
            source.split("bind_runtime_mounts() {", 1)[1].split("\n}\n", 1)[0],
        )
        subprocess.run(["sh", "-n", str(SURFACE)], check=True)


if __name__ == "__main__":
    unittest.main()
