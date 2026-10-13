#!/usr/bin/env python3
"""Regress the disposable Native UEFI/QEMU proof boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/native-qemu-boot-proof.json").read_text(encoding="utf-8")
)
SCRIPT = (ROOT / "tools/creator/proof/native_qemu_boot.py").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/native-esp-candidate.yml").read_text(
    encoding="utf-8"
)


class NativeQemuBootProofContractTests(unittest.TestCase):
    def test_qemu_is_ci_only_and_never_a_user_or_physical_requirement(self):
        self.assertEqual(CONTRACT["$schema"], "prototype-ordax.native-qemu-boot-proof/1")
        self.assertTrue(CONTRACT["ci_only"])
        self.assertFalse(CONTRACT["end_user_qemu_requirement"])
        self.assertFalse(CONTRACT["physical_target_device_paths_allowed"])
        self.assertTrue(CONTRACT["host_loop_devices_allowed"])
        self.assertFalse(CONTRACT["physical_write_authorized"])
        self.assertFalse(CONTRACT["physical_native_boot_proven"])
        self.assertFalse(CONTRACT["production_release_handoff_proven"])

    def test_unlock_secret_has_no_boot_artifact_or_cmdline_path(self):
        unlock = CONTRACT["unlock"]
        self.assertEqual(unlock["mechanism"], "interactive-virtual-ps2-keyboard")
        self.assertTrue(unlock["passphrase_generated_at_runtime"])
        self.assertTrue(unlock["ephemeral_key_file_destroyed_before_vm_boot"])
        for field in (
            "passphrase_in_repository",
            "passphrase_in_kernel_cmdline",
            "passphrase_in_esp",
            "passphrase_in_initramfs",
            "passphrase_in_proof_metadata",
        ):
            self.assertFalse(unlock[field], field)
        self.assertNotIn("--key-file", (ROOT / "bootstrap/native-initramfs/root/init").read_text())

    def test_proof_uses_exact_verified_artifacts_and_real_boot_boundary(self):
        for marker in (
            "verify_inputs(args)",
            '"sgdisk"',
            '"--new=1:2048:+1G"',
            '"--new=2:0:0"',
            '"--change-name=1:ORDAX-ESP"',
            '"--change-name=2:ORDAX-POOL"',
            '"losetup", "--find", "--show", "--partscan"',
            '"cryptsetup", "luksFormat"',
            '"mkfs.btrfs"',
            '"qemu-system-x86_64"',
            '"-net", "none"',
            "type_passphrase(client, passphrase)",
            "ORDAX_NATIVE_QEMU_HANDOFF=PASS",
            "ORDAX_NATIVE_QEMU_PERSISTENCE=PASS",
            '"production_stable_release_boot_proven": False',
            '"physical_native_boot_proven": False',
        ):
            self.assertIn(marker, SCRIPT)

    def test_workflow_reuses_native_esp_job_instead_of_second_artifact_pipeline(self):
        self.assertIn("Prove Native UEFI and PID1 handoff on disposable QEMU disk", WORKFLOW)
        self.assertIn("out/native-esp-kernel/vmlinuz-$ORDAX_KERNEL_VERSION", WORKFLOW)
        self.assertIn('python3 bootstrap/kernel/ci_env.py --github-env "$GITHUB_ENV"', WORKFLOW)
        self.assertNotIn("out/native-esp-kernel/vmlinuz-6.6.52", WORKFLOW)
        self.assertIn("out/native-esp-initramfs/native-initramfs.cpio.gz", WORKFLOW)
        self.assertIn("out/native-esp-bootloader/systemd-bootx64.efi", WORKFLOW)
        self.assertIn("out/native-esp-proof/proof.json", WORKFLOW)
        self.assertIn("qemu-system-x86", WORKFLOW)
        self.assertIn("ovmf", WORKFLOW)

    def test_proof_keeps_production_release_and_physical_apply_out_of_scope(self):
        self.assertIn("production-stable-release-boot-proven", CONTRACT["forbidden_claims"])
        self.assertIn("physical-native-boot-proven", CONTRACT["forbidden_claims"])
        self.assertIn("physical-apply-authorized", CONTRACT["forbidden_claims"])
        self.assertIn("qemu-required-for-end-users", CONTRACT["forbidden_claims"])


if __name__ == "__main__":
    unittest.main()
