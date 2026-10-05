import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
FOUNDATION = ROOT / "infra/supabase/product/migrations/20261005183000_account_close_cleanup_foundation_v2.sql"
RPC = ROOT / "infra/supabase/product/migrations/20261005184500_account_close_cleanup_rpc_v2.sql"
CONTRACT = ROOT / "docs/contracts/account-close-cleanup.json"

CORE_FENCED_RELATIONS = (
    "ordax_accounts",
    "ordax_spaces",
    "ordax_space_members",
    "ordax_entitlement_grants",
    "ordax_memory_items",
    "ordax_memory_embeddings",
    "ordax_project_connections",
    "ordax_user_objects",
)


class AccountCloseCleanupReconvergenceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.foundation = FOUNDATION.read_text(encoding="utf-8")
        cls.rpc = RPC.read_text(encoding="utf-8")
        cls.sql = cls.foundation + "\n" + cls.rpc
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_rollout_remains_disabled(self):
        self.assertEqual(self.contract["status"], "source-foundation-rollout-disabled")
        self.assertFalse(self.contract["account_close_public_enabled"])
        self.assertFalse(self.contract["worker_enabled"])
        self.assertFalse(self.contract["identity_delete_enabled"])
        self.assertFalse(self.contract["cleanup_rpc"]["identity_delete_side_effect"])
        self.assertFalse(self.contract["stale_jwt_fence"]["authenticated_rpc_denial_proven"])
        self.assertFalse(
            self.contract["stale_jwt_fence"]["global_authenticated_data_plane_denial_proven"]
        )

    def test_private_state_is_not_exposed_to_api_roles(self):
        for relation in (
            "private.ordax_account_close_requests",
            "private.ordax_account_close_cleanup_jobs",
        ):
            self.assertIn(f"revoke all on table {relation}", self.foundation.lower())
        self.assertNotRegex(
            self.sql.lower(),
            r"grant\s+(?:select|insert|update|delete|all).*private\.ordax_account_close",
        )

    def test_stale_jwt_predicate_lives_in_policy_schema(self):
        normalized = re.sub(r"\s+", " ", self.sql.lower())
        self.assertIn("create function ordax_policy.account_is_closing()", self.foundation)
        self.assertIn("grant execute on function ordax_policy.account_is_closing() to authenticated", self.foundation)
        private_helpers = (
            "private.ordax_begin_account_close_internal_v2(uuid)",
            "private.ordax_record_account_close_auth_fence_internal_v2(uuid, uuid)",
            "private.ordax_list_account_close_work_internal_v2(integer)",
            "private.ordax_claim_account_close_cleanup_internal_v2(uuid, integer, integer)",
            "private.ordax_finish_account_close_cleanup_internal_v2(uuid, uuid, boolean, text)",
            "private.ordax_verify_account_close_cleanup_internal_v2(uuid, uuid)",
        )
        for helper in private_helpers:
            self.assertIn(
                f"grant execute on function {helper} to ordax_account_close_executor",
                normalized,
            )
            for api_role in ("public", "anon", "authenticated", "service_role"):
                self.assertNotRegex(
                    normalized,
                    rf"grant execute on function {re.escape(helper)} to (?:[^;]*,\s*)?{api_role}(?:\s*,|;)",
                )

    def test_stale_jwt_core_relation_coverage_is_exact_and_not_overclaimed(self):
        fence = self.contract["stale_jwt_fence"]
        self.assertEqual(fence["coverage_status"], "core-relations-only")
        self.assertEqual(tuple(fence["covered_relations"]), CORE_FENCED_RELATIONS)

        foundation = re.sub(r"\s+", " ", self.foundation.lower())
        for relation in CORE_FENCED_RELATIONS:
            self.assertIn(
                f"on public.{relation} as restrictive for all to authenticated",
                foundation,
            )

        self.assertEqual(
            self.foundation.count("as restrictive for all to authenticated"),
            len(CORE_FENCED_RELATIONS),
        )
        self.assertEqual(
            self.foundation.count("not ordax_policy.account_is_closing()"),
            len(CORE_FENCED_RELATIONS) * 2,
        )
        self.assertFalse(fence["authenticated_rpc_denial_proven"])
        self.assertFalse(fence["global_authenticated_data_plane_denial_proven"])
        self.assertIn("stale-jwt-data-plane-denial-proof", self.contract["activation_gates"])

    def test_executor_is_non_login_and_service_role_uses_wrappers(self):
        self.assertIn("create role ordax_account_close_executor", self.foundation)
        self.assertIn("nologin", self.foundation)
        self.assertIn("nobypassrls", self.foundation)
        for wrapper in (
            "public.ordax_begin_account_close_v2(uuid)",
            "public.ordax_record_account_close_auth_fence_v2(uuid, uuid)",
            "public.ordax_list_account_close_work_v2(integer)",
            "public.ordax_claim_account_close_cleanup_v2(uuid, integer, integer)",
            "public.ordax_finish_account_close_cleanup_v2(uuid, uuid, boolean, text)",
            "public.ordax_verify_account_close_cleanup_v2(uuid, uuid)",
        ):
            self.assertIn(f"grant execute on function {wrapper} to service_role", re.sub(r"\s+", " ", self.sql))

    def test_cleanup_rpc_is_bounded_and_lease_safe(self):
        rpc = self.rpc.lower()
        policy = self.contract["cleanup_rpc"]
        self.assertTrue(policy["source_ready"])
        self.assertTrue(policy["server_only"])
        self.assertIn("p_limit < 1 or p_limit > 20", rpc)
        self.assertIn("p_limit < 1 or p_limit > 100", rpc)
        self.assertIn("p_lease_seconds < 30 or p_lease_seconds > 600", rpc)
        self.assertIn("j.attempts < 10", rpc)
        self.assertIn("for update skip locked", rpc)
        self.assertIn("j.lease_token = p_lease_token", rpc)
        self.assertIn("j.lease_expires_at > statement_timestamp()", rpc)
        self.assertIn("j.lease_expires_at <= statement_timestamp()", rpc)
        self.assertEqual(policy["retry_budget"], 10)
        self.assertEqual(policy["lease_seconds_min"], 30)
        self.assertEqual(policy["lease_seconds_max"], 600)

    def test_verification_cannot_delete_identity(self):
        rpc = self.rpc.lower()
        self.assertIn("v_remaining = 0 and v_auth_ready", rpc)
        self.assertIn("ready_for_identity_delete", rpc)
        self.assertNotIn("auth.admin", rpc)
        self.assertNotRegex(rpc, r"delete\s+from\s+auth\.users")
        self.assertNotRegex(rpc, r"delete\s+user")

    def test_shared_space_and_provider_paths_fail_closed(self):
        self.assertIn("account-close-owned-shared-space-requires-transfer", self.foundation)
        self.assertIn("m.user_id <> new.subject_user_id", self.foundation)
        self.assertIn("m.state = 'active'", self.foundation)
        self.assertIn("provider_object_key !~ '^[\\\\/]'", self.foundation)
        self.assertIn("provider_object_key !~ '(^|[\\\\/])\\\\.\\\\.?(?:[\\\\/]|$)'", self.foundation)

    def test_contract_requires_verified_cleanup_before_identity_delete(self):
        self.assertTrue(self.contract["journal"]["provider_cleanup_required_before_identity_delete"])
        self.assertTrue(self.contract["stale_jwt_fence"]["subject_bound"])
        self.assertFalse(self.contract["stale_jwt_fence"]["caller_supplied_subject"])
        self.assertTrue(self.contract["cleanup_rpc"]["verification_requires_auth_fence"])
        self.assertTrue(self.contract["cleanup_rpc"]["verification_requires_zero_remaining_jobs"])
        self.assertTrue(self.contract["shared_space_safety"]["owned_space_with_other_active_members_must_be_resolved_first"])
        self.assertIn("zero-user-data-loss-proof", self.contract["activation_gates"])


if __name__ == "__main__":
    unittest.main()
