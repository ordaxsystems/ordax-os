import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "public-site" / "require_account_release_ready.py"
SPEC = importlib.util.spec_from_file_location("require_account_release_ready_session", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)

ORIGIN = "https://ordax.com.br"
COMMIT = "a" * 40


class AccountReleaseSessionRevocationProofTests(unittest.TestCase):
    def valid_proof(self):
        return {
            "$schema": "prototype-ordax.account-session-revocation-proof/1",
            "status": "pass",
            "scope": "local",
            "gateway_origin": ORIGIN,
            "source_commit": COMMIT,
            "workflow_run_id": "123",
            "two_independent_sessions": True,
            "session_a_anonymous_after_logout": True,
            "revoked_session_restore_rejected": True,
            "session_b_remained_authenticated": True,
            "credentials_persisted": False,
            "account_identifier_recorded": False,
            "sensitive_auth_material_recorded": False,
        }

    def test_exact_public_origin_and_commit_pass(self):
        self.assertEqual(
            MODULE.validate_session_revocation_proof(self.valid_proof(), ORIGIN, COMMIT),
            [],
        )

    def test_receipt_must_have_exact_sanitized_fields_and_bounded_run_id(self):
        proof = self.valid_proof()
        proof["new_sensitive_property"] = "must-not-persist"
        proof["workflow_run_id"] = "secret-token"
        blockers = MODULE.validate_session_revocation_proof(proof, ORIGIN, COMMIT)
        self.assertIn("session-revocation-proof-field-set", blockers)
        self.assertIn("session-revocation-proof-workflow-run-id", blockers)
        proof.pop("new_sensitive_property")
        proof["workflow_run_id"] = None
        self.assertEqual(MODULE.validate_session_revocation_proof(proof, ORIGIN, COMMIT), [])

    def test_native_or_other_origin_cannot_release_public_account(self):
        proof = self.valid_proof()
        proof["gateway_origin"] = "https://example.supabase.co"
        blockers = MODULE.validate_session_revocation_proof(proof, ORIGIN, COMMIT)
        self.assertIn("session-revocation-proof-origin-mismatch", blockers)

    def test_old_commit_cannot_release_new_deployment(self):
        blockers = MODULE.validate_session_revocation_proof(
            self.valid_proof(), ORIGIN, "b" * 40
        )
        self.assertIn("session-revocation-proof-source-commit-mismatch", blockers)

    def test_each_revocation_invariant_is_fail_closed(self):
        for key in (
            "two_independent_sessions",
            "session_a_anonymous_after_logout",
            "revoked_session_restore_rejected",
            "session_b_remained_authenticated",
        ):
            proof = self.valid_proof()
            proof[key] = False
            blockers = MODULE.validate_session_revocation_proof(proof, ORIGIN, COMMIT)
            self.assertIn(f"session-revocation-proof-{key}", blockers)

    def test_sanitization_flags_are_mandatory(self):
        for key in (
            "credentials_persisted",
            "account_identifier_recorded",
            "sensitive_auth_material_recorded",
        ):
            proof = self.valid_proof()
            proof[key] = True
            blockers = MODULE.validate_session_revocation_proof(proof, ORIGIN, COMMIT)
            self.assertIn(f"session-revocation-proof-{key}", blockers)

    def test_malformed_origin_or_commit_is_rejected(self):
        with self.assertRaises(ValueError):
            MODULE.validate_session_revocation_proof(self.valid_proof(), "http://ordax.com.br", COMMIT)
        with self.assertRaises(ValueError):
            MODULE.validate_session_revocation_proof(self.valid_proof(), ORIGIN, "not-a-sha")


if __name__ == "__main__":
    unittest.main()
