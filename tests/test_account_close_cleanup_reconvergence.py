import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261005183000_account_close_cleanup_foundation_v2.sql"
CONTRACT = ROOT / "docs/contracts/account-close-cleanup.json"


class AccountCloseCleanupReconvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_rollout_remains_disabled(self):
        self.assertEqual(self.contract["status"], "source-foundation-rollout-disabled")
        self.assertFalse(self.contract["account_close_public_enabled"])
        self.assertFalse(self.contract["worker_enabled"])
        self.assertFalse(self.contract["identity_delete_enabled"])

    def test_private_state_is_not_exposed_to_api_roles(self):
        for relation in (
            "private.ordax_account_close_requests",
            "private.ordax_account_close_cleanup_jobs",
        ):
            self.assertIn(f"revoke all on table {relation}", self.sql.lower())
        self.assertNotRegex(
            self.sql.lower(),
            r"grant\s+(?:select|insert|update|delete|all).*private\.ordax_account_close",
        )

    def test_stale_jwt_predicate_lives_in_policy_schema(self):
        self.assertIn("create function ordax_policy.account_is_closing()", self.sql)
        self.assertIn("grant execute on function ordax_policy.account_is_closing() to authenticated", self.sql)
        self.assertNotIn("grant execute on function private.", self.sql.lower().replace("\n  ", " "))
        self.assertGreaterEqual(self.sql.count("as restrictive for all to authenticated"), 8)
        self.assertGreaterEqual(self.sql.count("not ordax_policy.account_is_closing()"), 16)

    def test_executor_is_non_login_and_service_role_uses_wrappers(self):
        self.assertIn("create role ordax_account_close_executor", self.sql)
        self.assertIn("nologin", self.sql)
        self.assertIn("nobypassrls", self.sql)
        self.assertIn("grant execute on function public.ordax_begin_account_close_v2(uuid) to service_role", self.sql)
        self.assertIn("grant execute on function public.ordax_record_account_close_auth_fence_v2(uuid, uuid) to service_role", self.sql)
        for helper in (
            "private.ordax_begin_account_close_internal_v2",
            "private.ordax_record_account_close_auth_fence_internal_v2",
        ):
            pattern = rf"grant execute on function {re.escape(helper)}\([^;]+\)\s+to service_role"
            self.assertNotRegex(self.sql, pattern)

    def test_shared_space_and_provider_paths_fail_closed(self):
        self.assertIn("account-close-owned-shared-space-requires-transfer", self.sql)
        self.assertIn("m.user_id <> new.subject_user_id", self.sql)
        self.assertIn("m.state = 'active'", self.sql)
        self.assertIn("provider_object_key !~ '^[\\\\/]'", self.sql)
        self.assertIn("provider_object_key !~ '(^|[\\\\/])\\\\.\\\\.?(?:[\\\\/]|$)'", self.sql)

    def test_contract_requires_verified_cleanup_before_identity_delete(self):
        self.assertTrue(self.contract["journal"]["provider_cleanup_required_before_identity_delete"])
        self.assertTrue(self.contract["stale_jwt_fence"]["subject_bound"])
        self.assertFalse(self.contract["stale_jwt_fence"]["caller_supplied_subject"])
        self.assertTrue(self.contract["shared_space_safety"]["owned_space_with_other_active_members_must_be_resolved_first"])
        self.assertIn("zero-user-data-loss-proof", self.contract["activation_gates"])


if __name__ == "__main__":
    unittest.main()
