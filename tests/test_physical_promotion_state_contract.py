#!/usr/bin/env python3
"""Regression tests for physical promotion-state documentation."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
AUTHORIZATION_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
PROMOTION_GATES_PATH = ROOT / "docs" / "PROMOTION-GATES.md"


class PhysicalPromotionStateContractTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.authorization = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))
        cls.promotion_gates = PROMOTION_GATES_PATH.read_text(encoding="utf-8")

    def test_current_authorization_is_fail_closed(self):
        self.assertIn(
            self.authorization["status"],
            {
                "blocked-canonical-v4-release-proof-pending",
                "blocked-explicit-physical-authorization-pending",
            },
        )
        self.assertFalse(self.authorization["physical_write_allowed"])
        self.assertFalse(self.authorization["explicit_owner_authorization"])
        self.assertIsNone(self.authorization["authorization_context_sha256"])
        if self.authorization["status"] == "blocked-canonical-v4-release-proof-pending":
            self.assertFalse(
                self.authorization["requirements"]["canonical_v4_release_proof_bound"]
            )
        else:
            self.assertTrue(
                self.authorization["requirements"]["canonical_v4_release_proof_bound"]
            )

    def test_promotion_gates_do_not_claim_current_authorization(self):
        gates = self.promotion_gates
        self.assertNotIn("current contract is `authorized`", gates)
        self.assertNotIn("current bound contract is `authorized`", gates)
        if self.authorization["status"] == "blocked-canonical-v4-release-proof-pending":
            self.assertFalse(
                self.authorization["requirements"]["canonical_v4_release_proof_bound"]
            )
            self.assertIn(
                "CURRENT_CANONICAL_V4_RELEASE_PROOF=PENDING_POST_HARDENING_REPLACEMENT",
                gates,
            )
            self.assertIn(
                "DESTRUCTIVE_AUTHORIZATION=NOT_REACHABLE_REPLACEMENT_PROOF_REQUIRED",
                gates,
            )
            self.assertNotIn(
                "DESTRUCTIVE_AUTHORIZATION=NO_FRESH_AUTHORIZATION",
                gates,
            )
        else:
            self.assertIn("DESTRUCTIVE_AUTHORIZATION=NO_FRESH_AUTHORIZATION", gates)
        self.assertIn("POST_588_PHYSICAL_REWRITE_AUTHORIZED=NO", gates)

    def test_historical_physical_proof_is_not_erased_or_promoted_to_current_main(self):
        gates = self.promotion_gates
        self.assertIn("PRIOR_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF", gates)
        self.assertIn("PRIOR_STABLE_MVP_ARTIFACT_READBACK=PASS_17_OF_17", gates)
        self.assertIn("PRIOR_STABLE_MVP_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING", gates)
        self.assertIn(
            "CANONICAL_NOTEBOOK_UEFI_BOOT_CURRENT_MAIN=PENDING_PHYSICAL_RETEST",
            gates,
        )
        self.assertNotIn("CANONICAL_NOTEBOOK_UEFI_BOOT_CURRENT_MAIN=PASS", gates)

    def test_current_main_physical_retest_remains_non_synthetic(self):
        gates = self.promotion_gates
        self.assertIn(
            "CANONICAL_PHYSICAL_KERNEL_BOOT_CURRENT_MAIN=PENDING_PHYSICAL_RETEST",
            gates,
        )
        self.assertIn("MVP_SURFACE_SMOKE_PHYSICAL=PENDING", gates)
        self.assertIn("CANONICAL_STABLE_GRAPHICAL_MODE=PENDING", gates)
        self.assertIn(
            "COLD_HEALTH_COMMIT_PROOF=REQUIRES_PHYSICAL_STABLE_MVP_NO_SYNTHETIC_CI",
            gates,
        )


if __name__ == "__main__":
    unittest.main()
