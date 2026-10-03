import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261003123000_account_close_cleanup_journal_v1.sql"
LIFECYCLE = ROOT / "infra/supabase/functions/ordax-account-lifecycle/index.ts"


class AccountCloseCleanupSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.lifecycle = LIFECYCLE.read_text(encoding="utf-8")

    def test_close_journal_survives_identity_deletion(self):
        request_table = self.sql.split("create table private.ordax_account_close_requests", 1)[1].split(");", 1)[0]
        self.assertIn("subject_user_id uuid not null", request_table)
        self.assertNotIn("references auth.users", request_table)
        self.assertIn("state text not null default 'cleanup-pending'", request_table)
        self.assertIn("identity_deleted_at", request_table)

    def test_external_provider_references_are_copied_before_auth_deletion(self):
        self.assertIn("private.ordax_account_close_cleanup_jobs", self.sql)
        self.assertIn("from public.ordax_user_objects o", self.sql)
        self.assertIn("from private.ordax_user_upload_reservations r", self.sql)
        self.assertIn("provider_object_key", self.sql)
        self.assertIn("on delete restrict", self.sql)
        self.assertIn("durable external-object deletion queue", self.sql)

    def test_outstanding_signed_uploads_cannot_race_cleanup(self):
        self.assertIn("r.expires_at + interval '30 seconds'", self.sql)
        self.assertIn("not_before <= statement_timestamp()", self.sql)
        self.assertIn("ordax_user_upload_reservations_close_write_freeze", self.sql)

    def test_account_close_freezes_storage_memory_and_sync_growth(self):
        for trigger in (
            "ordax_user_objects_close_write_freeze",
            "ordax_user_upload_reservations_close_write_freeze",
            "ordax_memory_items_close_write_freeze",
            "ordax_sync_objects_close_write_freeze",
            "ordax_sync_mutations_close_write_freeze",
        ):
            self.assertIn(trigger, self.sql)
        self.assertIn("account-close-cloud-writes-frozen", self.sql)

    def test_cleanup_queue_is_server_only_and_leased(self):
        self.assertIn(
            "revoke all on table private.ordax_account_close_cleanup_jobs\n  from public, anon, authenticated, service_role",
            self.sql,
        )
        self.assertIn("for update skip locked", self.sql)
        self.assertIn("attempts < 10", self.sql)
        self.assertIn("lease_expires_at", self.sql)
        self.assertIn("cleanup-retry-budget-exhausted", self.sql)

    def test_only_service_role_can_invoke_close_cleanup_rpcs(self):
        for signature in (
            "public.ordax_begin_account_close_v1(uuid)",
            "public.ordax_claim_account_close_cleanup_v1(uuid, integer, integer)",
            "public.ordax_finish_account_close_cleanup_v1(uuid, uuid, boolean, text)",
            "public.ordax_verify_account_close_cleanup_v1(uuid, uuid)",
            "public.ordax_mark_account_closed_v1(uuid, uuid)",
        ):
            self.assertIn(f"revoke all on function {signature}\n  from public, anon, authenticated", self.sql)
            self.assertIn(f"grant execute on function {signature}\n  to service_role", self.sql)

    def test_identity_delete_must_be_after_cleanup_verification_in_lifecycle(self):
        # The service remains disabled, but source must never regress to direct delete.
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", self.lifecycle)
        if "auth.admin.deleteUser(userId)" in self.lifecycle:
            verify = self.lifecycle.find("ordax_verify_account_close_cleanup_v1")
            delete = self.lifecycle.find("auth.admin.deleteUser(userId)")
            self.assertGreaterEqual(verify, 0, "identity deletion requires cleanup verification first")
            self.assertLess(verify, delete, "cleanup verification must precede identity deletion")


if __name__ == "__main__":
    unittest.main()
