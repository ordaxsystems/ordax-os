#!/usr/bin/env python3
"""Regress the exact-artifact portable-v2 pinned-initramfs proof boundary."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = json.loads(
    (ROOT / "docs/contracts/portable-v2-pinned-initramfs-proof.json").read_text(
        encoding="utf-8"
    )
)
BOOTSTRAP = json.loads(
    (ROOT / "docs/contracts/portable-bootstrap-v2.json").read_text(encoding="utf-8")
)
HANDOFF = json.loads(
    (ROOT / "docs/contracts/portable-boot-handoff.json").read_text(encoding="utf-8")
)
WORKFLOW = (
    ROOT / ".github/workflows/portable-v2-pinned-initramfs-proof.yml"
).read_text(encoding="utf-8")


class PortableV2PinnedInitramfsProofTests(unittest.TestCase):
    def test_contract_remains_candidate_only(self):
        self.assertEqual(
            CONTRACT["$schema"],
            "prototype-ordax.portable-v2-pinned-initramfs-proof/1",
        )
        self.assertEqual(CONTRACT["status"], "candidate-workflow-implemented")
        self.assertFalse(CONTRACT["physical_write_authorized"])
        self.assertFalse(CONTRACT["physical_device_touched"])
        self.assertFalse(CONTRACT["physical_boot_connected"])
        self.assertFalse(CONTRACT["qemu_boot_proven"])
        self.assertFalse(CONTRACT["pid1_default_changed"])
        self.assertFalse(CONTRACT["candidate_pid1_promoted"])

    def test_workflow_builds_real_inputs_and_same_initramfs_pins(self):
        self.assertIn("bootstrap/portable-v2/capsule/build.py build", WORKFLOW)
        self.assertIn("bootstrap/independent-base/build.py verify", WORKFLOW)
        self.assertIn("--profile stable-mvp", WORKFLOW)
        self.assertIn("portable_component_cache.py fingerprints", WORKFLOW)
        self.assertIn("actions/cache/restore@", WORKFLOW)
        self.assertIn("--component independent-base-stable", WORKFLOW)
        self.assertIn("--cache-hit true", WORKFLOW)
        self.assertIn("fsck.erofs", WORKFLOW)
        self.assertIn("cmp " + '"$source/independent-base.erofs" "$work/stable-base/stable-base.erofs"', WORKFLOW)
        self.assertIn("signed_release_equivalence_proven", WORKFLOW)
        self.assertNotIn("bootstrap/stable-base/build.py", WORKFLOW)
        self.assertNotIn("bootstrap/independent-base/build.py build", WORKFLOW)
        self.assertNotIn("apk add", WORKFLOW)
        self.assertNotIn("bootstrap/kernel/build.py build", WORKFLOW)
        self.assertIn("Restore verified kernel component", WORKFLOW)
        self.assertIn("Verify exact cached kernel modules without rebuilding", WORKFLOW)
        self.assertIn("--component kernel", WORKFLOW)
        self.assertIn("bootstrap/kernel/verify.py", WORKFLOW)
        self.assertIn("--portable-bootstrap-capsule", WORKFLOW)
        self.assertIn("--portable-stable-base", WORKFLOW)
        self.assertIn("portable_bootstrap_capsule_pin", WORKFLOW)
        self.assertIn("portable_stable_base_pin", WORKFLOW)
        self.assertIn("ordax-portable-capsule-verify verify", WORKFLOW)
        self.assertIn("ordax-portable-base-verify verify", WORKFLOW)

    def test_stable_cache_is_verified_before_expensive_artifact_builds(self):
        # A missing exact Stable cache must block before Go capsule or kernel
        # compilation. Cache verification remains strict, never a rebuild.
        fingerprint = WORKFLOW.index(
            "      - name: Resolve exact Stable Buildroot component fingerprint"
        )
        restore = WORKFLOW.index(
            "      - name: Restore verified Stable Buildroot component"
        )
        verified = WORKFLOW.index(
            "      - name: Verify and stage exact Stable Buildroot EROFS"
        )
        capsule = WORKFLOW.index(
            "      - name: Build exact static release agent and bootstrap capsule"
        )
        kernel_restore = WORKFLOW.index(
            "      - name: Restore verified kernel component"
        )
        kernel_verify = WORKFLOW.index(
            "      - name: Verify exact cached kernel modules without rebuilding"
        )
        initramfs = WORKFLOW.index(
            "      - name: Build one initramfs pinned to both real EROFS artifacts"
        )
        self.assertLess(WORKFLOW.index("      - name: Install exact-artifact build dependencies"), fingerprint)
        self.assertLess(fingerprint, restore)
        self.assertLess(restore, verified)
        self.assertLess(verified, kernel_restore)
        self.assertLess(kernel_restore, kernel_verify)
        self.assertLess(kernel_verify, capsule)
        self.assertLess(capsule, initramfs)
        kernel_block = WORKFLOW[kernel_verify:capsule]
        self.assertIn(
            'path: ${{ runner.temp }}/portable-v2-qemu/kernel',
            WORKFLOW[kernel_restore:kernel_verify],
        )
        self.assertIn('kernel_dir="$RUNNER_TEMP/portable-v2-qemu/kernel"', kernel_block)
        self.assertNotIn('portable-v2-pinned/kernel', WORKFLOW)
        self.assertIn('if [ "$ORDAX_KERNEL_CACHE_HIT" != true ]; then', kernel_block)
        self.assertIn('--component kernel', kernel_block)
        self.assertIn('--cache-hit true', kernel_block)
        self.assertIn('kernel-component-reuse.json', kernel_block)
        self.assertIn('bootstrap/kernel/verify.py', kernel_block)
        self.assertNotIn('bootstrap/kernel/build.py build', kernel_block)
        stable_block = WORKFLOW[verified:kernel_restore]
        self.assertIn('mkdir -p "$work/metadata"', stable_block)
        self.assertIn('if [ "$ORDAX_STABLE_CACHE_HIT" != true ]; then', stable_block)
        self.assertIn('bootstrap/independent-base/build.py verify', stable_block)
        self.assertIn('portable_component_cache.py verify', stable_block)
        self.assertIn('fsck.erofs "$work/stable-base/stable-base.erofs"', stable_block)
        self.assertNotIn("bootstrap/independent-base/build.py build", stable_block)

    def test_workflow_requires_tamper_rejection_without_qemu_or_physical_device(self):
        self.assertIn("CAPSULE_TAMPER_REJECTED=YES", WORKFLOW)
        self.assertIn("STABLE_BASE_TAMPER_REJECTED=YES", WORKFLOW)
        self.assertNotIn("qemu-system", WORKFLOW)
        self.assertNotIn("/dev/sd", WORKFLOW)
        self.assertNotIn("PhysicalDrive", WORKFLOW)

    def test_authority_contracts_do_not_promote_pid1_or_physical_boot(self):
        proof = BOOTSTRAP["pinned_initramfs_composition_proof"]
        self.assertTrue(proof["workflow_implemented"])
        self.assertFalse(proof["proof_passed_on_current_head"])
        self.assertFalse(proof["pid1_default_changed"])
        self.assertFalse(proof["physical_boot_connected"])
        self.assertFalse(proof["public_physical_promotion_allowed"])

        handoff = HANDOFF["pinned_initramfs_composition_proof"]
        self.assertTrue(handoff["workflow_implemented"])
        self.assertFalse(handoff["proof_passed_on_current_head"])
        self.assertFalse(handoff["qemu_boot_proven"])
        self.assertFalse(handoff["physical_boot_proven"])


if __name__ == "__main__":
    unittest.main()
