import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261002221427_account_registration_legal_receipt_v1.sql"
)


class AccountRegistrationLegalReceiptMigrationTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8")
        self.lower = self.sql.lower()

    def test_private_authority_tables_are_deny_all_to_clients(self):
        for table in (
            "private.ordax_account_legal_policies",
            "private.ordax_account_registration_intents",
            "private.ordax_account_legal_receipts",
        ):
            with self.subTest(table=table):
                self.assertIn(f"create table {table}", self.lower)
                self.assertIn(f"alter table {table} enable row level security", self.lower)
                self.assertRegex(
                    self.lower,
                    re.compile(
                        rf"revoke\s+all\s+on\s+table\s+{re.escape(table)}"
                        rf"\s+from\s+public,\s*anon,\s*authenticated",
                        re.MULTILINE,
                    ),
                )
        self.assertNotRegex(
            self.lower,
            re.compile(r"grant\s+.*\s+on\s+table\s+private\.ordax_account_legal_"),
        )

    def test_intent_rpc_is_service_role_only_and_hashes_email(self):
        self.assertIn(
            "create or replace function public.ordax_begin_account_registration_legal_intent_v1",
            self.lower,
        )
        self.assertIn("security definer", self.lower)
        self.assertIn("set search_path = ''", self.lower)
        self.assertIn("extensions.digest(convert_to(v_email, 'utf8'), 'sha256')", self.lower)
        self.assertIn("p_accepted is distinct from true", self.lower)
        self.assertIn(
            "revoke all on function public.ordax_begin_account_registration_legal_intent_v1(text, boolean)",
            self.lower,
        )
        self.assertIn(
            "grant execute on function public.ordax_begin_account_registration_legal_intent_v1(text, boolean)",
            self.lower,
        )
        self.assertIn("to service_role", self.lower)
        self.assertNotIn("normalized_email text", self.lower)
        self.assertIn("email_sha256 text not null", self.lower)

    def test_existing_single_account_trigger_function_is_hardened_not_duplicated(self):
        self.assertIn(
            "create or replace function private.handle_ordax_account_created()",
            self.lower,
        )
        self.assertNotIn("create trigger on_auth_user_created_ordax_product", self.lower)
        self.assertNotIn("after insert on auth.users", self.lower)
        self.assertIn("ordax_registration_intent_id", self.lower)
        self.assertIn("for update", self.lower)
        self.assertIn("ordax-registration-legal-intent-required", self.lower)
        self.assertIn("ordax-registration-legal-policy-stale", self.lower)

    def test_receipt_is_created_in_same_trigger_and_versions_come_from_policy(self):
        self.assertIn("insert into private.ordax_account_legal_receipts", self.lower)
        self.assertIn("v_policy.privacy_version", self.lower)
        self.assertIn("v_policy.privacy_effective_date", self.lower)
        self.assertIn("v_policy.privacy_sha256", self.lower)
        self.assertIn("v_policy.terms_version", self.lower)
        self.assertIn("v_policy.terms_effective_date", self.lower)
        self.assertIn("v_policy.terms_sha256", self.lower)
        self.assertIn("unique (user_id, purpose)", self.lower)
        self.assertIn("set consumed_at = statement_timestamp()", self.lower)

    def test_migration_does_not_activate_or_seed_placeholder_legal_policy(self):
        self.assertNotRegex(
            self.lower,
            re.compile(r"insert\s+into\s+private\.ordax_account_legal_policies"),
        )
        self.assertNotIn("'active'::text", self.lower)
        self.assertNotIn("privacy-v1", self.lower)
        self.assertNotIn("terms-v1", self.lower)


if __name__ == "__main__":
    unittest.main()
