#!/usr/bin/env python3
"""Regress exact resolved bytes for the current minimal MVP bootstrap seed."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MINIMAL = ROOT / "docs/contracts/minimal-bootstrap.json"
CREATOR_WORKFLOW = ROOT / ".github/workflows/creator-payload-candidate.yml"
FULL_MEDIA_WORKFLOW = ROOT / ".github/workflows/full-bootstrap-media-proof.yml"
ASSEMBLER = ROOT / "tools/creator/assemble.py"

CURRENT_REFRESH_TARGET = "444e428d33bd4f3c6ef6d3f0ef403cde43e8e31be85369ce3604178d11dfbabd"
PREVIOUS_REFRESH_TARGET = "e18c4e7eb4b4b73f49e1bf8c1d051e3253789fb6e1b422cebd8db9a74740f2af"
FORMER_REFRESH_TARGET = "a514b8280cecb0b3f70e681eb4ba2167bf599ac2fa336c546cfbe71f46ea9c8e"


class MVPSeedArtifactBindingsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(MINIMAL.read_text(encoding="utf-8"))
        cls.groups = {group["id"]: group for group in cls.contract["artifact_groups"]}

    def artifact(self, group: str):
        artifacts = self.groups[group]["artifacts"]
        self.assertEqual(len(artifacts), 1)
        return artifacts[0]

    def test_current_efi_binding_uses_reproduced_final_namespace_sbat(self):
        group = self.groups["uefi-boot"]
        efi = next(x for x in group["artifacts"] if x["source_path"] == "boot/esp/EFI/BOOT/BOOTX64.EFI")
        self.assertEqual(efi["source_path"], "boot/esp/EFI/BOOT/BOOTX64.EFI")
        self.assertEqual(efi["sha256"], "17041f6bcdae189a11880c5926d052f60b289dc2ed16b0c9e7aa681bdb592d03")
        self.assertEqual(efi["mode"], "0644")
        builder = (ROOT / "boot/esp/build.py").read_text(encoding="utf-8")
        self.assertIn("-Dsbat-distro-url=https://github.com/ordaxsystems/ordax-os", builder)
        self.assertNotIn("-Dsbat-distro-url=https://github.com/ordaxsystems/prototipo-ordax-os", builder)
        self.assertFalse(self.contract["physical_write_allowed"])

    def test_current_kernel_binding_matches_portable_v2_capable_kernel(self):
        artifact = self.artifact("kernel")
        self.assertEqual(artifact["source_path"], "bootstrap/kernel/vmlinuz-6.6.52")
        self.assertEqual(artifact["sha256"], "cbe9b7421d6d4ece48b6025866c371557e6301fef981336a52a949544e925205")

    def test_current_initramfs_binding_matches_transactional_portable_capsule(self):
        artifact = self.artifact("initramfs")
        self.assertEqual(artifact["source_path"], "bootstrap/initramfs/initramfs.cpio.gz")
        self.assertEqual(artifact["sha256"], "63a504c4349aebc43d9ed642ff14384191fd9804e8a657691ffe997441a9edf0")

    def test_current_release_agent_seed_is_recognized_source_for_v4_capable_refresh(self):
        artifact = self.artifact("bootstrap-release-acquisition")
        refresh = json.loads(
            (ROOT / "system/services/base-update/release-agent-refresh.json").read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(artifact["sha256"], "550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66")
        self.assertEqual(refresh["target_sha256"], CURRENT_REFRESH_TARGET)
        self.assertNotEqual(artifact["sha256"], refresh["target_sha256"])
        self.assertIn(artifact["sha256"], refresh["allowed_from_sha256"])
        self.assertIn(PREVIOUS_REFRESH_TARGET, refresh["allowed_from_sha256"])
        self.assertIn(FORMER_REFRESH_TARGET, refresh["allowed_from_sha256"])
        self.assertIn("721f8a3fcec1ccfd2dd75c4d633ff2efd960909287c5e11fcf9abf19e5372740", refresh["allowed_from_sha256"])
        self.assertIn("102c9aeb531b582b4b60d8e808da7f50871c3ea2353c2dc82bd6373f9edc28da", refresh["allowed_from_sha256"])
        self.assertIn("ece358c676d6248798bc53f4f5ac52a4e6bc06cda3111b7978acbc917059bf4c", refresh["allowed_from_sha256"])
        self.assertIn(
            "ba633274ee2b9497a75a1b287979900ac31611ff93ec52179bd704daf0a6dbce",
            refresh["allowed_from_sha256"],
        )

    def test_release_agent_seed_is_not_routed_to_current_generated_refresh_output(self):
        assembler = ASSEMBLER.read_text(encoding="utf-8")
        self.assertNotIn(
            '"bootstrap/release-acquisition/ordax-release-agent": "out/release-acquisition/ordax-release-agent"',
            assembler,
        )
        self.assertIn("release-acquisition agent is deliberately NOT listed here", assembler)

    def test_bootstrap_assembly_restores_immutable_seed_after_refresh_target_build(self):
        seed = "550df685679f1bf15a636729960fe6fc3ffc1afda1a346214ce96716f7170a66"
        script_path = ROOT / "bootstrap/release-acquisition/restore_pinned_seed.sh"
        script = script_path.read_text(encoding="utf-8")
        self.assertIn(seed, script)
        self.assertIn("expected_repository_id='1371063347'", script)
        self.assertIn('"${GITHUB_REPOSITORY_ID:-}" != "$expected_repository_id"', script)
        self.assertIn("releases/download/ordax-release-agent-${seed_sha256}/ordax-release-agent", script)
        self.assertIn(
            'install -m 0755 "$tmp" "$destination"',
            script,
        )
        self.assertIn("canonical release-agent seed hash mismatch", script)
        self.assertIn("RELEASE_AGENT_REFRESH_TARGET_REMAINS_SEPARATE=YES", script)
        for workflow_path in (CREATOR_WORKFLOW, FULL_MEDIA_WORKFLOW):
            workflow = workflow_path.read_text(encoding="utf-8")
            self.assertIn("Restore canonical release-agent seed for bootstrap assembly", workflow)
            self.assertIn("run: bash bootstrap/release-acquisition/restore_pinned_seed.sh", workflow)
            self.assertNotIn("curl --fail --location", workflow)
            self.assertNotIn("releases/download/ordax-release-agent-", workflow)

    def test_full_media_proof_removes_transient_seed_before_clean_checkout_assertion(self):
        workflow = FULL_MEDIA_WORKFLOW.read_text(encoding="utf-8")
        remove_seed = "rm -f bootstrap/release-acquisition/ordax-release-agent"
        assert_seed_absent = "test ! -e bootstrap/release-acquisition/ordax-release-agent"
        clean_checkout = 'test -z "$(git status --porcelain)"'
        self.assertIn(remove_seed, workflow)
        self.assertIn(assert_seed_absent, workflow)
        self.assertIn(clean_checkout, workflow)
        self.assertLess(workflow.index(remove_seed), workflow.index(clean_checkout))
        self.assertLess(workflow.index(assert_seed_absent), workflow.index(clean_checkout))

    def test_canonical_release_trust_is_resolved_without_enabling_write(self):
        unresolved = [g["id"] for g in self.contract["artifact_groups"] if not g["resolved"]]
        self.assertEqual(unresolved, [])
        self.assertTrue(self.contract["all_artifacts_resolved"])
        trust = self.artifact("bootstrap-release-trust")
        self.assertEqual(trust["source_path"], "bootstrap/trust/release-ed25519.json")
        self.assertEqual(
            trust["sha256"],
            "d2836df77a3d5a54ccf64cc5643cfd5c19052efc83f2e3e2666c6d3197fce250",
        )
        self.assertFalse(self.contract["physical_write_allowed"])


if __name__ == "__main__":
    unittest.main()
