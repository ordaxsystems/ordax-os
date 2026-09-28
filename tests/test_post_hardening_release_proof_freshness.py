#!/usr/bin/env python3
"""Regression coverage for superseded Stable/MVP release proof handling."""

import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BINDER_PATH = ROOT / "tools" / "creator" / "bind_canonical_v4_release_proof.py"
AUTH_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
PROOF_PATH = ROOT / "docs" / "evidence" / "canonical-v4-release-proof.json"

_spec = importlib.util.spec_from_file_location("ordax_v4_proof_binder", BINDER_PATH)
binder = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(binder)


class PostHardeningReleaseProofFreshnessTests(unittest.TestCase):
    def test_current_repository_requires_replacement_release_proof(self):
        authorization = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        proof = json.loads(PROOF_PATH.read_text(encoding="utf-8"))

        self.assertEqual(authorization["status"], binder.PRE_PROOF_STATUS)
        self.assertFalse(authorization["physical_write_allowed"])
        self.assertFalse(authorization["explicit_owner_authorization"])
        self.assertFalse(
            authorization["requirements"]["canonical_v4_release_proof_bound"]
        )
        self.assertEqual(
            authorization["release_binding"]["source_commit"],
            proof["source_commit"],
        )

    def test_pre_proof_state_rejects_rebinding_superseded_source_commit(self):
        authorization = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        proof = json.loads(PROOF_PATH.read_text(encoding="utf-8"))

        with self.assertRaisesRegex(
            binder.BindingError,
            "superseded by later source hardening",
        ):
            binder._assert_existing_binding_is_idempotent(
                status=binder.PRE_PROOF_STATUS,
                bindings=authorization["bindings"],
                release_binding=authorization["release_binding"],
                proof=proof,
                proof_sha=authorization["bindings"]["canonical_v4_release_proof_sha256"],
            )

    def test_pre_proof_state_accepts_a_different_signed_source_for_validation(self):
        authorization = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        proof = json.loads(PROOF_PATH.read_text(encoding="utf-8"))
        replacement = dict(proof)
        replacement["source_commit"] = "f" * 40

        binder._assert_existing_binding_is_idempotent(
            status=binder.PRE_PROOF_STATUS,
            bindings=authorization["bindings"],
            release_binding=authorization["release_binding"],
            proof=replacement,
            proof_sha="e" * 64,
        )


if __name__ == "__main__":
    unittest.main()
