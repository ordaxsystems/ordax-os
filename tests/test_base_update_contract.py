#!/usr/bin/env python3
"""Contract regressions for transactional OrdaX base updates."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs" / "contracts" / "base-update.json").read_text(encoding="utf-8")
)


class BaseUpdateContractTests(unittest.TestCase):
    def test_base_update_is_separate_from_daily_git_hot_update(self):
        self.assertEqual(CONTRACT["$schema"], "prototype-ordax.base-update/1")
        self.assertFalse(CONTRACT["normal_git_hot_update_owns_this"])
        self.assertTrue(CONTRACT["requires_reboot_to_activate"])
        self.assertEqual(CONTRACT["esp"]["filesystem_label"], "ORDAX-ESP")

    def test_candidate_can_only_touch_inactive_slot(self):
        slots = CONTRACT["slots"]
        self.assertEqual(slots["names"], ["a", "b"])
        self.assertTrue(slots["active_slot_must_not_be_modified_during_stage"])
        self.assertTrue(slots["inactive_slot_only_for_candidate"])
        self.assertIn("{slot}", slots["paths"]["kernel"])
        self.assertIn("{slot}", slots["paths"]["initramfs"])

    def test_legacy_transition_preserves_real_current_boot_until_health(self):
        legacy = CONTRACT["legacy_transition"]
        self.assertEqual(legacy["initial_layout"], "single-slot-legacy")
        self.assertEqual(legacy["legacy_kernel"], "/ordax/vmlinuz")
        self.assertEqual(legacy["legacy_initramfs"], "/ordax/initrd.gz")
        self.assertEqual(legacy["previous_slot"], "a")
        self.assertEqual(legacy["candidate_slot"], "b")
        self.assertTrue(
            legacy["preserve_legacy_bytes_to_previous_slot_before_candidate"]
        )
        self.assertTrue(legacy["baseline_copy_requires_exact_hash_identity"])
        self.assertTrue(
            legacy["conflicting_or_unsafe_baseline_fails_closed"]
        )
        self.assertTrue(
            legacy["candidate_marker_blocks_before_baseline_mutation"]
        )
        self.assertTrue(
            legacy["legacy_current_and_recovery_remain_unchanged_before_health"]
        )
        self.assertTrue(
            legacy["legacy_kernel_and_initramfs_remain_unchanged_before_health"]
        )
        self.assertEqual(
            legacy["failed_candidate_fallback"],
            "unchanged-legacy-current-entry",
        )
        self.assertEqual(
            legacy["successful_promotion"]["current_slot"],
            "b",
        )
        self.assertEqual(
            legacy["successful_promotion"]["recovery_slot"],
            "a",
        )

    def test_activation_is_one_shot_and_keeps_known_good_default(self):
        activation = CONTRACT["activation"]
        self.assertEqual(activation["selector"], "LoaderEntryOneShot")
        self.assertEqual(activation["entry_id"], "ordax-candidate.conf")
        self.assertEqual(activation["bootloader"], "systemd-boot")
        self.assertTrue(activation["boot_counting_required"])
        self.assertEqual(activation["candidate_tries_left"], 1)
        self.assertTrue(activation["default_entry_unchanged_before_health"])
        self.assertEqual(activation["automatic_fallback"], "existing-current-entry")

    def test_disposable_activation_proof_is_non_physical_and_owner_disabled(self):
        activation = CONTRACT["activation"]
        self.assertEqual(
            activation["disposable_proof"],
            "bootstrap/base-update/prove_oneshot_activation.sh",
        )
        self.assertEqual(
            activation["disposable_proof_schema"],
            "prototype-ordax.base-update-oneshot-activation-proof/1",
        )
        self.assertTrue(activation["disposable_efivarfs_only"])
        self.assertTrue(activation["esp_must_be_read_only_during_arm"])
        self.assertTrue(activation["esp_byte_identity_must_remain_unchanged"])
        self.assertTrue(
            activation["only_loader_entry_oneshot_variable_may_be_written"]
        )
        self.assertFalse(activation["real_efivarfs_proven"])
        self.assertFalse(activation["physical_notebook_proven"])
        self.assertFalse(activation["runtime_owner_activation_wiring_enabled"])

    def test_promotion_requires_base_and_surface_health(self):
        health = CONTRACT["health"]
        for key in (
            "candidate_cmdline_identity_required",
            "base_heartbeat_required",
            "surface_health_required",
            "same_release_sha_required",
            "promotion_only_after_all_checks",
            "boot_id_must_match_across_base_and_surface",
        ):
            self.assertTrue(health[key], key)
        self.assertEqual(
            health["local_evidence"],
            {
                "base_heartbeat": "/state/ordax/base-update/base-heartbeat.json",
                "surface_health": "/run/ordax-update/healthy-sha",
                "surface_heartbeat": "/run/ordax-update/surface-heartbeat.json",
                "boot_id": "/run/ordax-update/base-boot-id",
                "cmdline": "/proc/cmdline",
            },
        )

    def test_promotion_writes_recovery_before_current_commit_point(self):
        promotion = CONTRACT["promotion"]
        self.assertTrue(promotion["current_entry_written_after_recovery_entry"])
        self.assertTrue(promotion["current_entry_is_promotion_commit_point"])
        self.assertTrue(promotion["atomic_replace_required"])
        self.assertTrue(promotion["previous_slot_preserved"])

    def test_development_postboot_promotion_is_health_gated_and_non_rebooting(self):
        promotion = CONTRACT["promotion"]
        self.assertEqual(
            promotion["development_postboot_helper"],
            "system/services/base-update/dev_postboot_promote.py",
        )
        self.assertEqual(
            promotion["development_postboot_schema"],
            "prototype-ordax.dev-base-postboot-promotion/1",
        )
        for key in (
            "runtime_owner_postboot_wiring_enabled",
            "candidate_boot_cmdline_required",
            "matching_staged_sha_required",
            "matching_activation_readiness_sha_required",
            "base_heartbeat_same_boot_required",
            "surface_health_same_release_required",
            "surface_heartbeat_same_boot_required",
            "live_esp_readonly_preflight_before_rw",
            "live_candidate_entry_required",
            "live_candidate_slot_required",
            "rw_mount_only_after_health_passes",
            "previous_slot_derived_from_known_good_layout",
            "legacy_previous_slot_is_a",
            "postflight_readonly_validation_required",
            "normal_boot_is_noop",
        ):
            self.assertTrue(promotion[key], key)
        self.assertFalse(promotion["promotion_failure_blocks_surface"])
        self.assertFalse(promotion["promotion_failure_changes_current_boot"])
        self.assertFalse(promotion["reboot_requested_by_promotion_owner"])
        self.assertFalse(promotion["efi_variable_written_by_promotion_owner"])
        self.assertFalse(promotion["physical_notebook_postboot_promotion_proven"])
        self.assertEqual(
            promotion["promoted_sha_state_file"],
            "/state/ordax/base-update/dev-base-promoted-sha",
        )
        self.assertEqual(
            promotion["promotion_result_state_file"],
            "/state/ordax/base-update/dev-base-promotion-result.json",
        )
        self.assertEqual(
            promotion["disposable_development_postboot_proof"],
            "bootstrap/base-update/prove_dev_postboot_promotion.sh",
        )

    def test_failure_never_overwrites_current_kernel_in_place(self):
        failure = CONTRACT["failure"]
        self.assertTrue(failure["current_entry_remains_unchanged"])
        self.assertTrue(failure["previous_slot_remains_bootable"])
        self.assertTrue(failure["candidate_never_promoted_without_health"])
        self.assertTrue(failure["no_whole_esp_rewrite"])
        self.assertTrue(failure["no_kernel_in_place_overwrite"])
        self.assertTrue(failure["no_remote_shell_required"])

    def test_staging_reuses_canonical_signed_release_trust(self):
        staging = CONTRACT["staging"]
        self.assertTrue(staging["signed_manifest_required"])
        self.assertTrue(staging["signed_system_artifact_required"])
        self.assertFalse(staging["unsigned_candidate_cli_allowed"])
        self.assertEqual(
            staging["release_envelope_schema"],
            "prototype-ordax.release-envelope/1",
        )
        self.assertEqual(
            staging["release_manifest_schema"],
            "prototype-ordax.release-manifest/1",
        )
        self.assertEqual(
            staging["canonical_trust_path"],
            "/ordax/bootstrap/trust/release-ed25519.json",
        )
        self.assertEqual(
            staging["signed_candidate_descriptor"],
            "system/base-update/candidate.json",
        )
        self.assertIn(" verify-envelope", staging["verifier"])
        self.assertNotIn("verify-base-update-envelope", staging["verifier"])

    def test_signed_release_is_materialized_without_current_activation_before_staging(self):
        staging = CONTRACT["staging"]
        self.assertEqual(
            staging["materializer"],
            "/ordax/bootstrap/release-acquisition/ordax-release-agent materialize",
        )
        self.assertTrue(staging["materialize_expected_commit_required"])
        self.assertTrue(staging["materialize_only_when_boot_refresh_pending"])
        self.assertTrue(staging["materialization_must_not_change_current_pointer"])
        self.assertTrue(staging["materialization_precedes_esp_stage"])

    def test_staging_uses_only_the_persisted_verified_release_envelope(self):
        staging = CONTRACT["staging"]
        self.assertEqual(
            staging["persisted_verified_envelope"],
            "/ordax/releases/{release_sha}/release-envelope.json",
        )
        self.assertTrue(staging["stager_must_use_persisted_verified_envelope"])
        self.assertFalse(staging["second_envelope_network_fetch_for_stage"])
        self.assertTrue(staging["materialization_precedes_esp_stage"])

    def test_promotion_commit_and_boot_refresh_lifecycle_are_explicit(self):
        promotion = CONTRACT["promotion"]
        self.assertTrue(promotion["candidate_entry_removed_before_current_commit"])
        self.assertTrue(promotion["current_entry_is_promotion_commit_point"])
        self.assertTrue(
            promotion[
                "post_commit_metadata_may_not_reclassify_promotion_as_precommit_failure"
            ]
        )
        self.assertEqual(
            promotion["boot_refresh_marker"],
            "/ordax/state/boot-refresh-required",
        )
        self.assertEqual(
            promotion["boot_refresh_marker_development_alias"],
            "/state/ordax/boot-refresh-required",
        )
        self.assertTrue(
            promotion["boot_refresh_marker_cleared_only_after_healthy_promotion"]
        )
        self.assertTrue(promotion["normal_reboot_must_not_clear_boot_refresh_marker"])
        self.assertTrue(promotion["current_entry_durability_reported"])

    def test_runtime_owner_uses_real_ordax_root_and_development_state_alias(self):
        owner = CONTRACT["runtime_owner"]
        self.assertEqual(owner["development_host_state_root"], "/state/ordax")
        self.assertEqual(owner["graphical_native_state_root"], "/var/lib/ordax")
        self.assertTrue(owner["graphical_native_state_is_not_base_owner_state_root"])
        self.assertEqual(
            owner["physical_root_discovery"],
            "/proc/self/mountinfo root mount",
        )
        self.assertEqual(owner["physical_root_required_filesystem"], "ext4")
        self.assertEqual(owner["physical_root_required_source_prefix"], "/dev/")
        self.assertEqual(owner["physical_root_chroot_mount"], "/mnt/ordax-device")
        self.assertEqual(owner["mount_staging_host"], "/run/ordax-base-owner")
        self.assertEqual(owner["mount_staging_filesystem"], "tmpfs")
        self.assertEqual(owner["mount_staging_size"], "1m")
        self.assertEqual(
            owner["physical_root_host_mount"],
            "/run/ordax-base-owner/physical",
        )
        self.assertTrue(owner["physical_root_bound_into_chroot"])
        self.assertTrue(owner["mount_tree_must_not_recurse_into_ordax_filesystem"])
        self.assertTrue(owner["state_root_derived_from_mountinfo_subpath"])
        self.assertEqual(
            owner["development_state_inside_physical_root"],
            "<seed-root-subpath>/state/ordax",
        )
        self.assertEqual(
            owner["development_version_store_inside_physical_root"],
            "<seed-root-subpath>/versions",
        )
        self.assertIn(
            "versions/<commit>",
            owner["versioned_root_subpath_normalization"],
        )
        self.assertTrue(
            owner["physical_release_agent_may_be_absent_before_pinned_enrollment"]
        )
        self.assertTrue(
            owner["physical_release_channel_may_be_absent_before_pinned_enrollment"]
        )
        self.assertTrue(
            owner["bootstrap_component_sentinels_not_required_before_pinned_enrollment"]
        )
        self.assertNotIn(
            "physical_root_requires_release_agent_and_channel_sentinels",
            owner,
        )
        self.assertNotIn(
            "physical_root_requires_release_channel_sentinel",
            owner,
        )
        self.assertTrue(owner["recursive_state_bind_forbidden"])

    def test_esp_discovery_is_same_disk_bound_and_read_only(self):
        discovery = CONTRACT["runtime_owner"]["esp_discovery"]
        self.assertEqual(discovery["filesystem_label"], "ORDAX-ESP")
        self.assertEqual(
            discovery["label_path"],
            "/dev/disk/by-label/ORDAX-ESP",
        )
        self.assertTrue(discovery["direct_block_partition_required"])
        self.assertTrue(discovery["same_parent_disk_as_root_required"])
        self.assertTrue(discovery["sysfs_identity_required"])
        self.assertFalse(discovery["discovery_mounts_esp"])
        self.assertFalse(discovery["discovery_authorizes_write"])
        self.assertFalse(discovery["discovery_authorizes_activation"])
        self.assertEqual(
            discovery["state_file"],
            "/state/ordax/base-update/esp-discovery.json",
        )
        self.assertTrue(discovery["runtime_preflight_fail_soft"])
        self.assertTrue(discovery["candidate_acquisition_continues_without_esp"])
        self.assertEqual(
            discovery["readonly_layout_inspector"],
            "system/services/base-update/esp_layout.py",
        )
        self.assertEqual(
            discovery["readonly_layout_schema"],
            "prototype-ordax.esp-layout/1",
        )
        self.assertTrue(discovery["readonly_inspection_required_before_stage"])
        self.assertEqual(discovery["supported_layouts"], ["legacy", "ab"])
        self.assertTrue(discovery["candidate_presence_reported"])
        self.assertFalse(discovery["inspection_authorizes_write"])
        self.assertFalse(discovery["inspection_authorizes_activation"])
        self.assertEqual(
            discovery["readonly_preflight_helper"],
            "system/services/base-update/esp_readonly.py",
        )
        self.assertEqual(
            discovery["readonly_preflight_schema"],
            "prototype-ordax.esp-readonly-preflight/1",
        )
        self.assertEqual(discovery["readonly_mount_filesystem"], "vfat")
        self.assertEqual(
            discovery["readonly_mount_options"],
            ["ro", "nosuid", "nodev", "noexec"],
        )
        self.assertTrue(discovery["identity_revalidated_after_mount"])
        self.assertTrue(discovery["unmount_required_before_return"])
        self.assertEqual(
            discovery["disposable_same_disk_proof"],
            "bootstrap/base-update/prove_esp_readonly_preflight.sh",
        )
        self.assertFalse(discovery["physical_hardware_proven_by_disposable_proof"])
        self.assertEqual(
            discovery["readonly_preflight_state_file"],
            "/state/ordax/base-update/esp-readonly-preflight.json",
        )
        self.assertEqual(
            discovery["readonly_preflight_sha_file"],
            "/state/ordax/base-update/esp-readonly-preflight-sha",
        )
        self.assertTrue(
            discovery[
                "runtime_runs_readonly_preflight_only_for_ready_development_candidate"
            ]
        )
        self.assertTrue(discovery["readonly_preflight_cached_per_candidate_sha"])
        self.assertFalse(discovery["cached_readonly_preflight_authorizes_write"])
        self.assertTrue(discovery["physical_stage_requires_fresh_preflight_revalidation"])
        self.assertFalse(discovery["readonly_preflight_failure_blocks_surface"])
        self.assertFalse(
            discovery["readonly_preflight_failure_blocks_candidate_acquisition"]
        )

    def test_release_channel_enrollment_is_pinned_and_non_destructive(self):
        channel = CONTRACT["release_channel_enrollment"]
        self.assertEqual(
            channel["source_path"],
            "bootstrap/config/release-envelope-url",
        )
        self.assertEqual(
            channel["target"],
            "/ordax/bootstrap/config/release-envelope-url",
        )
        self.assertEqual(channel["authority"], "minimal-bootstrap-sha256")
        self.assertEqual(
            channel["expected_sha256"],
            "a5d34ab75cdef9e8826ccef29baf746f1cbb43f1cac1dc94568e47671d335849",
        )
        self.assertEqual(channel["mode"], "0644")
        self.assertTrue(channel["absent_channel_enrollment"])
        self.assertEqual(channel["existing_divergent_channel"], "block")
        self.assertTrue(channel["occurs_after_release_agent_refresh"])
        self.assertTrue(channel["occurs_before_canonical_trust_enrollment"])
        self.assertFalse(channel["physical_media_rewrite_required"])
        self.assertFalse(channel["raw_device_write_allowed"])

    def test_candidate_entry_uses_fixed_width_single_try_counter(self):
        entry = CONTRACT["entries"]["candidate_template"]
        self.assertEqual(entry, "/loader/entries/ordax-candidate+01-00.conf")
        self.assertTrue(
            CONTRACT["entries"]["current_and_recovery_are_never_replaced_before_candidate_health"]
        )

    def test_implementation_requires_disposable_and_physical_proof(self):
        gates = CONTRACT["implementation_gates"]
        for gate in (
            "disposable-fat32-esp-proof",
            "one-shot-selection-proof",
            "failed-candidate-fallback-proof",
            "successful-candidate-promotion-proof",
            "physical-notebook-proof",
        ):
            self.assertIn(gate, gates)


if __name__ == "__main__":
    unittest.main()
