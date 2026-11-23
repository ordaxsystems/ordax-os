#!/usr/bin/env python3
"""Regression boundary for the durable Stable/MVP portable bootstrap."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/portable-bootstrap-v2.json").read_text(encoding="utf-8")
)
TRANSITIONAL = json.loads(
    (ROOT / "docs/contracts/minimal-bootstrap.json").read_text(encoding="utf-8")
)


class PortableBootstrapV2ContractTests(unittest.TestCase):
    def test_mvp_first_boot_is_offline_capable_with_preseeded_verified_release(self):
        first = CONTRACT["first_boot"]
        self.assertFalse(first["network_required"])
        self.assertTrue(first["offline_capable_required"])
        self.assertTrue(first["creator_must_preseed_verified_release"])
        self.assertEqual(first["release_schema"], "prototype-ordax.release-manifest/3")
        self.assertEqual(
            first["compatible_release_schemas"],
            [
                "prototype-ordax.release-manifest/2",
                "prototype-ordax.release-manifest/3",
            ],
        )
        self.assertEqual(
            first["release_artifacts"],
            ["system.erofs", "native-surface-runtime.erofs"],
        )
        self.assertTrue(first["surface_runtime_content_addressed"])
        self.assertEqual(
            first["surface_runtime_ephemeral_overlay"],
            "/run/ordax/runtime/native-surface/rootfs",
        )
        self.assertFalse(first["stable_boot_package_download_allowed"])
        self.assertFalse(first["stable_boot_package_install_allowed"])
        self.assertTrue(first["initial_current_equals_known_good"])
        self.assertTrue(first["initial_candidate_absent"])
        self.assertTrue(first["initial_transaction_absent"])
        self.assertTrue(first["initial_rejected_absent"])
        self.assertEqual(
            first["update_activation_mode"],
            "signed-one-shot-next-reboot-cold-health",
        )
        self.assertFalse(first["physical_update_activation_proven"])
        self.assertTrue(first["boot_must_reverify_exact_release_offline"])
        self.assertTrue(first["fallback_must_not_require_network"])

    def test_esp_remains_bootstrap_only(self):
        esp = CONTRACT["esp_substrate"]
        self.assertFalse(esp["system_or_apps_preinstalled"])
        self.assertFalse(esp["complete_product_release_on_esp"])
        self.assertIn("kernel", esp["allowed_classes"])
        self.assertIn("initramfs", esp["allowed_classes"])
        self.assertIn("surface-runtime", esp["forbidden_classes"])
        self.assertIn("normal-apps", esp["forbidden_classes"])
        capsule = esp["bootstrap_capsule"]
        self.assertEqual(capsule["filesystem"], "erofs")
        self.assertTrue(capsule["read_only"])
        self.assertTrue(capsule["hash_pin_required_before_pid1_use"])
        self.assertTrue(capsule["initramfs_hash_pin_implemented"])
        self.assertTrue(capsule["initramfs_hash_pin_candidate_only"])
        self.assertFalse(capsule["initramfs_hash_pin_default_candidate_build_enabled"])
        self.assertTrue(capsule["pid1_hash_enforcement_implemented"])
        self.assertTrue(capsule["pid1_verified_mount_implemented"])
        self.assertTrue(capsule["implemented"])
        self.assertTrue(capsule["hash_verification_helper_pid1_connected"])

    def test_release_trust_is_bootstrap_owned_and_private_key_never_on_media(self):
        trust = CONTRACT["release_trust"]
        self.assertTrue(trust["canonical_public_anchor_required"])
        self.assertFalse(trust["canonical_public_anchor_currently_pinned"])
        self.assertFalse(trust["publisher_private_key_on_media"])
        self.assertTrue(trust["trust_anchor_must_not_be_selected_from_ordax_data"])
        self.assertTrue(trust["trust_anchor_must_be_bootstrap_owned"])
        self.assertFalse(trust["runtime_tamper_resistance_without_secure_boot_claimed"])

    def test_creator_remains_usb_only_and_physical_apply_stays_blocked(self):
        creator = CONTRACT["creator"]
        self.assertTrue(creator["same_creator_core_required"])
        self.assertEqual(creator["portable_storage_planner"], "PlanPortableTargetStorage")
        self.assertTrue(creator["preseed_release_before_success"])
        self.assertTrue(creator["preseed_persistent_state_before_success"])
        self.assertTrue(creator["post_write_readback_required"])
        self.assertFalse(creator["internal_disk_write_allowed"])
        self.assertFalse(creator["native_install_exposed"])
        self.assertFalse(creator["physical_apply_enabled"])
        self.assertFalse(CONTRACT["physical_write_authorized"])
        self.assertFalse(CONTRACT["physical_boot_proven"])

    def test_initramfs_helpers_are_connected_to_candidate_pid1_without_extra_authority(self):
        helpers = CONTRACT["initramfs_helpers"]
        state = helpers["portable_state_reader"]
        mount = helpers["portable_mount_helper"]
        self.assertTrue(state["installed"])
        self.assertFalse(state["read_only"])
        self.assertTrue(state["pid1_connected"])
        self.assertEqual(
            state["operations"],
            ["read-slot", "resolve", "select", "prepare", "select-boot", "commit", "rollback"],
        )
        self.assertEqual(
            state["selection_order"],
            ["candidate-one-shot", "current", "known-good"],
        )
        self.assertTrue(state["candidate_is_boot_authority"])
        self.assertEqual(
            state["candidate_boot_authority_policy"],
            "armed-one-shot-transaction-only",
        )
        self.assertTrue(state["writes_activation_state"])
        self.assertTrue(state["atomic_replace"])
        self.assertTrue(state["fsync_required"])
        self.assertTrue(state["directory_fsync_required"])
        self.assertEqual(
            state["runtime_copy_path"],
            "/run/ordax/bootstrap-tools/ordax-portable-state",
        )
        self.assertEqual(state["rejected_slot"], "rejected")
        self.assertTrue(mount["installed"])
        self.assertTrue(mount["mounts_state_ext4"])
        self.assertTrue(mount["mounts_release_erofs_read_only"])
        self.assertTrue(mount["composes_stable_base_overlayfs"])
        self.assertEqual(mount["system_runtime_view"], "read-only-bind")
        self.assertFalse(mount["system_persistent_overlay"])
        self.assertFalse(mount["selects_release"])
        self.assertFalse(mount["verifies_signature"])
        self.assertFalse(mount["writes_activation_state"])
        self.assertTrue(mount["pid1_connected"])
        self.assertTrue(mount["mounts_surface_runtime_erofs_read_only"])
        self.assertEqual(mount["surface_runtime_view"], "overlayfs-ephemeral-run")
        self.assertFalse(mount["surface_runtime_persistent_upper"])

    def test_candidate_pid1_uses_one_shot_transaction_without_physical_claim(self):
        pid1 = CONTRACT["initramfs_helpers"]["portable_candidate_pid1"]
        self.assertFalse(pid1["current_then_known_good"])
        self.assertEqual(
            pid1["release_selection"],
            ["candidate-one-shot", "current", "known-good"],
        )
        self.assertTrue(pid1["candidate_boot_authority"])
        self.assertEqual(
            pid1["candidate_boot_authority_policy"],
            "armed-one-shot-transaction-only",
        )
        self.assertTrue(pid1["failed_candidate_rolls_back_before_handoff"])
        self.assertTrue(pid1["activation_helper_retained_after_switch_root"])
        self.assertFalse(pid1["physical_boot_authorized"])

    def test_boot_sequence_mounts_stable_base_before_immutable_system(self):
        sequence = CONTRACT["boot_sequence_target"]
        base = sequence.index(
            "mount-stable-base-erofs-read-only-and-compose-base-overlay-with-ext4-upper-work"
        )
        system = sequence.index("mount-selected-system-erofs-read-only")
        runtime = sequence.index(
            "mount-selected-surface-runtime-erofs-read-only-and-compose-ephemeral-overlay"
        )
        bind = sequence.index("bind-verified-system-subtree-read-only")
        switch_root = sequence.index("switch-root-into-stable-base-overlay")
        launch = sequence.index(
            "launch-ordax-stable-init-with-verified-portable-release-and-surface-runtime-identity"
        )
        self.assertLess(base, system)
        self.assertLess(system, runtime)
        self.assertLess(runtime, bind)
        self.assertLess(bind, switch_root)
        self.assertLess(switch_root, launch)
        self.assertNotIn("compose-system-overlay-with-ext4-upper-work", sequence)

    def test_transitional_contract_is_not_silently_reinterpreted(self):
        migration = CONTRACT["migration"]
        self.assertTrue(migration["transitional_minimal_bootstrap_contract_unchanged"])
        self.assertTrue(migration["transitional_three_partition_writer_unchanged"])
        self.assertFalse(migration["portable_v2_writer_migration_implemented"])
        self.assertTrue(migration["portable_v2_pid1_integration_implemented"])
        self.assertFalse(migration["public_physical_promotion_allowed"])
        self.assertEqual(TRANSITIONAL["policy"], "minimum-release-acquisition-first")
        self.assertTrue(TRANSITIONAL["boot_policy"]["first_release_requires_network"])


if __name__ == "__main__":
    unittest.main()
