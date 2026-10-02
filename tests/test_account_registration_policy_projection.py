from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261002225800_account_registration_policy_projection_v1.sql"
)


class AccountRegistrationPolicyProjectionTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8")
        self.lower = self.sql.lower()

    def test_active_policy_requires_canonical_https_document_urls(self):
        self.assertIn("add column privacy_url text", self.lower)
        self.assertIn("add column terms_url text", self.lower)
        self.assertIn("ordax_account_legal_policies_active_urls_chk", self.lower)
        self.assertIn("state <> 'active'", self.lower)
        self.assertIn("privacy_url is not null", self.lower)
        self.assertIn("terms_url is not null", self.lower)
        self.assertIn("^https://", self.lower)

    def test_policy_becomes_immutable_after_activation(self):
        self.assertIn(
            "create or replace function private.ordax_guard_account_legal_policy_update_v1()",
            self.lower,
        )
        self.assertIn("old.state in ('active', 'retired')", self.lower)
        self.assertIn("ordax-account-legal-policy-immutable-after-activation", self.lower)
        self.assertIn("ordax-account-legal-policy-retired-is-terminal", self.lower)
        self.assertIn("ordax-account-legal-policy-active-may-only-retire", self.lower)
        self.assertIn(
            "create trigger ordax_account_legal_policy_update_guard_v1",
            self.lower,
        )

    def test_projection_rpc_is_service_role_only(self):
        self.assertIn(
            "create or replace function public.ordax_get_account_registration_legal_policy_v1()",
            self.lower,
        )
        self.assertIn("security definer", self.lower)
        self.assertIn("set search_path = ''", self.lower)
        self.assertRegex(
            self.lower,
            re.compile(
                r"revoke\s+all\s+on\s+function\s+"
                r"public\.ordax_get_account_registration_legal_policy_v1\(\)"
                r"\s+from\s+public,\s*anon,\s*authenticated"
            ),
        )
        self.assertIn(
            "grant execute on function public.ordax_get_account_registration_legal_policy_v1()",
            self.lower,
        )
        self.assertIn("to service_role", self.lower)

    def test_projection_returns_only_active_effective_policy_and_does_not_seed_one(self):
        self.assertIn("where p.state = 'active'", self.lower)
        self.assertIn("p.privacy_effective_date <= current_date", self.lower)
        self.assertIn("p.terms_effective_date <= current_date", self.lower)
        self.assertNotRegex(
            self.lower,
            re.compile(r"insert\s+into\s+private\.ordax_account_legal_policies"),
        )


if __name__ == "__main__":
    unittest.main()
