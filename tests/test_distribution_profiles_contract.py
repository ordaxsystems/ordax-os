#!/usr/bin/env python3
"""Regress the Owner/Development vs Stable/MVP distribution boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/distribution-profiles.json").read_text(encoding="utf-8")
)
RELEASE_CHANNEL = json.loads(
    (ROOT / "docs/contracts/release-channel.json").read_text(encoding="utf-8")
)
PUBLIC_SITE = json.loads(
    (ROOT / "docs/contracts/public-site.json").read_text(encoding="utf-8")
)


class DistributionProfilesContractTests(unittest.TestCase):
    def test_single_product_source_authority(self):
        source = CONTRACT["source_authority"]
        self.assertEqual(source["repository"], "ordaxsystems/ordax-os")
        self.assertEqual(source["branch"], "main")
        self.assertTrue(source["single_product_codebase"])
        self.assertFalse(source["permanent_profile_forks_allowed"])

    def test_owner_profile_is_internal_git_first(self):
        owner = CONTRACT["profiles"]["owner-development"]
        self.assertFalse(owner["public_distribution"])
        self.assertTrue(owner["operational_git_allowed"])
        self.assertTrue(owner["full_git_client_allowed"])
        self.assertTrue(owner["source_checkout_allowed"])
        self.assertEqual(owner["normal_update_transport"], "git-main")
        self.assertEqual(
            owner["normal_update_owner"],
            "bootstrap/dev-base/ordax-pull",
        )
        self.assertEqual(owner["runtime_update_owner"], "system/supervisor")
        self.assertEqual(
            owner["base_update_owner"],
            "system/services/base-update/agent.sh",
        )
        self.assertTrue(owner["diagnostic_source_sha_visible"])

    def test_stable_profile_has_no_operational_git_dependency(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertTrue(stable["public_distribution"])
        self.assertFalse(stable["operational_git_allowed"])
        self.assertFalse(stable["full_git_client_required"])
        self.assertFalse(stable["source_checkout_required"])
        self.assertEqual(
            stable["normal_update_transport"],
            "official-signed-release-channel",
        )
        self.assertEqual(
            stable["normal_update_owner"],
            "bootstrap/release-acquisition",
        )
        self.assertTrue(stable["signed_envelope_required"])
        self.assertTrue(stable["artifact_hash_and_size_required"])
        self.assertTrue(stable["known_good_preservation_required"])
        self.assertTrue(stable["base_ab_health_rollback_required"])
        self.assertFalse(stable["git_branch_pr_details_in_normal_ux"])
        self.assertTrue(stable["creator_is_primary_media_path"])
        self.assertFalse(stable["production_release_published"])
        self.assertTrue(stable["runtime_profile_selection_implemented"])
        self.assertEqual(stable["runtime_source_identity"], "verified-release-sha")
        self.assertFalse(stable["git_update_polling_enabled"])
        self.assertFalse(stable["development_git_rescue_enabled"])
        self.assertFalse(stable["development_base_channel_enabled"])
        self.assertTrue(stable["shared_surface_health_supervision_enabled"])
        self.assertTrue(stable["continuous_signed_runtime_update_connected"])
        self.assertFalse(stable["base_update_owner_active"])
        self.assertEqual(
            stable["base_update_owner_activation_gate"],
            "stable-base-signed-update-integration",
        )
        self.assertEqual(
            stable["signed_release_discovery_primitive"],
            "ordax-release-agent inspect",
        )
        self.assertTrue(stable["signed_release_discovery_implemented"])
        self.assertFalse(stable["signed_release_discovery_downloads_artifact"])
        self.assertFalse(stable["signed_release_discovery_changes_current"])
        self.assertTrue(stable["signed_release_discovery_requires_trust"])
        self.assertTrue(stable["signed_release_discovery_source_implemented"])
        self.assertFalse(stable["signed_release_discovery_physical_agent_ready"])
        self.assertTrue(stable["signed_release_discovery_asset_published"])
        self.assertEqual(
            stable["signed_release_discovery_asset_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertTrue(stable["signed_release_seed_media_includes_inspect"])
        self.assertEqual(
            stable["signed_release_discovery_physical_agent_target_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertEqual(
            stable["signed_release_seed_media_agent_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertEqual(
            stable["portable_v3_release_agent_seed_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertEqual(
            stable["portable_v3_release_agent_target_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertEqual(
            stable["portable_v3_release_agent_previous_seed_sha256"],
            "ece358c676d6248798bc53f4f5ac52a4e6bc06cda3111b7978acbc917059bf4c",
        )
        self.assertTrue(
            stable["portable_v3_existing_previous_seed_requires_hash_addressed_refresh"]
        )
        self.assertTrue(stable["portable_v3_new_media_includes_capable_agent"])
        self.assertTrue(
            stable["portable_v3_release_agent_supports_content_addressed_runtime"]
        )
        self.assertTrue(stable["portable_v3_release_agent_activation_connected"])
        self.assertEqual(
            stable["portable_v3_activation_primitive"],
            "ordax-portable-state",
        )
        self.assertEqual(
            stable["portable_v3_activation_state_root"],
            "/state/ordax/portable-release",
        )
        self.assertFalse(stable["portable_v3_activation_physical_proven"])
        self.assertTrue(stable["portable_v2_update_activation_connected"])
        self.assertEqual(
            stable["portable_v2_update_activation_mode"],
            "signed-v3-one-shot-reboot-cold-health",
        )
        self.assertTrue(stable["portable_v2_update_requires_reboot"])
        self.assertTrue(stable["portable_v2_candidate_rejected_sha_persisted"])
        self.assertFalse(stable["portable_v2_candidate_rearm_same_sha_allowed"])
        self.assertTrue(stable["periodic_signed_channel_polling_connected"])
        self.assertEqual(stable["periodic_signed_channel_default_seconds"], 60)
        self.assertTrue(stable["signed_release_materialization_connected"])
        self.assertTrue(stable["signed_release_materialization_exact_commit_required"])
        self.assertFalse(stable["signed_release_staging_changes_current"])
        self.assertFalse(stable["signed_release_staging_activation_performed"])
        self.assertTrue(stable["signed_release_activation_connected"])

    def test_stable_profile_reuses_existing_release_authorities(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertEqual(
            stable["release_channel_contract"],
            "docs/contracts/release-channel.json",
        )
        self.assertEqual(
            stable["release_protocol_contract"],
            "docs/contracts/release-protocol.json",
        )
        self.assertEqual(
            stable["trust_policy_contract"],
            "docs/contracts/release-trust-policy.json",
        )
        self.assertEqual(
            stable["base_update_contract"],
            "docs/contracts/base-update.json",
        )
        self.assertFalse(RELEASE_CHANNEL["device_pre_release"]["full_git_client_required"])
        self.assertFalse(RELEASE_CHANNEL["device_pre_release"]["source_checkout_required"])
        polling = RELEASE_CHANNEL["runtime_polling"]
        self.assertEqual(polling["profile"], "stable-mvp")
        self.assertEqual(polling["owner"], "system/supervisor")
        self.assertEqual(polling["default_interval_seconds"], 60)
        self.assertEqual(polling["discovery_command"], "ordax-release-agent inspect")
        self.assertEqual(polling["materialization_command"], "ordax-release-agent materialize")
        self.assertTrue(polling["exact_expected_commit_required"])
        self.assertFalse(polling["current_pointer_changed"])
        self.assertFalse(polling["activation_performed"])
        self.assertFalse(polling["reboot_requested"])
        self.assertFalse(polling["git_required"])

    def test_public_site_is_stable_only(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertEqual(stable["public_site_contract"], "docs/contracts/public-site.json")
        distribution = PUBLIC_SITE["product_distribution"]
        self.assertEqual(distribution["public_profile"], "stable-mvp")
        self.assertFalse(distribution["owner_development_profile_public"])
        self.assertFalse(distribution["public_runtime_depends_on_git"])
        self.assertTrue(distribution["public_updates_use_official_channels"])

    def test_stable_candidate_health_is_complete_before_activation(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertTrue(stable["staged_release_health_connected"])
        self.assertEqual(stable["staged_release_health_owner"], "system/supervisor")
        self.assertTrue(stable["staged_release_health_runs_surface_entrypoint_only"])
        self.assertTrue(stable["staged_release_health_requires_candidate_sha_match"])
        self.assertTrue(stable["staged_release_health_requires_process_survival"])
        self.assertTrue(stable["staged_release_health_requires_heartbeat"])
        self.assertTrue(stable["staged_release_health_requires_known_good_restore"])
        self.assertTrue(stable["staged_release_health_rejects_failed_sha"])
        self.assertFalse(stable["staged_release_health_retests_same_failed_sha"])
        self.assertEqual(
            stable["staged_release_health_candidate_state_source_sha"],
            "candidate-sha",
        )
        self.assertEqual(
            stable["staged_release_health_restore_state_source_sha"],
            "known-good-sha",
        )
        self.assertTrue(
            stable["staged_release_health_ready_written_only_after_known_good_restore"]
        )
        self.assertFalse(stable["staged_release_health_current_pointer_changed"])
        self.assertFalse(stable["staged_release_health_candidate_system_entrypoint_invoked"])
        self.assertTrue(stable["staged_release_health_surface_entrypoint_invoked"])
        self.assertFalse(stable["staged_release_health_activation_performed"])

    def test_exact_activation_primitive_is_offline_and_supervisor_connected(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertEqual(
            stable["exact_release_activation_primitive"],
            "ordax-release-agent activate-exact",
        )
        self.assertTrue(stable["exact_release_activation_primitive_implemented"])
        self.assertFalse(stable["exact_release_activation_network_required"])
        self.assertTrue(stable["exact_release_activation_revalidates_stored_signature"])
        self.assertTrue(stable["exact_release_activation_revalidates_materialized_tree"])
        self.assertTrue(stable["exact_release_activation_preserves_previous_commit_in_receipt"])
        self.assertTrue(stable["exact_release_activation_atomic_current_swap"])
        self.assertTrue(stable["exact_release_activation_supervisor_connected"])
        self.assertEqual(
            stable["exact_release_activation_physical_agent_target_sha256"],
            "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740",
        )
        self.assertTrue(stable["exact_release_activation_seed_media_includes_primitive"])
        self.assertTrue(stable["exact_release_activation_asset_published"])
        self.assertEqual(
            stable["exact_release_activation_previous_agent_sha256"],
            "ece358c676d6248798bc53f4f5ac52a4e6bc06cda3111b7978acbc917059bf4c",
        )
        self.assertTrue(stable["signed_release_activation_connected"])

    def test_activation_transaction_is_complete_and_next_gate_is_stable_base(self):
        stable = CONTRACT["profiles"]["stable-mvp"]
        self.assertTrue(stable["activation_requires_staged_sha_equals_health_ready_sha"])
        self.assertEqual(
            stable["activation_guard_state"],
            "/state/ordax/stable-release-activation-guard",
        )
        self.assertTrue(stable["activation_guard_persisted_before_current_swap"])
        self.assertTrue(stable["activation_guard_survives_process_crash"])
        self.assertTrue(stable["activated_release_requires_cold_health"])
        self.assertTrue(stable["activated_release_cold_health_requires_exact_sha"])
        self.assertTrue(stable["activated_release_failure_rolls_back_exact_previous_commit"])
        self.assertTrue(stable["rollback_revalidates_previous_signed_release"])
        self.assertTrue(stable["activation_and_rollback_require_no_git"])
        self.assertTrue(stable["activation_and_rollback_require_no_network"])
        self.assertTrue(stable["guardian_rebinds_source_identity_from_current"])
        self.assertTrue(stable["guardian_refresh_required_after_current_swap"])
        self.assertTrue(stable["runtime_update_known_good_preserved"])
        gate = CONTRACT["next_gate"]
        self.assertEqual(gate["id"], "stable-base-signed-update-integration")
        self.assertFalse(gate["implemented"])
        self.assertIn("kernel/initramfs/rootfs", gate["description"])
        self.assertTrue(CONTRACT["invariants"]["same_main_source_authority"])
        self.assertTrue(CONTRACT["invariants"]["stable_must_not_require_git_client"])
        self.assertTrue(CONTRACT["invariants"]["stable_must_not_require_source_checkout"])


if __name__ == "__main__":
    unittest.main()
