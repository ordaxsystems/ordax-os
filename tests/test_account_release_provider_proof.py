import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "public-site" / "require_account_release_ready.py"
SPEC = importlib.util.spec_from_file_location("require_account_release_ready", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AccountReleaseProviderProofTests(unittest.TestCase):
    COMMIT = "a" * 40

    def validate(self, proof, origin="https://ordax.com.br", commit=None, root=ROOT):
        return MODULE.validate_provider_proof(
            proof, origin, commit or self.COMMIT, root
        )

    def valid_proof(self):
        return {
            "$schema": "prototype-ordax.auth-provider-proof/2",
            "provider": "supabase",
            "project_ref": "redacted",
            "project_binding": MODULE.project_binding(
                MODULE.resolve_target(ROOT, "https://ordax.com.br")[0]
            ),
            "source_commit": self.COMMIT,
            "expected_origin": "https://ordax.com.br",
            "checks": {
                "confirm_email": True,
                "password_policy": True,
                "production_origin": True,
                "redirect_allowlist": True,
                "recovery_template": True,
            },
            "observed": {
                "password_min_length": 12,
                "redirect_count": 1,
                "wildcard_redirect_present": False,
                "cross_origin_redirect_present": False,
            },
            "ready": True,
        }

    def test_valid_sanitized_proof_matches_exact_origin(self):
        self.assertEqual(
            self.validate(self.valid_proof(), "https://ordax.com.br"),
            [],
        )

    def test_rejects_malformed_or_extra_sanitized_provider_observations(self):
        proof = self.valid_proof()
        proof["observed"]["redirect_count"] = False
        proof["observed"]["unexpected_email"] = "sensitive-value"
        proof["unreviewed_secret"] = "sensitive-value"
        blockers = self.validate(proof, "https://ordax.com.br")
        self.assertIn("provider-proof-redirect-count", blockers)
        self.assertIn("provider-proof-observation-set", blockers)
        self.assertIn("provider-proof-field-set", blockers)

    def test_origin_mismatch_blocks(self):
        with self.assertRaisesRegex(ValueError, "requested origin"):
            self.validate(self.valid_proof(), "https://www.ordax.com.br")

    def test_wrong_project_or_source_commit_blocks_release(self):
        proof = self.valid_proof()
        proof["project_binding"] = MODULE.project_binding("z" * 20)
        proof["source_commit"] = "b" * 40
        blockers = self.validate(proof)
        self.assertIn("provider-proof-project-binding", blockers)
        self.assertIn("provider-proof-source-commit", blockers)

    def test_proof_must_be_sanitized_and_exact(self):
        proof = self.valid_proof()
        proof["project_ref"] = "real-project-ref-must-not-be-persisted"
        proof["checks"]["extra"] = True
        blockers = self.validate(proof, "https://ordax.com.br")
        self.assertIn("provider-proof-not-sanitized", blockers)
        self.assertIn("provider-proof-check-set", blockers)

    def test_any_red_provider_check_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["confirm_email"] = False
        proof["ready"] = False
        blockers = self.validate(proof, "https://ordax.com.br")
        self.assertIn("provider-proof-confirm_email", blockers)
        self.assertIn("provider-proof-not-ready", blockers)

    def test_weak_password_or_unsafe_redirect_observation_blocks(self):
        proof = self.valid_proof()
        proof["observed"]["password_min_length"] = 8
        proof["observed"]["wildcard_redirect_present"] = True
        proof["observed"]["cross_origin_redirect_present"] = True
        blockers = self.validate(proof, "https://ordax.com.br")
        self.assertIn("provider-proof-password-floor", blockers)
        self.assertIn("provider-proof-wildcard-redirect", blockers)
        self.assertIn("provider-proof-cross-origin-redirect", blockers)

    def test_expected_origin_must_be_clean_https_origin(self):
        for origin in (
            "http://ordax.com.br",
            "https://ordax.com.br/path",
            "https://user@ordax.com.br",
        ):
            with self.assertRaises(ValueError):
                self.validate(self.valid_proof(), origin)


if __name__ == "__main__":
    unittest.main()
