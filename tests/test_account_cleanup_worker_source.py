import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WORKER = ROOT / "infra/supabase/functions/ordax-account-cleanup/index.ts"
AUTH_FENCE_MIGRATION = ROOT / "infra/supabase/product/migrations/20261003124500_account_close_auth_fence_and_worker_v1.sql"
STALE_JWT_MIGRATION = ROOT / "infra/supabase/product/migrations/20261003130000_account_close_shared_space_and_stale_jwt_guard_v1.sql"


class AccountCleanupWorkerSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.worker = WORKER.read_text(encoding="utf-8")
        cls.auth_sql = AUTH_FENCE_MIGRATION.read_text(encoding="utf-8").lower()
        cls.jwt_sql = STALE_JWT_MIGRATION.read_text(encoding="utf-8").lower()

    def test_worker_is_disabled_by_default_and_requires_internal_secret(self):
        self.assertIn("const ACCOUNT_CLEANUP_WORKER_ENABLED = false;", self.worker)
        self.assertIn("ORDAX_ACCOUNT_CLEANUP_WORKER_TOKEN", self.worker)
        self.assertIn("workerToken.length < 32", self.worker)
        self.assertIn('req.headers.get("x-ordax-worker-token")', self.worker)
        self.assertIn("secretEqual", self.worker)

    def test_worker_has_bounded_close_job_and_lease_budgets(self):
        self.assertIn("const MAX_CLOSES_PER_RUN = 10;", self.worker)
        self.assertIn("const MAX_JOBS_PER_CLOSE = 50;", self.worker)
        self.assertIn("const LEASE_SECONDS = 120;", self.worker)
        self.assertIn("ordax_list_account_close_work_v1", self.worker)
        self.assertIn("ordax_claim_account_close_cleanup_v1", self.worker)
        self.assertIn("ordax_finish_account_close_cleanup_v1", self.worker)

    def test_provider_delete_uses_storage_api_not_storage_metadata_sql(self):
        self.assertIn('.storage.from(userBucket).remove([objectKey])', self.worker)
        self.assertNotIn("storage.objects", self.worker.lower())
        self.assertIn('provider !== "supabase-storage"', self.worker)
        self.assertIn("provider-bucket-mismatch", self.worker)
        self.assertIn("unsupported-provider", self.worker)

    def test_worker_verifies_cleanup_and_auth_fence_before_identity_delete(self):
        verify = self.worker.index("ordax_verify_account_close_cleanup_v1")
        identity_lookup = self.worker.index("auth.admin.getUserById")
        delete = self.worker.index("auth.admin.deleteUser")
        mark = self.worker.index("ordax_mark_account_closed_v1")
        self.assertLess(verify, identity_lookup)
        self.assertLess(identity_lookup, delete)
        self.assertLess(delete, mark)
        self.assertIn("verification.ready_for_identity_delete !== true", self.worker)
        self.assertIn("!authFenceReady", self.worker)

    def test_auth_fence_is_durable_and_service_role_only(self):
        self.assertIn("identity_frozen_at timestamptz", self.auth_sql)
        self.assertIn("sessions_revoked_at timestamptz", self.auth_sql)
        self.assertIn("ordax_record_account_close_auth_fence_v1", self.auth_sql)
        self.assertIn("to service_role", self.auth_sql)
        self.assertIn("v_remaining = 0 and v_auth_fence_ready", self.auth_sql)

    def test_stale_access_jwt_is_denied_by_restrictive_rls(self):
        self.assertIn("as restrictive for all to authenticated", self.jwt_sql)
        self.assertIn("ordax_current_account_is_closing_v1", self.jwt_sql)
        for table in (
            "public.ordax_accounts",
            "public.ordax_spaces",
            "public.ordax_space_members",
            "public.ordax_memory_items",
            "public.ordax_user_objects",
            "private.ordax_sync_objects",
            "private.ordax_sync_mutations",
        ):
            self.assertIn(f"on {table} as restrictive", self.jwt_sql)

    def test_shared_owned_space_blocks_destructive_account_close(self):
        self.assertIn("account-close-owned-shared-space-requires-transfer", self.jwt_sql)
        self.assertIn("m.user_id <> new.subject_user_id", self.jwt_sql)
        self.assertIn("before insert on private.ordax_account_close_requests", self.jwt_sql)


if __name__ == "__main__":
    unittest.main()
