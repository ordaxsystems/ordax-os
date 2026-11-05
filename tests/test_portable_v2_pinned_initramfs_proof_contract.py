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
        self.assertIn("bootstrap/kernel/build.py build", WORKFLOW)
        self.assertIn("--portable-bootstrap-capsule", WORKFLOW)
        self.assertIn("--portable-stable-base", WORKFLOW)
        self.assertIn("portable_bootstrap_capsule_pin", WORKFLOW)
        self.assertIn("portable_stable_base_pin", WORKFLOW)
        self.assertIn("ordax-portable-capsule-verify verify", WORKFLOW)
        self.assertIn("ordax-portable-base-verify verify", WORKFLOW)

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
