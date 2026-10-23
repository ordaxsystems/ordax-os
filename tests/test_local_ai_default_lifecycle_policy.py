#!/usr/bin/env python3
"""Source guardrails for default local AI delivery and honest lifecycle gates.

These tests do NOT prove a physical USB install or remove/reinstall.
"""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
LOCAL_AI = ROOT / "docs/contracts/local-ai.json"
CREATOR = ROOT / "docs/contracts/creator-portable-media-plan.json"
BOOT = ROOT / "bootstrap/initramfs/portable_init.sh"


class LocalAiDefaultLifecyclePolicyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(LOCAL_AI.read_text(encoding="utf-8"))
        cls.creator = json.loads(CREATOR.read_text(encoding="utf-8"))
        cls.boot = BOOT.read_text(encoding="utf-8")

    def test_offline_model_is_part_of_default_creator_product(self):
        self.assertTrue(self.contract["required_for_stable_mvp_distribution"])
        self.assertEqual(
            self.contract["default_creator_selection"], "included-by-product-policy"
        )
        self.assertFalse(self.contract["creator_toggle"]["user_may_disable"])
        self.assertFalse(
            self.contract["creator_toggle"]["exposed_as_install_omission_toggle"]
        )
        ai = self.creator["local_ai_runtime_preseed"]
        self.assertTrue(ai["implemented"])
        self.assertEqual(ai["image_artifact_id"], "local-ai-runtime-image")
        self.assertEqual(ai["reference_artifact_id"], "local-ai-runtime-ref")
        self.assertTrue(ai["content_addressed"])
        self.assertFalse(self.creator["public_mvp_default_enabled"])

    def test_payload_and_user_data_have_distinct_storage_owners(self):
        storage = self.contract["storage"]
        self.assertTrue(storage["model_must_not_live_in_system_erofs"])
        self.assertTrue(storage["mutable_user_state_must_not_live_in_ai_erofs"])
        self.assertTrue(storage["removal_preserves_user_files"])
        self.assertIn("/.ordax/ai-runtimes/sha256/", self.creator[
            "local_ai_runtime_preseed"
        ]["image_target"])

    def test_removal_is_post_install_not_creator_omission(self):
        policy = self.contract["post_install_lifecycle"]
        self.assertEqual(
            policy["distribution_default"], "creator-preseeds-signed-model-and-engine"
        )
        self.assertTrue(policy["intelligence_service_is_system_owned"])
        self.assertTrue(policy["local_ai_port_is_system_owned"])
        self.assertTrue(policy["model_engine_payload_is_independently_manageable"])
        self.assertTrue(policy["user_can_request_removal_after_install"])
        self.assertTrue(policy["user_can_request_reinstallation_after_removal"])
        self.assertTrue(policy["explicit_user_action_required_for_removal"])
        self.assertTrue(policy["remove_must_not_delete_memory_or_user_data"])
        self.assertTrue(policy["no_implicit_reinstall_after_explicit_removal"])
        self.assertTrue(policy["reclaim_only_unreferenced_unmounted_payloads"])
        self.assertTrue(policy["reinstall_must_reverify_signed_source"])

    def test_do_not_claim_v4_model_removal_is_boot_safe_yet(self):
        policy = self.contract["post_install_lifecycle"]
        self.assertFalse(self.contract["required_for_boot"])
        self.assertTrue(policy["v4_release_verification_currently_requires_ai_blob"])
        self.assertFalse(policy["v4_ai_boot_dependency_removed"])
        self.assertFalse(policy["remove_reinstall_backend_implemented"])
        self.assertFalse(policy["user_interface_actions_enabled"])
        self.assertFalse(policy["stable_usb_physical_default_ready_proven"])
        self.assertFalse(policy["development_usb_default_ready_proven"])
        self.assertIn("verify-portable-v4-exact", self.boot)
        self.assertIn('ai_image="$PORTABLE_ROOT/ai-runtimes/sha256/', self.boot)
        self.assertIn('[ -f "$ai_image" ] || return 1', self.boot)

    def test_do_not_create_unverified_second_updater(self):
        policy = self.contract["post_install_lifecycle"]
        self.assertEqual(
            policy["activation_state_owner_target"],
            "existing-runtime-component-channel-after-erofs-size-trust-and-health-integration",
        )
        self.assertTrue(policy["boot_attestation_migration_requires_versioned_protocol"])
        self.assertTrue(policy["update_requires_verified_health_and_reversible_activation"])
        self.assertFalse(policy["independent_model_upgrade_backend_implemented"])


if __name__ == "__main__":
    unittest.main()
