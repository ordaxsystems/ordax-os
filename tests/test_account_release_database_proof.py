import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODULE_PATH = ROOT / "tools" / "public-site" / "require_account_release_ready.py"
SPEC = importlib.util.spec_from_file_location("require_account_release_ready_db", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(MODULE)


class AccountReleaseDatabaseProofTests(unittest.TestCase):
    def valid_proof(self):
        return {
            "$schema": "prototype-ordax.control-plane-privilege-proof/1",
            "provider": "supabase-postgres",
            "project_ref": "redacted",
            "checks": {
                "no_anon_table_grants": True,
                "no_anon_function_execute": True,
                "no_public_function_execute": True,
                "security_definer_search_path": True,
                "no_anon_private_schema_usage": True,
                "authenticated_write_allowlist": True,
            },
            "observed": {
                "anon_table_grant_count": 0,
                "anon_function_execute_count": 0,
                "public_function_execute_count": 0,
                "unsafe_security_definer_search_path_count": 0,
                "anon_private_schema_usage": False,
                "unexpected_authenticated_write_grant_count": 0,
                "allowed_authenticated_write_grant_count": 3,
            },
            "ready": True,
        }

    def test_valid_sanitized_database_proof_passes(self):
        self.assertEqual(MODULE.validate_database_proof(self.valid_proof()), [])

    def test_public_execute_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["no_public_function_execute"] = False
        proof["observed"]["public_function_execute_count"] = 1
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-no_public_function_execute", blockers)
        self.assertIn("database-proof-public_function_execute_count", blockers)
        self.assertIn("database-proof-not-ready", blockers)

    def test_unexpected_authenticated_write_blocks_release(self):
        proof = self.valid_proof()
        proof["checks"]["authenticated_write_allowlist"] = False
        proof["observed"]["unexpected_authenticated_write_grant_count"] = 1
        proof["ready"] = False
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-authenticated_write_allowlist", blockers)
        self.assertIn("database-proof-unexpected_authenticated_write_grant_count", blockers)

    def test_database_proof_must_be_sanitized_and_exact(self):
        proof = self.valid_proof()
        proof["project_ref"] = "must-not-be-persisted"
        proof["checks"]["extra"] = True
        blockers = MODULE.validate_database_proof(proof)
        self.assertIn("database-proof-not-sanitized", blockers)
        self.assertIn("database-proof-check-set", blockers)


if __name__ == "__main__":
    unittest.main()
