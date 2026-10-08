#!/usr/bin/env python3
"""Regression tests for the Stable/MVP Native installation boundary."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
INSTALL = ROOT / "docs" / "contracts" / "native-installation.json"
STORAGE = ROOT / "docs" / "contracts" / "storage-architecture.json"


class NativeInstallationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.install = json.loads(INSTALL.read_text(encoding="utf-8"))
        cls.storage = json.loads(STORAGE.read_text(encoding="utf-8"))

    def test_native_is_in_mvp_integration_scope_but_not_yet_public(self):
        self.assertEqual(
            self.install["$schema"], "prototype-ordax.native-installation/1"
        )
        self.assertFalse(self.install["mvp_required"])  # Not a blocker for the first USB release.
        integration = self.install["mvp_implementation_scope"]
        self.assertEqual(integration["authority"], "MVP.md")
        self.assertTrue(integration["native_disk_included"])
        self.assertTrue(integration["current_first_usb_release_not_blocked"])
        self.assertTrue(integration["native_public_promotion_requires_physical_e2e"])
        availability = self.install["mvp_availability"]
        self.assertFalse(availability["available"])
        self.assertFalse(availability["advertised"])
        self.assertFalse(availability["capability_exposed"])
        self.assertFalse(availability["target_discovery_exposed"])
        self.assertFalse(availability["internal_disk_write_allowed"])
        self.assertFalse(availability["destructive_operations_allowed"])
        self.assertEqual(availability["activation_phase"], "mvp-after-physical-acceptance")
        self.assertTrue(availability["foundation_retained"])
        self.assertEqual(self.install["source_mode"], "ordax-usb")
        self.assertEqual(self.install["target_mode"], "native-disk")

    def test_future_activation_scope_is_whole_disk_and_does_not_fake_dual_boot(self):
        scope = self.install["post_mvp_activation_scope"]
        self.assertTrue(scope["whole_disk_install"])
        self.assertTrue(scope["target_must_be_explicitly_selected"])
        self.assertTrue(scope["source_boot_media_must_not_be_target"])
        self.assertTrue(scope["existing_target_data_is_erased"])
        self.assertTrue(scope["explicit_destructive_confirmation_required"])
        self.assertFalse(scope["install_alongside_existing_os"])
        self.assertFalse(scope["automatic_partition_shrink"])
        self.assertFalse(scope["manual_partition_editor"])

    def test_native_layout_matches_storage_authority(self):
        target = self.install["target_layout"]
        native = self.storage["profiles"]["native-disk"]
        self.assertEqual(target["partition_table"], native["partition_table"])
        self.assertEqual(
            target["partitions"],
            [partition["name"] for partition in native["physical_layout"]],
        )
        self.assertEqual(target["pool_encryption"], "luks2")
        self.assertEqual(target["pool_filesystem"], "btrfs")
        self.assertTrue(target["pool_fills_remaining_capacity"])

    def test_physical_apply_remains_fail_closed(self):
        state = self.install["current_implementation"]
        self.assertIn("PlanNativeDiskTargetStorage", state["native_geometry_planner"])
        self.assertIn("PlanNativeInstallation", state["native_install_plan"])
        self.assertFalse(state["physical_apply_implemented"])
        self.assertFalse(state["physical_apply_authorized"])
        self.assertFalse(state["first_boot_health_connected"])
        self.assertFalse(state["native_source_boot_identity_handoff"])
        self.assertIn("DiscoverMountedBlockDevice", state["native_source_boot_mount_discovery"])
        policy = state["mvp_runtime_policy"]
        self.assertEqual(policy["stable_mvp_native_install_capability"], "disabled")
        self.assertFalse(policy["stable_mvp_broker_started"])
        self.assertFalse(policy["stable_mvp_session_token_exposed"])
        self.assertFalse(policy["stable_mvp_internal_disk_apply_allowed"])
        self.assertTrue(policy["owner_development_post_mvp_preview_requires_explicit_opt_in"])
        mode = state["native_product_mode_identity"]
        self.assertTrue(mode["implemented"])
        self.assertEqual(mode["usb_value"], "usb")
        self.assertEqual(mode["installed_value"], "native-disk")
        self.assertEqual(mode["runtime_handoff"], "ORDAX_PRODUCT_MODE")


if __name__ == "__main__":
    unittest.main()
