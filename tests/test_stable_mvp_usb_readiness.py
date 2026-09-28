#!/usr/bin/env python3
"""Regression coverage for the aggregate Stable/MVP USB readiness gate."""

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
TOOL_PATH = ROOT / "tools" / "creator" / "stable_mvp_usb_readiness.py"
AUTHORIZATION_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"


def load_module():
    spec = importlib.util.spec_from_file_location(
        "ordax_stable_mvp_usb_readiness_test",
        TOOL_PATH,
    )
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


readiness = load_module()


class StableMvpUsbReadinessTests(unittest.TestCase):
    def test_classifier_has_explicit_non_destructive_stages(self):
        source_ready = {"source_ready": True}
        source_blocked = {"source_ready": False}

        self.assertEqual(
            readiness.classify(source_blocked, {}),
            "source-blocked",
        )
        self.assertEqual(
            readiness.classify(
                source_ready,
                {"canonical_v4_release_proof_valid": True},
                readiness.PRE_PROOF_AUTHORIZATION_STATUS,
            ),
            "canonical-v4-release-proof-pending",
        )
        self.assertEqual(
            readiness.classify(
                source_ready,
                {"canonical_v4_release_proof_valid": False},
            ),
            "canonical-v4-release-proof-pending",
        )
        self.assertEqual(
            readiness.classify(
                source_ready,
                {
                    "canonical_v4_release_proof_valid": True,
                    "pre_authorization_ready": True,
                    "ready": False,
                    "owner_authorization_required": True,
                },
                "blocked-explicit-physical-authorization-pending",
            ),
            "explicit-owner-authorization-pending",
        )
        self.assertEqual(
            readiness.classify(
                source_ready,
                {
                    "canonical_v4_release_proof_valid": True,
                    "pre_authorization_ready": True,
                    "ready": True,
                    "authorized_candidate_materialization_allowed": True,
                },
                "authorized",
            ),
            "authorized-candidate-ready-for-separate-physical-flow",
        )

    def test_remaining_gates_keep_authorization_separate_from_physical_proof(self):
        proof_pending = readiness.remaining_gates("canonical-v4-release-proof-pending")
        self.assertEqual(proof_pending[0], "canonical-v4-release-proof")
        self.assertEqual(proof_pending[2], "explicit-owner-authorization")

        pending = readiness.remaining_gates("explicit-owner-authorization-pending")
        self.assertEqual(pending[0], "explicit-owner-authorization")
        self.assertIn(
            "physical-write-and-exact-17-artifact-readback",
            pending,
        )
        self.assertIn(
            "canonical-stable-boot-oobe-surface-and-app-smoke",
            pending,
        )
        self.assertIn(
            "physical-cold-health-known-good-and-offline-reboot",
            pending,
        )
        self.assertIn(
            "physical-broken-candidate-rollback-and-recovery",
            pending,
        )
        self.assertEqual(
            pending[-1],
            "stable-channel-publication-after-physical-proof",
        )

        authorized = readiness.remaining_gates(
            "authorized-candidate-ready-for-separate-physical-flow"
        )
        self.assertNotIn("explicit-owner-authorization", authorized)
        self.assertEqual(
            authorized,
            list(readiness.POST_AUTHORIZATION_PHYSICAL_GATES),
        )

    def test_source_blocked_does_not_pretend_downstream_physical_readiness(self):
        self.assertEqual(
            readiness.remaining_gates("source-blocked"),
            ["pre-usb-source-closure"],
        )
        self.assertEqual(
            readiness.remaining_gates("promotion-state-inconsistent"),
            ["repair-promotion-state-consistency"],
        )

    def test_current_repository_readiness_matches_authorization_contract(self):
        status = readiness.evaluate(ROOT)
        authorization = json.loads(AUTHORIZATION_PATH.read_text(encoding="utf-8"))

        proof_pending = (
            authorization["status"] == readiness.PRE_PROOF_AUTHORIZATION_STATUS
            and authorization["physical_write_allowed"] is False
            and authorization["explicit_owner_authorization"] is False
            and authorization["authorization_context_sha256"] is None
            and authorization["requirements"]["canonical_v4_release_proof_bound"] is False
        )
        pending = (
            authorization["status"] == "blocked-explicit-physical-authorization-pending"
            and authorization["physical_write_allowed"] is False
            and authorization["explicit_owner_authorization"] is False
            and authorization["authorization_context_sha256"] is None
            and authorization["requirements"]["canonical_v4_release_proof_bound"] is True
        )
        authorized = (
            authorization["status"] == "authorized"
            and authorization["physical_write_allowed"] is True
            and authorization["explicit_owner_authorization"] is True
            and isinstance(authorization["authorization_context_sha256"], str)
            and len(authorization["authorization_context_sha256"]) == 64
            and authorization["requirements"]["canonical_v4_release_proof_bound"] is True
        )
        self.assertEqual(
            sum((proof_pending, pending, authorized)),
            1,
            "authorization contract must be exactly proof-pending, consent-pending, or authorized",
        )

        self.assertTrue(status["source_ready"], status["blockers"])
        self.assertTrue(status["pre_usb_product_source_complete"])
        # The old receipt remains cryptographically valid historical evidence even
        # after its release bytes are superseded. Currency is reported separately.
        self.assertTrue(status["canonical_v4_release_proof_valid"])
        self.assertTrue(status["canonical_v4_release_binding_resolved"])
        self.assertEqual(
            status["proof_boundaries"]["pre_usb_product_source"],
            "pass",
        )
        self.assertEqual(
            status["proof_boundaries"]["canonical_stable_graphical_session"],
            "requires-physical-proof",
        )
        self.assertEqual(
            status["proof_boundaries"]["canonical_system_runtime"],
            "requires-physical-proof",
        )
        self.assertEqual(
            status["proof_boundaries"]["stable_publication"],
            "requires-separate-post-physical-promotion",
        )
        self.assertEqual(
            status["handoff_document"],
            "docs/MVP-PRE-PHYSICAL-HANDOFF.md",
        )
        self.assertTrue((ROOT / status["handoff_document"]).is_file())

        if proof_pending:
            self.assertEqual(status["stage"], "canonical-v4-release-proof-pending")
            self.assertEqual(status["next_stage"], "canonical-v4-release-proof")
            self.assertFalse(status["canonical_v4_release_proof_current"])
            self.assertFalse(status["canonical_v4_release_proof_bound_requirement"])
            self.assertFalse(status["pre_authorization_ready"])
            self.assertFalse(status["owner_authorization_required"])
            self.assertFalse(status["owner_authorization_recorded"])
            self.assertFalse(status["authorized_candidate_materialization_allowed"])
            self.assertEqual(
                status["proof_boundaries"]["canonical_v4_release_candidate"],
                "superseded-replacement-required",
            )
            self.assertEqual(status["remaining_gates"][0], "canonical-v4-release-proof")
        elif pending:
            self.assertEqual(status["stage"], "explicit-owner-authorization-pending")
            self.assertTrue(status["canonical_v4_release_proof_current"])
            self.assertTrue(status["canonical_v4_release_proof_bound_requirement"])
            self.assertTrue(status["pre_authorization_ready"])
            self.assertTrue(status["owner_authorization_required"])
            self.assertFalse(status["owner_authorization_recorded"])
            self.assertFalse(status["authorized_candidate_materialization_allowed"])
            self.assertEqual(
                status["proof_boundaries"]["canonical_v4_release_candidate"],
                "pass",
            )
            self.assertEqual(status["remaining_gates"][0], "explicit-owner-authorization")
        else:
            self.assertEqual(
                status["stage"],
                "authorized-candidate-ready-for-separate-physical-flow",
            )
            self.assertTrue(status["canonical_v4_release_proof_current"])
            self.assertFalse(status["owner_authorization_required"])
            self.assertTrue(status["owner_authorization_recorded"])
            self.assertTrue(status["authorized_candidate_materialization_allowed"])
            self.assertEqual(
                status["proof_boundaries"]["physical_write_authorization"],
                "pass",
            )
            self.assertEqual(
                status["remaining_gates"][0],
                "physical-target-selection-and-live-revalidation",
            )

        self.assertEqual(
            status["proof_boundaries"]["physical_write_authorization"],
            "pass" if authorized else "pending",
        )
        self.assertFalse(status["physical_target_selected"])
        self.assertFalse(status["target_specific_destructive_confirmation_recorded"])
        self.assertFalse(status["writer_invoked"])
        self.assertFalse(status["physical_write_performed"])
        self.assertFalse(status["physical_proof_completed"])

    def test_ready_stage_still_does_not_claim_physical_proof(self):
        result = readiness.classify(
            {"source_ready": True},
            {
                "canonical_v4_release_proof_valid": True,
                "pre_authorization_ready": True,
                "ready": True,
                "authorized_candidate_materialization_allowed": True,
            },
            "authorized",
        )
        self.assertEqual(
            result,
            "authorized-candidate-ready-for-separate-physical-flow",
        )
        self.assertIn(
            "physical-write-and-exact-17-artifact-readback",
            readiness.remaining_gates(result),
        )


if __name__ == "__main__":
    unittest.main()
