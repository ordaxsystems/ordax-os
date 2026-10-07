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
    / "20261007034500_public_login_legal_receipt_guard_v1.sql"
)
EDGE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"


class PublicLoginLegalReceiptGuardTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.edge = EDGE.read_text(encoding="utf-8")

    def test_receipt_projection_is_service_role_only_and_search_path_locked(self):
        self.assertIn(
            "create or replace function public.ordax_account_has_registration_legal_receipt_v1",
            self.sql,
        )
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertIn("private.ordax_account_legal_receipts", self.sql)
        self.assertRegex(
            self.sql,
            re.compile(
                r"revoke\s+all\s+on\s+function\s+"
                r"public\.ordax_account_has_registration_legal_receipt_v1\(uuid\)"
                r"\s+from\s+public,\s*anon,\s*authenticated,\s*service_role"
            ),
        )
        self.assertIn(
            "grant execute on function public.ordax_account_has_registration_legal_receipt_v1(uuid)",
            self.sql,
        )
        self.assertIn("to service_role", self.sql)

    def test_public_login_checks_receipt_before_issuing_cookies(self):
        start = self.edge.index("async function credentials(req: Request, register: boolean)")
        end = self.edge.index("function exactObjectKeys", start)
        source = self.edge[start:end]
        self.assertIn("!register && publicSiteRequest(req)", source)
        self.assertIn("hasRegistrationLegalReceipt(result.data.user?.id)", source)
        self.assertIn('signOut({ scope: "local" })', self.edge)
        self.assertIn('"account-legal-receipt-required"', source)
        self.assertIn('"account-legal-receipt-check-unavailable"', source)
        guard = source.index("hasRegistrationLegalReceipt")
        cookies = source.index("const cookies = sessionCookies")
        self.assertLess(guard, cookies)

    def test_native_login_does_not_require_public_legal_receipt_projection(self):
        start = self.edge.index("async function credentials(req: Request, register: boolean)")
        end = self.edge.index("function exactObjectKeys", start)
        source = self.edge[start:end]
        self.assertIn("!register && publicSiteRequest(req)", source)
        self.assertNotIn("hasRegistrationLegalReceipt", source.split("if (!register && publicSiteRequest(req))", 1)[0])


if __name__ == "__main__":
    unittest.main()
