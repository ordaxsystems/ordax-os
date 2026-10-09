#!/usr/bin/env python3
"""Regress the one-way hash-pinned release-agent compatibility migration."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DESCRIPTOR = ROOT / "system/services/base-update/release-agent-refresh.json"
MINIMAL = ROOT / "docs/contracts/minimal-bootstrap.json"
BASE = ROOT / "docs/contracts/base-update.json"
WORKFLOW = ROOT / ".github/workflows/release-agent-refresh.yml"
OWNER = ROOT / "system/services/base-update/orchestrator.py"

CURRENT_REFRESH_TARGET = "e18c4e7eb4b4b73f49e1bf8c1d051e3253789fb6e1b422cebd8db9a74740f2af"
PREVIOUS_REFRESH_TARGET = "a514b8280cecb0b3f70e681eb4ba2167bf599ac2fa336c546cfbe71f46ea9c8e"
CURRENT_SEED = "550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66"


class ReleaseAgentRefreshTests(unittest.TestCase):
    def test_descriptor_is_one_way_hash_addressed_and_non_destructive(self):
        descriptor = json.loads(DESCRIPTOR.read_text(encoding="utf-8"))
        target = descriptor["target_sha256"]
        self.assertEqual(
            descriptor["$schema"],
            "prototype-ordax.release-agent-refresh/1",
        )
        self.assertEqual(descriptor["status"], "development-git-migration")
        self.assertTrue(descriptor["allow_absent_enrollment"])
        self.assertEqual(
            descriptor["target_path"],
            "/ordax/bootstrap/release-acquisition/ordax-release-agent",
        )
        self.assertEqual(target, CURRENT_REFRESH_TARGET)
        self.assertEqual(descriptor["target_size"], 7245984)
        self.assertEqual(len(target), 64)
        self.assertEqual(descriptor["mode"], "0755")
        self.assertFalse(descriptor["physical_media_rewrite_required"])
        self.assertFalse(descriptor["raw_device_write_allowed"])
        self.assertEqual(descriptor["unknown_installed_hash_policy"], "block")
        self.assertNotIn(target, descriptor["allowed_from_sha256"])
        self.assertIn(PREVIOUS_REFRESH_TARGET, descriptor["allowed_from_sha256"])
        self.assertEqual(
            descriptor["download_url"],
            (
                "https://github.com/ordaxsystems/ordax-os/releases/download/"
                f"ordax-release-agent-{target}/ordax-release-agent"
            ),
        )

    def test_minimal_bootstrap_seed_is_an_explicit_refresh_source(self):
        descriptor = json.loads(DESCRIPTOR.read_text(encoding="utf-8"))
        minimal = json.loads(MINIMAL.read_text(encoding="utf-8"))
        groups = {group["id"]: group for group in minimal["artifact_groups"]}
        artifact = groups["bootstrap-release-acquisition"]["artifacts"][0]
        seed = artifact["sha256"]
        target = descriptor["target_sha256"]
        self.assertIn(seed, descriptor["allowed_from_sha256"] + [target])
        self.assertEqual(artifact["target_path"], descriptor["target_path"])
        self.assertEqual(artifact["mode"], descriptor["mode"])
        self.assertFalse(minimal["physical_write_allowed"])
        self.assertEqual(seed, CURRENT_SEED)
        self.assertEqual(target, CURRENT_REFRESH_TARGET)
        self.assertNotEqual(seed, target)
        self.assertIn(seed, descriptor["allowed_from_sha256"])
        self.assertIn(PREVIOUS_REFRESH_TARGET, descriptor["allowed_from_sha256"])
        self.assertIn("721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740", descriptor["allowed_from_sha256"])
        self.assertIn("102c9aeb531b582b4b60d8e808da7f50871c3ea2353c2dc82bd6373f9edc28da", descriptor["allowed_from_sha256"])

    def test_base_contract_does_not_create_generic_bootstrap_updater(self):
        contract = json.loads(BASE.read_text(encoding="utf-8"))
        refresh = contract["release_agent_refresh"]
        self.assertEqual(
            refresh["authority"],
            "git-checkout-pinned-sha256-and-size",
        )
        self.assertEqual(refresh["unknown_installed_hash"], "block")
        self.assertTrue(refresh["absent_agent_enrollment"])
        self.assertTrue(
            refresh["absent_agent_enrollment_requires_explicit_descriptor_gate"]
        )
        self.assertTrue(refresh["existing_unknown_hash_still_blocks"])
        self.assertTrue(refresh["occurs_before_canonical_trust_enrollment"])
        self.assertFalse(refresh["physical_media_rewrite_required"])
        self.assertFalse(refresh["raw_device_write_allowed"])
        self.assertFalse(refresh["generic_bootstrap_updater_created"])
        self.assertTrue(refresh["seed_media_agent_may_precede_refresh_target"])
        self.assertTrue(refresh["seed_media_agent_must_be_recognized_migration_source"])
        self.assertTrue(refresh["refresh_target_may_advance_without_physical_media_rewrite"])
        self.assertEqual(refresh["current_seed_sha256"], CURRENT_SEED)
        self.assertTrue(refresh["current_seed_includes_inspect"])
        self.assertIn(
            "ba633274ee2b9497a75a1b287979900ac31611ff93ec52179bd704daf0a6dbce",
            refresh["legacy_seed_sha256"],
        )
        self.assertIn(
            "74a03bd9901c33b7281d529fb0d379a735d20b5ef7495e0af2f73ca2ff40c90e",
            refresh["legacy_seed_sha256"],
        )
        self.assertIn(
            "1a124616c95ee79be1fb50b00205cb5f9f5382bcb4144b36020fcd5d3be04596",
            refresh["legacy_seed_sha256"],
        )
        self.assertTrue(refresh["current_seed_includes_activate_exact"])
        self.assertEqual(refresh["current_refresh_target_sha256"], CURRENT_REFRESH_TARGET)
        self.assertEqual(refresh["previous_refresh_target_sha256"], PREVIOUS_REFRESH_TARGET)
        self.assertTrue(refresh["previous_refresh_target_refreshes_without_physical_media_rewrite"])
        self.assertTrue(refresh["current_seed_includes_portable_v3_materialize"])
        self.assertTrue(refresh["current_seed_includes_portable_v3_verify_exact"])
        self.assertTrue(refresh["current_refresh_target_includes_portable_v3_materialize"])
        self.assertTrue(refresh["current_refresh_target_includes_portable_v3_verify_exact"])
        self.assertTrue(refresh["current_refresh_target_runtime_reuse_by_sha256"])
        self.assertTrue(refresh["current_refresh_target_includes_portable_v4_materialize"])
        self.assertTrue(refresh["current_refresh_target_includes_portable_v4_verify_exact"])
        self.assertTrue(refresh["current_refresh_target_local_ai_runtime_reuse_by_sha256"])
        self.assertTrue(refresh["current_seed_includes_portable_v4_materialize"])
        self.assertTrue(refresh["current_seed_includes_portable_v4_verify_exact"])
        self.assertTrue(refresh["current_seed_local_ai_runtime_reuse_by_sha256"])
        self.assertIn("721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740", refresh["legacy_seed_sha256"])
        self.assertEqual(refresh["previous_seed_sha256"], "721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740")
        self.assertTrue(refresh["previous_seed_refreshes_without_physical_media_rewrite"])
        self.assertIn("102c9aeb531b582b4b60d8e808da7f50871c3ea2353c2dc82bd6373f9edc28da", refresh["legacy_seed_sha256"])
        self.assertIn("ece358c676d6248798bc53f4f5ac52a4e6bc06cda3111b7978acbc917059bf4c", refresh["legacy_seed_sha256"])

    def test_publisher_never_mutably_overwrites_hash_addressed_asset(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("if: github.event_name == 'push'", workflow)
        self.assertIn("contents: write", workflow)
        self.assertIn("contents: read", workflow)
        self.assertIn('tag="ordax-release-agent-$digest"', workflow)
        self.assertIn("gh release download", workflow)
        self.assertIn("RELEASE_AGENT_PUBLISHED_ASSET_READBACK=VERIFIED", workflow)
        publisher = workflow.split("  publish:", 1)[1]
        self.assertIn("github.repository == 'ordaxsystems/ordax-os'", publisher)
        self.assertIn('test "$GITHUB_REPOSITORY" = \'ordaxsystems/ordax-os\'', publisher)
        self.assertIn('test "$GITHUB_REPOSITORY_ID" = \'1371063347\'', publisher)
        self.assertIn('gh release download "$tag" --repo "$repo"', publisher)
        self.assertIn('test ! -L "$published"', publisher)
        self.assertIn('sha256sum "$published"', publisher)
        self.assertIn('stat -c \'%s\' "$published"', publisher)
        self.assertLess(publisher.index('gh release upload "$tag"'), publisher.index('RELEASE_AGENT_PUBLISHED_ASSET_READBACK=VERIFIED'))
        self.assertNotIn("--clobber", workflow)
        self.assertIn("RELEASE_AGENT_REFRESH_MUTABLE_OVERWRITE=NO", workflow)

    def test_published_target_audit_is_manual_read_only_and_repo_id_pinned(self):
        workflow = WORKFLOW.read_text(encoding="utf-8")
        self.assertIn("  audit-published-target:", workflow)
        audit = workflow.split("  audit-published-target:", 1)[1].split("  publish:", 1)[0]
        self.assertIn("if: github.event_name == 'workflow_dispatch'", audit)
        self.assertIn("test \"$GITHUB_REPOSITORY_ID\" = '1371063347'", audit)
        self.assertIn('gh release download "ordax-release-agent-$PINNED_SHA256"', audit)
        self.assertIn('--repo "$GITHUB_REPOSITORY"', audit)
        self.assertIn("sha256sum --check --status", audit)
        self.assertIn('stat -c \'%s\'', audit)
        self.assertIn("RELEASE_AGENT_NEW_BUILD_AUTHORIZED=NO", audit)
        self.assertIn("RELEASE_AGENT_SIGNING_PERFORMED=NO", audit)
        self.assertIn("PHYSICAL_WRITE_AUTHORIZED=NO", audit)
        self.assertIn("contents: read", audit)
        self.assertNotIn("contents: write", audit)
        self.assertNotIn("gh release create", audit)
        self.assertNotIn("gh release upload", audit)
        self.assertNotIn("--clobber", audit)
        self.assertIn("needs: verify", workflow.split("  publish:", 1)[1])

    def test_owner_refreshes_before_trust_and_has_no_raw_or_reboot_path(self):
        owner = OWNER.read_text(encoding="utf-8")
        self.assertLess(
            owner.index("_refresh_release_agent_if_needed("),
            owner.index("_validate_repository_authority(repo_root)"),
        )
        self.assertIn("unknown installed hash", owner)
        self.assertIn("os.replace(temporary, target)", owner)
        self.assertNotIn("/dev/sd", owner)
        self.assertNotIn("sysrq", owner)
        self.assertNotIn("LoaderEntryOneShot", owner)


if __name__ == "__main__":
    unittest.main()
