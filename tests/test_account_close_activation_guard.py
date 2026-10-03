import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LIFECYCLE = ROOT / "infra/supabase/functions/ordax-account-lifecycle/index.ts"
GATEWAY = ROOT / "infra/supabase/functions/ordax-account-gateway/index.ts"
MIGRATION = ROOT / "infra/supabase/product/migrations/20261003123000_account_close_cleanup_journal_v1.sql"


def enabled(source: str) -> bool:
    match = re.search(r"const\s+ACCOUNT_CLOSE_ENABLED\s*=\s*(true|false)\s*;", source)
    if not match:
        raise AssertionError("ACCOUNT_CLOSE_ENABLED constant is missing")
    return match.group(1) == "true"


class AccountCloseActivationGuardTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.lifecycle = LIFECYCLE.read_text(encoding="utf-8")
        cls.gateway = GATEWAY.read_text(encoding="utf-8")
        cls.sql = MIGRATION.read_text(encoding="utf-8")

    def test_lifecycle_never_deletes_identity_before_durable_cleanup_verification(self):
        begin = self.lifecycle.index("ordax_begin_account_close_v1")
        verify = self.lifecycle.index("ordax_verify_account_close_cleanup_v1")
        delete = self.lifecycle.index("auth.admin.deleteUser(userId)")
        finalize = self.lifecycle.index("ordax_mark_account_closed_v1")
        self.assertLess(begin, verify)
        self.assertLess(verify, delete)
        self.assertLess(delete, finalize)
        self.assertIn("ready_for_identity_delete !== true", self.lifecycle)

    def test_closing_identity_is_frozen_server_side_before_delete(self):
        ban = self.lifecycle.index("auth.admin.updateUserById")
        revoke = self.lifecycle.index('auth.admin.signOut(token, "global")')
        delete = self.lifecycle.index("auth.admin.deleteUser(userId)")
        self.assertLess(ban, revoke)
        self.assertLess(revoke, delete)
        self.assertIn("ban_duration: CLOSE_BAN_DURATION", self.lifecycle)

    def test_public_close_remains_disabled_until_async_cleanup_is_end_to_end(self):
        lifecycle_ready = (
            "ordax_claim_account_close_cleanup_v1" in self.lifecycle
            and "ordax_finish_account_close_cleanup_v1" in self.lifecycle
        )
        gateway_handles_pending = "lifecycleResponse.status === 202" in self.gateway
        if not (lifecycle_ready and gateway_handles_pending):
            self.assertFalse(enabled(self.lifecycle))
            self.assertFalse(enabled(self.gateway))

    def test_cleanup_journal_is_not_cascaded_with_auth_user(self):
        request_definition = self.sql.split("create table private.ordax_account_close_requests", 1)[1].split(");", 1)[0]
        self.assertNotIn("references auth.users", request_definition.lower())
        self.assertIn("subject_user_id uuid not null", request_definition.lower())


if __name__ == "__main__":
    unittest.main()
