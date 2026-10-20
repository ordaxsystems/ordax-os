#!/usr/bin/env python3
"""Regress evidence-only efivarfs activation preflight."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
MODULE = ROOT / "system/services/base-update/efivarfs_preflight.py"
CONTRACT = json.loads(
    (ROOT / "docs/contracts/base-update.json").read_text(encoding="utf-8")
)

spec = importlib.util.spec_from_file_location(
    "ordax_efivarfs_preflight_test",
    MODULE,
)
probe = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(probe)


class EfivarfsPreflightTests(unittest.TestCase):
    def fixture(self, root: Path, *, filesystem="efivarfs", mount="rw", super_options="rw"):
        efi = root / "sys/firmware/efi"
        efivars = efi / "efivars"
        efivars.mkdir(parents=True)
        mountinfo = root / "mountinfo"
        mountinfo.write_text(
            f"42 31 0:41 / {efivars} {mount},nosuid,nodev - "
            f"{filesystem} efivarfs {super_options}\n",
            encoding="utf-8",
        )
        return efi, efivars, mountinfo

    def test_valid_direct_writable_efivarfs_is_evidence_only(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            efi, efivars, mountinfo = self.fixture(root)
            result = probe.preflight(
                efi_root=efi,
                efivarfs_root=efivars,
                mountinfo=mountinfo,
            )
            self.assertEqual(
                result["$schema"],
                "prototype-ordax.efivarfs-preflight/1",
            )
            self.assertEqual(result["status"], "valid")
            self.assertTrue(result["uefi_boot_environment_present"])
            self.assertTrue(result["writable_mount"])
            self.assertTrue(result["direct_mountpoint"])
            self.assertTrue(result["probe_only"])
            self.assertFalse(result["write_authorized"])
            self.assertFalse(result["activation_authorized"])
            self.assertFalse(result["variable_written"])
            self.assertFalse(result["reboot_requested"])

    def test_wrong_filesystem_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            efi, efivars, mountinfo = self.fixture(root, filesystem="tmpfs")
            with self.assertRaisesRegex(
                probe.EfivarfsPreflightError,
                "filesystem is not efivarfs",
            ):
                probe.preflight(
                    efi_root=efi,
                    efivarfs_root=efivars,
                    mountinfo=mountinfo,
                )

    def test_readonly_mount_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            efi, efivars, mountinfo = self.fixture(
                root,
                mount="ro",
                super_options="ro",
            )
            with self.assertRaisesRegex(
                probe.EfivarfsPreflightError,
                "mount is read-only",
            ):
                probe.preflight(
                    efi_root=efi,
                    efivarfs_root=efivars,
                    mountinfo=mountinfo,
                )

    def test_duplicate_mount_record_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            efi, efivars, mountinfo = self.fixture(root)
            line = mountinfo.read_text(encoding="utf-8")
            mountinfo.write_text(line + line, encoding="utf-8")
            with self.assertRaisesRegex(
                probe.EfivarfsPreflightError,
                "appears multiple times",
            ):
                probe.preflight(
                    efi_root=efi,
                    efivarfs_root=efivars,
                    mountinfo=mountinfo,
                )

    def test_symlinked_efivarfs_directory_fails_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary).resolve()
            efi = root / "sys/firmware/efi"
            efi.mkdir(parents=True)
            outside = root / "outside"
            outside.mkdir()
            efivars = efi / "efivars"
            efivars.symlink_to(outside, target_is_directory=True)
            mountinfo = root / "mountinfo"
            mountinfo.write_text("", encoding="utf-8")
            with self.assertRaisesRegex(
                probe.EfivarfsPreflightError,
                "non-symlink directory",
            ):
                probe.preflight(
                    efi_root=efi,
                    efivarfs_root=efivars,
                    mountinfo=mountinfo,
                )

    def test_owner_base_agent_mounts_efivarfs_without_pid1_or_activation_bypass(self):
        agent = (ROOT / "system/services/base-update/agent.sh").read_text(encoding="utf-8")
        init = (ROOT / "bootstrap/initramfs/root/init").read_text(encoding="utf-8")
        self.assertNotIn("prepare_owner_efivarfs_mount()", init)
        self.assertIn("prepare_real_efivarfs_mount_for_preflight() {", agent)
        helper = agent.split("prepare_real_efivarfs_mount_for_preflight() {", 1)[1].split("\n}\n", 1)[0]
        self.assertIn('[ "$DISTRIBUTION_PROFILE" = owner-development ] || return 0', helper)
        self.assertIn('efi_root=$RUNTIME_ROOT/sys/firmware/efi', helper)
        self.assertIn('efivarfs_root=$efi_root/efivars', helper)
        self.assertIn('[ ! -L "$efi_root" ]', helper)
        self.assertIn('[ -L "$efivarfs_root" ]', helper)
        self.assertIn('mount_record_for "$efivarfs_root"', helper)
        self.assertIn('mount -t efivarfs -o rw,nosuid,nodev,noexec efivarfs "$efivarfs_root"', helper)
        self.assertIn("Base activation remains disabled", helper)
        self.assertIn("prepare_real_efivarfs_mount_for_preflight\n", agent)
        for forbidden in ("efi-updatevar", "efibootmgr", "chattr -i", "reboot -f", "activation_authorized=true"):
            self.assertNotIn(forbidden, helper)
        import subprocess
        subprocess.run(["sh", "-n", str(ROOT / "bootstrap/initramfs/root/init")], check=True)
        subprocess.run(["sh", "-n", str(ROOT / "system/services/base-update/agent.sh")], check=True)

    def test_contract_keeps_probe_non_authoritative(self):
        value = CONTRACT["activation"]["efivarfs_preflight"]
        self.assertEqual(
            value["helper"],
            "system/services/base-update/efivarfs_preflight.py",
        )
        self.assertEqual(
            value["schema"],
            "prototype-ordax.efivarfs-preflight/1",
        )
        self.assertTrue(value["exact_direct_mountpoint_required"])
        self.assertTrue(value["non_symlink_directories_required"])
        self.assertTrue(value["writable_mount_required"])
        self.assertTrue(value["readonly_mount_blocks"])
        self.assertTrue(value["duplicate_mount_record_blocks"])
        self.assertTrue(value["probe_only"])
        self.assertFalse(value["write_authorized"])
        self.assertFalse(value["activation_authorized"])
        self.assertFalse(value["variable_written"])
        self.assertFalse(value["reboot_requested"])
        self.assertTrue(value["runtime_owner_wiring_enabled"])
        self.assertTrue(value["runtime_owner_evidence_only"])
        self.assertEqual(
            value["evidence_state_file"],
            "/state/ordax/base-update/efivarfs-preflight.json",
        )
        self.assertEqual(
            value["evidence_log_file"],
            "/state/ordax/base-update/efivarfs-preflight.log",
        )
        self.assertFalse(value["evidence_failure_blocks_surface"])
        self.assertFalse(value["evidence_failure_authorizes_activation"])
        self.assertTrue(value["stale_success_removed_on_failure"])
        self.assertFalse(value["real_efivarfs_proven"])
        self.assertFalse(value["physical_notebook_proven"])


if __name__ == "__main__":
    unittest.main()
