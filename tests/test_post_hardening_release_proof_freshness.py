#!/usr/bin/env python3
"""Regress the current post-hardening v4 proof binding, without USB writes."""

import hashlib
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BINDER_PATH = ROOT / "tools" / "creator" / "bind_canonical_v4_release_proof.py"
AUTH_PATH = ROOT / "docs" / "contracts" / "physical-write-authorization.json"
PROOF_PATH = ROOT / "docs" / "evidence" / "canonical-v4-release-proof.json"
CURRENT_SOURCE = "03f88eeaf382a59aaefbcf4943d0639d2730741b"
HISTORICAL_SOURCE = "b924ff8d74d1761232381ae3f9604bba17497cfd"

_spec = importlib.util.spec_from_file_location("ordax_v4_proof_binder", BINDER_PATH)
binder = importlib.util.module_from_spec(_spec)
assert _spec.loader is not None
_spec.loader.exec_module(binder)


class PostHardeningReleaseProofFreshnessTests(unittest.TestCase):
    def setUp(self):
        self.authorization = json.loads(AUTH_PATH.read_text(encoding="utf-8"))
        self.proof = json.loads(PROOF_PATH.read_text(encoding="utf-8"))
        self.proof_sha = hashlib.sha256(PROOF_PATH.read_bytes()).hexdigest()

    def test_current_post_hardening_public_proof_is_bound_but_never_authorizes_usb(self):
        auth, proof = self.authorization, self.proof
        self.assertIn(auth["status"], (binder.POST_PROOF_STATUS, "authorized"))
        permitted = auth["status"] == "authorized"
        self.assertIs(auth["physical_write_allowed"], permitted)
        self.assertIs(auth["explicit_owner_authorization"], permitted)
        if permitted:
            self.assertRegex(auth["authorization_context_sha256"], r"^[0-9a-f]{64}$")
        else:
            self.assertIsNone(auth["authorization_context_sha256"])
        self.assertTrue(auth["requirements"]["canonical_v4_release_proof_bound"])
        self.assertEqual(auth["bindings"]["canonical_v4_release_proof_sha256"], self.proof_sha)
        self.assertEqual(proof["source_commit"], CURRENT_SOURCE)
        self.assertNotEqual(proof["source_commit"], HISTORICAL_SOURCE)
        self.assertEqual(auth["release_binding"]["source_commit"], CURRENT_SOURCE)
        self.assertEqual(auth["release_binding"]["release_manifest_sha256"],
                         proof["release_manifest_sha256"])
        self.assertEqual(auth["release_binding"]["release_envelope_sha256"],
                         proof["release_envelope_sha256"])
        self.assertEqual(auth["release_binding"]["canonical_envelope_url"],
                         proof["canonical_envelope_url"])
        self.assertEqual(auth["release_binding"]["proof_path"],
                         "docs/evidence/canonical-v4-release-proof.json")
        self.assertTrue(proof["signed_handoff_verified"])
        self.assertTrue(proof["canonical_materialization_verified"])
        for name in ("release_activated", "physical_target_selected",
                     "physical_write_authorized", "physical_write_performed"):
            self.assertIs(proof[name], False)
        binder.validate_proof(ROOT, PROOF_PATH)

    def test_exact_current_proof_binding_is_idempotent(self):
        if self.authorization["status"] == "authorized":
            # Proof binder must not reopen release identity after consent,
            # even for an already bound and byte-identical proof.
            with self.assertRaisesRegex(binder.BindingError, "pre-consent state"):
                binder.bind(ROOT, PROOF_PATH)
            return
        binder._assert_existing_binding_is_idempotent(
            status=self.authorization["status"],
            bindings=self.authorization["bindings"],
            release_binding=self.authorization["release_binding"],
            proof=self.proof,
            proof_sha=self.proof_sha,
        )

    def test_previous_or_modified_proof_requires_explicit_reset(self):
        auth = self.authorization
        for changed_source, changed_sha in (
            (HISTORICAL_SOURCE, "2dd17580ddbf5a0fd0433a912e97e6bded04fd0a44ea0849e9da15e13df01e4b"),
            (CURRENT_SOURCE, "a" * 64),
        ):
            with self.subTest(source=changed_source, sha=changed_sha):
                replacement = dict(self.proof, source_commit=changed_source)
                if auth["status"] == "authorized":
                    # A new proof requires an explicit new authorization
                    # ceremony; signed bytes cannot be rebound in-place.
                    with self.assertRaisesRegex(binder.BindingError, "pre-consent state"):
                        binder.bind(ROOT, PROOF_PATH)
                else:
                    with self.assertRaisesRegex(binder.BindingError, "already bound to different bytes"):
                        binder._assert_existing_binding_is_idempotent(
                            status=auth["status"], bindings=auth["bindings"],
                            release_binding=auth["release_binding"], proof=replacement,
                            proof_sha=changed_sha,
                        )


if __name__ == "__main__":
    unittest.main()
