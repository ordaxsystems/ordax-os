import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "infra" / "supabase" / "functions" / "ordax-account-lifecycle" / "index.ts"


class AccountLifecycleEdgeTests(unittest.TestCase):
    def setUp(self):
        self.text = SOURCE.read_text(encoding="utf-8")

    def test_account_close_is_disabled_by_default_and_requires_recent_auth(self):
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", self.text)
        self.assertIn('const CLOSE_CONFIRMATION = "close-account";', self.text)
        self.assertIn("MAX_FRESH_TOKEN_AGE_SECONDS = 5 * 60", self.text)
        self.assertIn("recent-authentication-required", self.text)
        self.assertIn("auth.getUser(token)", self.text)

    def test_service_role_is_isolated_to_dedicated_lifecycle_service(self):
        self.assertIn("SUPABASE_SERVICE_ROLE_KEY", self.text)
        self.assertIn('auth.admin.signOut(token, "global")', self.text)
        self.assertIn("auth.admin.deleteUser(userId)", self.text)
        public_gateway = (
            ROOT
            / "infra"
            / "supabase"
            / "functions"
            / "ordax-account-gateway"
            / "index.ts"
        ).read_text(encoding="utf-8")
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", public_gateway)
        self.assertNotIn("auth.admin.signOut", public_gateway)
        self.assertNotIn("auth.admin.deleteUser", public_gateway)

    def test_close_requires_explicit_confirmation_before_admin_delete(self):
        confirmation = self.text.index("payload.confirmation !== CLOSE_CONFIRMATION")
        revoke = self.text.index('auth.admin.signOut(token, "global")')
        delete = self.text.index("auth.admin.deleteUser(userId)")
        self.assertLess(confirmation, revoke)
        self.assertLess(revoke, delete)

    def test_close_fails_closed_if_global_session_revocation_fails(self):
        revoke = self.text.index('auth.admin.signOut(token, "global")')
        failure = self.text.index("account-close-session-revocation-failed")
        delete = self.text.index("auth.admin.deleteUser(userId)")
        self.assertLess(revoke, failure)
        self.assertLess(failure, delete)

    def test_public_gateway_close_source_is_disabled_and_has_no_admin_key(self):
        public_gateway = (
            ROOT
            / "infra"
            / "supabase"
            / "functions"
            / "ordax-account-gateway"
            / "index.ts"
        ).read_text(encoding="utf-8")
        self.assertIn("const ACCOUNT_CLOSE_ENABLED = false;", public_gateway)
        self.assertIn('path === "/account/close" && req.method === "POST"', public_gateway)
        self.assertIn("/functions/v1/ordax-account-lifecycle/close", public_gateway)
        self.assertIn("signInWithPassword", public_gateway)
        self.assertNotIn("SUPABASE_SERVICE_ROLE_KEY", public_gateway)
        self.assertNotIn("auth.admin.deleteUser", public_gateway)

    def test_health_reports_disabled_state(self):
        self.assertIn('service: "ordax-account-lifecycle"', self.text)
        self.assertIn("accountCloseEnabled: ACCOUNT_CLOSE_ENABLED", self.text)


if __name__ == "__main__":
    unittest.main()
