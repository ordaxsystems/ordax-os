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
    / "20261007044500_account_legacy_legal_quarantine_v1.sql"
)
LOGIN_GUARD = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261007034500_public_login_legal_receipt_guard_v1.sql"
)


class AccountLegacyLegalQuarantineTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.guard = LOGIN_GUARD.read_text(encoding="utf-8").lower()

    def test_quarantine_is_private_owner_scoped_and_not_client_writable(self):
        self.assertIn(
            "create table private.ordax_account_legal_quarantine",
            self.sql,
        )
        self.assertRegex(
            self.sql,
            re.compile(
                r"user_id\s+uuid\s+primary\s+key\s+"
                r"references\s+auth\.users\(id\)\s+on\s+delete\s+cascade"
            ),
        )
        self.assertIn(
            "check (reason = 'legacy-no-registration-receipt')",
            self.sql,
        )
        self.assertIn(
            "alter table private.ordax_account_legal_quarantine enable row level security",
            self.sql,
        )
        self.assertRegex(
            self.sql,
            re.compile(
                r"revoke\s+all\s+on\s+table\s+"
                r"private\.ordax_account_legal_quarantine\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role"
            ),
        )

    def test_backfill_only_quarantines_accounts_without_real_registration_receipt(self):
        self.assertIn(
            "insert into private.ordax_account_legal_quarantine",
            self.sql,
        )
        self.assertIn("from public.ordax_accounts a", self.sql)
        self.assertIn(
            "from private.ordax_account_legal_receipts r",
            self.sql,
        )
        self.assertIn("r.user_id = a.user_id", self.sql)
        self.assertIn("r.purpose = 'account-registration'", self.sql)
        self.assertIn("on conflict (user_id) do nothing", self.sql)
        self.assertIn(
            "lock table private.ordax_account_legal_receipts in share row exclusive mode",
            self.sql,
        )

    def test_quarantine_never_fabricates_consent_receipts_or_deletes_accounts(self):
        self.assertNotIn(
            "insert into private.ordax_account_legal_receipts",
            self.sql,
        )
        self.assertNotIn("delete from public.ordax_accounts", self.sql)
        self.assertNotIn("delete from auth.users", self.sql)
        self.assertNotIn("update private.ordax_account_legal_receipts", self.sql)

    def test_real_registration_receipt_releases_quarantine_without_deleting_audit_row(self):
        self.assertIn(
            "create or replace function private.release_ordax_account_legal_quarantine_v1()",
            self.sql,
        )
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertIn(
            "after insert on private.ordax_account_legal_receipts",
            self.sql,
        )
        self.assertIn("if new.purpose = 'account-registration' then", self.sql)
        self.assertIn("release_receipt_id = new.receipt_id", self.sql)
        self.assertIn("where q.user_id = new.user_id", self.sql)
        self.assertIn("and q.released_at is null", self.sql)
        self.assertNotIn(
            "delete from private.ordax_account_legal_quarantine",
            self.sql,
        )

    def test_reconciliation_status_is_service_role_only_and_reports_unreconciled_count(self):
        self.assertIn(
            "create or replace function public.ordax_account_legal_reconciliation_status_v1()",
            self.sql,
        )
        self.assertIn("unreconciled_receiptless_accounts bigint", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertRegex(
            self.sql,
            re.compile(
                r"revoke\s+all\s+on\s+function\s+"
                r"public\.ordax_account_legal_reconciliation_status_v1\(\)\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role"
            ),
        )
        self.assertRegex(
            self.sql,
            re.compile(
                r"grant\s+execute\s+on\s+function\s+"
                r"public\.ordax_account_legal_reconciliation_status_v1\(\)\s+"
                r"to\s+service_role"
            ),
        )

    def test_public_login_remains_receipt_authoritative_not_quarantine_authoritative(self):
        self.assertIn(
            "create or replace function public.ordax_account_has_registration_legal_receipt_v1",
            self.guard,
        )
        self.assertIn(
            "private.ordax_account_legal_receipts",
            self.guard,
        )
        self.assertNotIn("ordax_account_legal_quarantine", self.guard)


if __name__ == "__main__":
    unittest.main()
