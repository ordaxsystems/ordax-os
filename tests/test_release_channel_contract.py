#!/usr/bin/env python3
"""Regression tests for Git-driven, binary release delivery."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/release-channel.json").read_text(encoding="utf-8")
)


class ReleaseChannelContractTest(unittest.TestCase):
    def test_git_main_remains_source_authority(self):
        source = CONTRACT["source_authority"]
        self.assertEqual(source["kind"], "git")
        self.assertEqual(source["repository"], "ordaxsystems/ordax-os")
        self.assertEqual(source["branch"], "main")

    def test_bootstrap_does_not_need_git_checkout_or_compiler(self):
        device = CONTRACT["device_pre_release"]
        self.assertFalse(device["full_git_client_required"])
        self.assertFalse(device["source_checkout_required"])
        self.assertFalse(device["compiler_required"])
        self.assertFalse(device["codex_required"])
        self.assertTrue(device["https_release_resolver_required"])
        self.assertTrue(device["public_trust_anchor_required"])

    def test_release_is_commit_bound_and_fail_closed(self):
        release = CONTRACT["release"]
        self.assertTrue(release["exact_source_commit_required"])
        self.assertTrue(release["immutable_after_verification"])
        self.assertTrue(release["artifact_sha256_required"])
        self.assertTrue(release["manifest_authenticity_required_before_production"])
        self.assertFalse(release["custom_crypto_allowed"])
        self.assertTrue(release["atomic_activation_required"])
        self.assertTrue(release["known_good_preservation_required"])
        self.assertTrue(release["offline_known_good_boot_required"])

    def test_stable_runtime_health_gate_never_activates_current(self):
        health = CONTRACT["runtime_health_gate"]
        self.assertEqual(health["profile"], "stable-mvp")
        self.assertEqual(health["owner"], "system/supervisor")
        self.assertEqual(
            health["candidate_source"],
            "/ordax/releases/<source_commit>/system",
        )
        self.assertEqual(health["candidate_entrypoint"], "surface/entrypoint")
        self.assertFalse(health["system_entrypoint_invoked"])
        self.assertTrue(health["source_sha_must_match_candidate"])
        self.assertTrue(health["process_survival_required"])
        self.assertTrue(health["surface_health_required"])
        self.assertTrue(health["known_good_surface_restored_after_probe"])
        self.assertTrue(health["known_good_health_required_after_restore"])
        self.assertEqual(
            health["candidate_update_state_source_sha"],
            "candidate-source-commit",
        )
        self.assertEqual(
            health["known_good_restore_update_state_source_sha"],
            "current-source-commit",
        )
        self.assertTrue(health["health_ready_written_only_after_known_good_restore"])
        self.assertFalse(health["repeat_failed_candidate"])
        self.assertFalse(health["current_pointer_changed"])
        self.assertFalse(health["activation_performed"])
        self.assertFalse(health["reboot_requested"])

    def test_exact_activation_primitive_is_supervisor_wired_after_health_ready(self):
        activation = CONTRACT["runtime_activation_primitive"]
        self.assertEqual(activation["profile"], "stable-mvp")
        self.assertEqual(activation["owner"], "bootstrap/release-acquisition")
        self.assertEqual(
            activation["command"],
            "ordax-release-agent activate-exact",
        )
        self.assertTrue(activation["exact_expected_commit_required"])
        self.assertFalse(activation["network_required"])
        self.assertFalse(activation["latest_pointer_re_resolved"])
        self.assertTrue(activation["materialized_release_reverified"])
        self.assertTrue(activation["previous_current_commit_reported"])
        self.assertTrue(activation["atomic_current_pointer_replace"])
        self.assertTrue(activation["supervisor_health_ready_gate_connected"])
        self.assertTrue(activation["cold_health_rollback_connected"])
        self.assertFalse(activation["reboot_requested"])

        transaction = CONTRACT["runtime_activation_transaction"]
        self.assertEqual(transaction["profile"], "stable-mvp")
        self.assertEqual(transaction["owner"], "system/supervisor")
        self.assertEqual(
            transaction["staged_state"],
            "/state/ordax/staged-release-sha",
        )
        self.assertEqual(
            transaction["health_ready_state"],
            "/state/ordax/stable-release-health-ready-sha",
        )
        self.assertEqual(
            transaction["activation_guard_state"],
            "/state/ordax/stable-release-activation-guard",
        )
        self.assertTrue(transaction["staged_and_health_ready_sha_must_match"])
        self.assertTrue(transaction["guard_persisted_before_current_swap"])
        self.assertEqual(
            transaction["activation_command"],
            "ordax-release-agent activate-exact",
        )
        self.assertFalse(transaction["activation_network_required"])
        self.assertFalse(transaction["activation_git_required"])
        self.assertTrue(transaction["guardian_refresh_after_swap"])
        self.assertTrue(transaction["cold_health_required"])
        self.assertTrue(transaction["cold_health_source_sha_must_match_activated_release"])
        self.assertEqual(
            transaction["rollback_target"],
            "exact-previous-commit-from-transaction",
        )
        self.assertTrue(transaction["rollback_revalidates_signed_release"])
        self.assertFalse(transaction["rollback_network_required"])
        self.assertFalse(transaction["rollback_git_required"])
        self.assertTrue(transaction["failed_release_rejected"])
        self.assertTrue(transaction["known_good_preserved"])
        self.assertFalse(transaction["reboot_requested"])

    def test_portable_runtime_activation_is_signed_one_shot_and_offline_rollback(self):
        activation = CONTRACT["portable_runtime_activation"]
        self.assertEqual(activation["profile"], "stable-mvp")
        self.assertEqual(activation["runtime_layout"], "portable-v2")
        self.assertEqual(activation["discovery_command"], "ordax-release-agent inspect")
        self.assertEqual(
            activation["manifest_schema"],
            "prototype-ordax.release-manifest/4",
        )
        self.assertEqual(
            activation["materialization_command"],
            "ordax-release-agent materialize-portable-v4",
        )
        self.assertEqual(
            activation["exact_verification_command"],
            "ordax-release-agent verify-portable-v4-exact",
        )
        self.assertTrue(activation["local_ai_runtime_required"])
        self.assertTrue(activation["inspect_manifest_schema_drives_materializer"])
        self.assertTrue(activation["pre_v4_current_may_accept_v3"])
        self.assertTrue(activation["pre_v4_current_may_upgrade_to_v4"])
        self.assertFalse(activation["v4_to_v3_downgrade_allowed"])
        self.assertEqual(
            activation["v3_compatibility_materialization_command"],
            "ordax-release-agent materialize-portable-v3",
        )
        self.assertEqual(
            activation["v3_compatibility_exact_verification_command"],
            "ordax-release-agent verify-portable-v3-exact",
        )
        self.assertEqual(activation["activation_state_helper"], "ordax-portable-state")
        self.assertEqual(
            activation["activation_state_root"],
            "/state/ordax/portable-release",
        )
        self.assertEqual(activation["portable_root"], "/ordax-data/.ordax")
        self.assertEqual(activation["candidate_policy"], "armed-one-shot-boot")
        self.assertTrue(activation["candidate_reboot_required"])
        self.assertTrue(activation["candidate_cold_health_required"])
        self.assertTrue(activation["commit_after_cold_health"])
        self.assertTrue(activation["failed_candidate_persisted"])
        self.assertFalse(activation["same_failed_candidate_retried"])
        self.assertFalse(activation["rollback_network_required"])
        self.assertFalse(activation["rollback_git_required"])
        self.assertFalse(activation["physical_boot_proven"])

    def test_kernel_is_compiled_in_repository_ci_not_on_device(self):
        kernel = CONTRACT["kernel"]
        self.assertFalse(kernel["compiled_on_device"])
        self.assertTrue(kernel["compiled_in_repository_ci"])
        self.assertTrue(kernel["delivered_as_verified_artifact"])

    def test_codex_is_not_publication_dependency(self):
        publication = CONTRACT["publication"]
        self.assertTrue(publication["ci_owned"])
        self.assertFalse(publication["codex_required"])


if __name__ == "__main__":
    unittest.main()
