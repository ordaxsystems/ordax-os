#!/usr/bin/env python3
"""Keep the operator handoff aligned with the physical authorization state machine."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
AUTH_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
HANDOFF_PATH = ROOT / "docs" / "MVP-PRE-PHYSICAL-HANDOFF.md"


class PhysicalHandoffFreshnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.authorization = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        cls.handoff = HANDOFF_PATH.read_text(encoding="utf-8")

    def test_current_proof_pending_state_is_explicit_and_fail_closed(self):
        auth = self.authorization
        self.assertEqual(auth["status"], "blocked-canonical-v4-release-proof-pending")
        self.assertFalse(auth["physical_write_allowed"])
        self.assertFalse(auth["explicit_owner_authorization"])
        self.assertIsNone(auth["authorization_context_sha256"])
        self.assertFalse(auth["requirements"]["canonical_v4_release_proof_bound"])

        handoff = self.handoff
        self.assertIn(
            "CURRENT_MAIN_CANONICAL_V4_RELEASE_PROOF=PENDING_POST_HARDENING_REPLACEMENT",
            handoff,
        )
        self.assertIn("CURRENT_MAIN_CANONICAL_V4_RELEASE_PROOF_BOUND=NO", handoff)
        self.assertIn(
            "PHYSICAL_WRITE_AUTHORIZATION=BLOCKED_CANONICAL_V4_RELEASE_PROOF_PENDING",
            handoff,
        )
        self.assertIn("EXPLICIT_OWNER_AUTHORIZATION=NO", handoff)
        self.assertIn("PHYSICAL_WRITE_ALLOWED=NO", handoff)

    def test_historical_physical_proof_is_preserved_but_not_reused(self):
        handoff = self.handoff
        self.assertIn(
            "PRIOR_STABLE_MVP_USB_WRITE=PASS_AUTHORIZED_CONTROLLED_PROOF",
            handoff,
        )
        self.assertIn("PRIOR_STABLE_MVP_ARTIFACT_READBACK=PASS_17_OF_17", handoff)
        self.assertIn(
            "PRIOR_STABLE_MVP_UEFI_BOOT=PASS_PHYSICAL_PRE_HARDENING",
            handoff,
        )
        self.assertIn("same superseded source commit", handoff)
        self.assertIn("replacement post-hardening v4 prerelease", handoff)

    def test_handoff_does_not_claim_current_authorization_or_current_write(self):
        handoff = self.handoff
        forbidden = (
            "PHYSICAL_WRITE_AUTHORIZATION=PASS_EXPLICIT_OWNER_CONSENT_BOUND_CONTEXT",
            "At the current `authorized-candidate-ready-for-separate-physical-flow` stage",
            "Authorization is now recorded.",
            "owner authorization is complete",
        )
        for marker in forbidden:
            self.assertNotIn(marker, handoff)

        self.assertIn("POST_HARDENING_PHYSICAL_WRITE_PERFORMED=NO", handoff)
        self.assertIn("stage=canonical-v4-release-proof-pending", handoff)
        self.assertIn("canonical_v4_release_proof_current=false", handoff)
        self.assertIn("owner_authorization_recorded=false", handoff)

    def test_remaining_order_keeps_non_destructive_proof_before_consent(self):
        handoff = self.handoff
        proof = handoff.index("1. build/sign/publish a new canonical v4 prerelease")
        bind = handoff.index("3. bind that new proof")
        consent = handoff.index("5. record a new explicit owner authorization")
        target = handoff.index("6. separately select the physical USB")
        write = handoff.index("8. execute a new physical write only when explicitly authorized")
        self.assertLess(proof, bind)
        self.assertLess(bind, consent)
        self.assertLess(consent, target)
        self.assertLess(target, write)


if __name__ == "__main__":
    unittest.main()
