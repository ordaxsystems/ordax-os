#!/usr/bin/env python3
"""Exercise the canonical Owner Dev UEFI mount owner without touching firmware."""

from __future__ import annotations

from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
DEV_INIT = ROOT / "bootstrap/dev-base/ordax-dev-init"


class DevUefiMountOwnerTest(unittest.TestCase):
    def test_real_dev_init_orders_mount_before_runtime_pivot(self) -> None:
        source = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn("ensure_uefi_efivarfs() {", source)
        self.assertIn("mount -t efivarfs efivarfs", source)
        self.assertIn("ensure_uefi_efivarfs\nselect_development_rootfs", source)
        self.assertNotIn("efibootmgr", source)
        subprocess.run(["/bin/sh", "-n", str(DEV_INIT)], check=True)

    def _exercise(
        self, *, uefi: bool, mounted_fs: str | None = None,
        mount_fails: bool = False, symlinked_efivars: bool = False,
    ) -> tuple[subprocess.CompletedProcess[str], str, str]:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            efi_root = root / "sys/firmware/efi"
            efivars = efi_root / "efivars"
            if uefi:
                efi_root.mkdir(parents=True)
                if symlinked_efivars:
                    outside = root / "outside"
                    outside.mkdir()
                    efivars.symlink_to(outside, target_is_directory=True)
                else:
                    efivars.mkdir()
            mounts = root / "mounts"
            mounts.write_text(\n                f"{mounted_fs} {efivars} {mounted_fs} rw 0 0\\n" if mounted_fs else "",\n                encoding="utf-8",\n            )
            marker = root / "mount-invocations"

            source = DEV_INIT.read_text(encoding="utf-8")
            function = "ensure_uefi_efivarfs() {" + source.split(
                "ensure_uefi_efivarfs() {", 1
            )[1].split("\n}\n", 1)[0] + "\n}\n"
            function = function.replace("/sys/firmware/efi", str(efi_root))
            function = function.replace("/proc/mounts", str(mounts))
            # Mock only the side-effecting mount command, not the shell guards
            # or real awk parsing. No test has access to host EFI variables.
            function = function.replace("/bin/busybox mount -t efivarfs", "record_mount -t efivarfs")
            rc = 1 if mount_fails else 0
            script = (
                "record_mount() {\n"
                f"  printf '%s\\n' \"$*\" >> '{marker}'\n"
                f"  return {rc}\n"
                "}\n"
                + function
                + "ensure_uefi_efivarfs\n"
            )
            result = subprocess.run(
                ["/bin/sh", "-c", script],
                check=False, capture_output=True, text=True,
            )
            recorded = marker.read_text(encoding="utf-8") if marker.exists() else ""
            return result, recorded, str(efivars)

    def test_uefi_unmounted_installs_standard_efivarfs(self) -> None:
        result, recorded, path = self._exercise(uefi=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(recorded.strip(), f"-t efivarfs efivarfs {path}")

    def test_existing_efivarfs_or_other_mount_is_not_overmounted(self) -> None:
        for filesystem in ("efivarfs", "tmpfs"):
            with self.subTest(filesystem=filesystem):
                result, recorded, _ = self._exercise(
                    uefi=True, mounted_fs=filesystem
                )
                self.assertEqual(result.returncode, 0, result.stderr)
                self.assertEqual(recorded, "")
        # The shell's awk check must be sensitive to the exact target.
        source = DEV_INIT.read_text(encoding="utf-8")
        self.assertIn('$2 == "/sys/firmware/efi/efivars"', source)
        self.assertIn("Never mount over an existing filesystem", source)

    def test_no_uefi_skips_without_error(self) -> None:
        result, recorded, _ = self._exercise(uefi=False)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(recorded, "")

    def test_symlink_efivars_is_rejected(self) -> None:
        result, recorded, _ = self._exercise(uefi=True, symlinked_efivars=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(recorded, "")
        self.assertIn("unsafe", result.stderr)

    def test_failed_efivarfs_mount_preserves_boot_and_blocks_activation(self) -> None:
        result, recorded, path = self._exercise(uefi=True, mount_fails=True)
        self.assertEqual(result.returncode, 0)
        self.assertEqual(recorded.strip(), f"-t efivarfs efivarfs {path}")
        self.assertIn("Base activation stays blocked", result.stderr)


if __name__ == "__main__":
    unittest.main()
