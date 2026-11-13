#!/usr/bin/env python3
"""Keep physical authorization and readiness ordering aligned with canonical owners."""

import importlib.util
import json
import re
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
AUTH_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
CURRENT_STATE_PATH = ROOT / "docs" / "CURRENT-STATE.md"
READINESS_PATH = ROOT / "tools" / "creator" / "stable_mvp_usb_readiness.py"


def load_readiness():
    spec = importlib.util.spec_from_file_location(
        "ordax_stable_mvp_physical_freshness",
        READINESS_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def assignments(text: str) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in text.splitlines():
        match = re.fullmatch(r"([A-Z0-9_]+)=([^\s]+)", line.strip())
        if match:
            result[match.group(1)] = match.group(2)
    return result


readiness = load_readiness()


class PhysicalAuthorizationFreshnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.authorization = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        cls.state = assignments(CURRENT_STATE_PATH.read_text(encoding="utf-8"))

    def test_current_proof_and_owner_consent_have_independent_gates(self):
        auth = self.authorization
        self.assertIn(auth["status"], {
            "blocked-explicit-physical-authorization-pending", "authorized",
        })
        permitted = auth["status"] == "authorized"
        self.assertIs(auth["physical_write_allowed"], permitted)
        self.assertIs(auth["explicit_owner_authorization"], permitted)
        if permitted:
            self.assertRegex(auth["authorization_context_sha256"], r"^[0-9a-f]{64}$")
        else:
            self.assertIsNone(auth["authorization_context_sha256"])
        self.assertTrue(auth["requirements"]["canonical_v4_release_proof_bound"])

        self.assertEqual(
            self.state["CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN"],
            "PASS_POST_HARDENING_SIGNED_HTTPS_MATERIALIZED_AND_BOUND",
        )
        self.assertEqual(
            self.state["FIRST_STABLE_MVP_USB_WRITE"],
            "HOLD_EXPLICIT_PHYSICAL_AUTHORIZATION_PENDING",
        )
        self.assertEqual(self.state["PHYSICAL_OWNER_AUTHORIZATION_RECORDED"], "NO")
        self.assertEqual(
            self.state["PHYSICAL_WRITE_AUTHORITY"],
            "BLOCKED_EXPLICIT_OWNER_AUTHORIZATION_PENDING",
        )

    def test_historical_and_current_release_proofs_are_distinct(self):
        history = self.state["CANONICAL_V4_RELEASE_PROOF_HISTORY"]
        current = self.state["CANONICAL_V4_RELEASE_PROOF_CURRENT_MAIN"]
        self.assertIn("PRE_HARDENING", history)
        self.assertIn("POST_HARDENING", current)
        self.assertNotEqual(history, current)

    def test_readiness_uses_canonical_gate_authority(self):
        self.assertEqual(
            readiness.GATE_AUTHORITY_DOCUMENT,
            "docs/PROMOTION-GATES.md",
        )
        self.assertTrue((ROOT / readiness.GATE_AUTHORITY_DOCUMENT).is_file())

    def test_remaining_order_keeps_consent_before_target_and_write(self):
        gates = readiness.remaining_gates("explicit-owner-authorization-pending")
        consent = gates.index("explicit-owner-authorization")
        target = gates.index("physical-target-selection-and-live-revalidation")
        confirmation = gates.index("target-specific-destructive-confirmation-and-windows-uac")
        write = gates.index("physical-write-and-exact-17-artifact-readback")
        self.assertLess(consent, target)
        self.assertLess(target, confirmation)
        self.assertLess(confirmation, write)


if __name__ == "__main__":
    unittest.main()
