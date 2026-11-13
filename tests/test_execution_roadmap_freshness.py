import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PORTABLE_BOOTSTRAP = ROOT / "docs" / "contracts" / "portable-bootstrap-v2.json"
PORTABLE_MEDIA_PLAN = ROOT / "docs" / "contracts" / "creator-portable-media-plan.json"
QEMU_PROOF = ROOT / "docs" / "contracts" / "portable-v2-qemu-boot-proof.json"
UEFI_PROOF = ROOT / "docs" / "contracts" / "portable-v2-uefi-boot-proof.json"


class StructuredPortableStateFreshnessTests(unittest.TestCase):
    def test_structured_contracts_keep_source_progress_separate_from_physical_promotion(self):
        bootstrap = json.loads(PORTABLE_BOOTSTRAP.read_text(encoding="utf-8"))
        media = json.loads(PORTABLE_MEDIA_PLAN.read_text(encoding="utf-8"))
        qemu = json.loads(QEMU_PROOF.read_text(encoding="utf-8"))
        uefi = json.loads(UEFI_PROOF.read_text(encoding="utf-8"))

        self.assertTrue(bootstrap["migration"]["portable_v2_pid1_integration_implemented"])
        self.assertTrue(media["physical_writer_v2_implemented"])
        self.assertFalse(media["public_mvp_default_enabled"])
        self.assertFalse(media["physical_write_authorized"])
        self.assertFalse(bootstrap["physical_boot_proven"])
        self.assertFalse(bootstrap["physical_write_authorized"])

        self.assertEqual(qemu["workflow"], ".github/workflows/portable-v2-qemu-boot-proof.yml")
        self.assertTrue(qemu["qemu_direct_kernel_boot_proven"])
        self.assertFalse(qemu["physical_boot_proven"])
        self.assertFalse(qemu["physical_write_authorized"])

        self.assertEqual(uefi["workflow"], ".github/workflows/portable-v2-qemu-boot-proof.yml")
        self.assertTrue(uefi["qemu_uefi_boot_proven"])
        self.assertFalse(uefi["physical_usb_boot_proven"])
        self.assertFalse(uefi["public_physical_promotion_allowed"])
        self.assertFalse(uefi["physical_write_authorized"])

    def test_contracts_do_not_claim_secure_boot_or_physical_target_use(self):
        bootstrap = json.loads(PORTABLE_BOOTSTRAP.read_text(encoding="utf-8"))
        qemu = json.loads(QEMU_PROOF.read_text(encoding="utf-8"))
        uefi = json.loads(UEFI_PROOF.read_text(encoding="utf-8"))

        self.assertFalse(bootstrap["secure_boot_claimed"])
        self.assertFalse(qemu["physical_target_device_touched"])
        self.assertFalse(uefi["physical_target_device_touched"])
        self.assertFalse(uefi["secure_boot_proven"])


if __name__ == "__main__":
    unittest.main()
