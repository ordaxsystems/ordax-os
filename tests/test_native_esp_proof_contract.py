#!/usr/bin/env python3
"""Regress the disposable Native ESP materialization proof boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF = json.loads((ROOT / "docs/contracts/native-esp-proof.json").read_text(encoding="utf-8"))
ESP = json.loads((ROOT / "docs/contracts/native-esp.json").read_text(encoding="utf-8"))
STORAGE = json.loads((ROOT / "docs/contracts/storage-architecture.json").read_text(encoding="utf-8"))
SCRIPT = (ROOT / "tools/creator/proof/native_esp.py").read_text(encoding="utf-8")
WORKFLOW = (ROOT / ".github/workflows/native-esp-candidate.yml").read_text(encoding="utf-8")


class NativeESPProofContractTests(unittest.TestCase):
    def test_proof_is_metadata_only_and_never_claims_boot_or_physical_write(self):
        self.assertEqual(PROOF["$schema"], "prototype-ordax.native-esp-proof/1")
        self.assertFalse(PROOF["physical_device_paths_allowed"])
        self.assertFalse(PROOF["physical_write_authorized"])
        self.assertFalse(PROOF["qemu_uefi_boot_proven"])
        self.assertFalse(PROOF["physical_native_boot_proven"])
        self.assertTrue(PROOF["fat32_image"]["destroy_before_success"])
        self.assertIn("metadata-only-upload", PROOF["proof_requirements"])
        self.assertIn("physical-apply-authorized", PROOF["forbidden_claims"])

    def test_disposable_image_uses_native_esp_minimum_size_policy(self):
        native = STORAGE["profiles"]["native-disk"]["physical_layout"]
        esp = next(item for item in native if item["name"] == "ORDAX-ESP")
        self.assertEqual(esp["filesystem"], "fat32")
        self.assertEqual(esp["size_policy"]["minimum_bytes"], 536870912)
        self.assertEqual(PROOF["fat32_image"]["label"], "ORDAX-ESP")
        self.assertIn("size_policy", PROOF["fat32_image"]["size_policy_source"])

    def test_proof_consumes_exact_native_layout_and_real_luks_identity(self):
        self.assertEqual(
            set(ESP["target_layout"]),
            {
                "EFI/BOOT/BOOTX64.EFI",
                "loader/loader.conf",
                "loader/entries/ordax-native.conf",
                "loader/entries/ordax-native-recovery.conf",
                "ordax/vmlinuz",
                "ordax/native-initrd.gz",
            },
        )
        self.assertEqual(PROOF["pool_identity"]["source"], "disposable-real-luks2-header")
        for marker in (
            'cryptsetup", "isLuks"',
            'cryptsetup", "luksUUID"',
            'mkfs.vfat',
            'mcopy',
            'mtype',
            'source_commit',
            'physical_device_touched',
            'physical_device_untouched',
            'image_destroyed',
        ):
            self.assertIn(marker, SCRIPT)

    def test_boolean_checks_encode_success_not_negative_safety_state(self):
        self.assertIn('"physical_device_untouched": False', SCRIPT)
        self.assertIn('checks["physical_device_untouched"] = True', SCRIPT)
        self.assertNotIn('"physical_device_touched": False,\n        "image_destroyed"', SCRIPT)
        self.assertIn('"physical_device_touched": False', SCRIPT)

    def test_workflow_uses_creator_core_render_and_exact_source_identity(self):
        identity = "${{ github.event.pull_request.head.sha || github.sha }}"
        self.assertIn(f"ref: {identity}", WORKFLOW)
        self.assertIn(f"ORDAX_SOURCE_COMMIT: {identity}", WORKFLOW)
        self.assertIn('uses: ./.github/actions/resolve-creator-source', WORKFLOW)
        self.assertIn('ORDAX_CREATOR_SOURCE_REPOSITORY', WORKFLOW)
        self.assertIn("rev-parse 'HEAD^{tree}'", WORKFLOW)
        self.assertIn('"$creator_cli" render-native-boot', WORKFLOW)
        self.assertIn("ORDAX_OS_CONTRACTS_DIR=", WORKFLOW)
        self.assertNotIn("cd tools/creator", WORKFLOW)
        self.assertNotIn("go run ./cmd/ordax-creator", WORKFLOW)
        self.assertIn("NATIVE_ESP_PHYSICAL_WRITE_AUTHORIZED=NO", WORKFLOW)
        self.assertIn("permissions:" + chr(10) + "  contents: read", WORKFLOW)
        self.assertIn("--pool-uuid", WORKFLOW)
        self.assertIn("native-esp-proof/proof.json", WORKFLOW)
        self.assertIn(
            "Prove Native UEFI and PID1 handoff on disposable QEMU disk",
            WORKFLOW,
        )
        self.assertIn("qemu-system-x86", WORKFLOW)
        self.assertIn("native-qemu-proof/proof.json", WORKFLOW)


if __name__ == "__main__":
    unittest.main()
