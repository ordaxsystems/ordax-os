#!/usr/bin/env python3
"""Regress the durable portable USB v2 proof boundary."""

from __future__ import annotations

import importlib.util
import json
import os
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "docs/contracts/portable-usb-v2.json"
SCRIPT_PATH = ROOT / "tools/creator/proof/portable_usb_v2.py"
CLI_PATH = (Path(os.environ["ORDAX_CREATOR_NATIVE_SOURCE"]) / "cmd/ordax-creator/main.go"
            if os.environ.get("ORDAX_CREATOR_NATIVE_SOURCE") else None)

spec = importlib.util.spec_from_file_location("ordax_portable_usb_v2", SCRIPT_PATH)
portable = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(portable)


class PortableUSBV2ContractTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT_PATH.read_text(encoding="utf-8"))

    def test_contract_is_valid_fail_closed_and_usb_only(self):
        portable.validate_contract(self.contract)
        self.assertFalse(self.contract["physical_write_authorized"])
        self.assertFalse(self.contract["physical_device_paths_allowed"])
        self.assertFalse(self.contract["bootable_proven"])
        self.assertEqual(
            [part["name"] for part in self.contract["partitions"]],
            ["ORDAX-ESP", "ORDAX-DATA"],
        )
        self.assertNotIn(
            "ORDAX",
            [part["name"] for part in self.contract["partitions"]],
        )

    def test_internal_system_and_state_are_files_not_physical_partitions(self):
        internal = self.contract["ordax_internal_layout"]
        release = internal["release_image"]
        state = internal["persistent_state_image"]
        self.assertEqual(release["filesystem"], "erofs")
        self.assertTrue(release["read_only"])
        self.assertTrue(release["compressed"])
        self.assertEqual(state["filesystem"], "ext4")
        self.assertEqual(state["filesystem_label"], "ORDAX-STATE")
        self.assertTrue(state["mounted_through_loop_device_in_runtime"])
        self.assertTrue(state["overlayfs_upper_owner"])
        self.assertFalse(self.contract["partitions"][1]["direct_overlayfs_upper"])

    def test_proof_script_has_no_physical_target_argument(self):
        text = SCRIPT_PATH.read_text(encoding="utf-8")
        self.assertNotIn("--device", text)
        self.assertNotIn("--target-device", text)
        self.assertIn('if str(output_root).startswith("/dev/")', text)
        self.assertIn('loop.startswith("/dev/loop")', text)
        self.assertIn('"physical_device_touched": False', text)
        self.assertIn('"physical_write_authorized": False', text)

    def test_creator_engineering_cli_exposes_pure_portable_planner(self):
        # The Portable proof resolves and tests the exact independent Creator
        # before this test, never a Go file copied into the OS repository.
        workflow = (ROOT / ".github/workflows/portable-usb-v2-proof.yml").read_text(encoding="utf-8")
        self.assertIn("uses: ./.github/actions/resolve-creator-source", workflow)
        self.assertIn("tests.test_portable_usb_v2_contract", workflow)
        self.assertIn("ORDAX_CREATOR_NATIVE_SOURCE", workflow)
        self.assertIn("go test -count=1 ./core ./cmd/ordax-creator", workflow)
        if CLI_PATH is not None:
            text = CLI_PATH.read_text(encoding="utf-8")
            self.assertIn('ordax-creator plan-portable --target-bytes <bytes>', text)
            self.assertIn('creatorcore.PlanPortableTargetStorage(*targetBytes)', text)
            self.assertNotIn("PhysicalDrive", text)


if __name__ == "__main__":
    unittest.main()
