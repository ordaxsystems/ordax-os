#!/usr/bin/env python3
"""Regression guard for the persistent Product OAuth authority migration."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261002140612_product_oauth_authority_v1.sql"
)


class ProductOAuthAuthorityMigrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.lower = cls.sql.lower()

    def test_private_tables_are_rls_closed_without_browser_or_service_direct_grants(self):
        tables = (
            "ordax_product_oauth_clients",
            "ordax_product_oauth_codes",
            "ordax_product_oauth_grants",
            "ordax_product_oauth_access_tokens",
        )
        for table in tables:
            self.assertIn(f"create table private.{table}", self.lower)
            self.assertIn(f"alter table private.{table} enable row level security", self.lower)
            self.assertIn(f"revoke all on table private.{table}", self.lower)
        self.assertNotIn("grant select on table private.ordax_product_oauth_", self.lower)
        self.assertNotIn("grant insert on table private.ordax_product_oauth_", self.lower)

    def test_raw_codes_tokens_secrets_and_refresh_tokens_are_not_persisted(self):
        for forbidden in (
            "authorization_code text",
            "access_token text",
            "refresh_token text",
            "client_secret text",
            "provider_token text",
        ):
            self.assertNotIn(forbidden, self.lower)
        self.assertIn("code_hash text primary key", self.lower)
        self.assertIn("token_hash text primary key", self.lower)
        self.assertIn("^[0-9a-f]{64}$", self.sql)

    def test_public_rpcs_are_server_only_security_definers_with_empty_search_path(self):
        rpcs = (
            "ordax_product_oauth_get_client_v1",
            "ordax_product_oauth_can_act_as_space_v1",
            "ordax_product_oauth_issue_code_v1",
            "ordax_product_oauth_consume_code_v1",
            "ordax_product_oauth_issue_access_token_v1",
            "ordax_product_oauth_resolve_access_token_v1",
            "ordax_product_oauth_revoke_access_token_v1",
            "ordax_product_oauth_revoke_grant_v1",
        )
        for rpc in rpcs:
            section = self.lower.split(f"function public.{rpc}", 1)[1]
            self.assertIn("security definer", section)
            self.assertIn("set search_path = ''", section)
            self.assertIn(f"grant execute on function public.{rpc}", self.lower)
        self.assertNotIn("to anon", self.lower.split("grant execute on function public.ordax_product_oauth_", 1)[1])
        self.assertNotIn("to authenticated", self.lower.split("grant execute on function public.ordax_product_oauth_", 1)[1])

    def test_pkce_mismatch_consumes_code_before_comparison(self):
        consume = self.lower.split(
            "function public.ordax_product_oauth_consume_code_v1", 1
        )[1].split(
            "function public.ordax_product_oauth_issue_access_token_v1", 1
        )[0]
        consumed = consume.index("set consumed_at = statement_timestamp()")
        compare = consume.index("v_code.code_challenge <> p_code_challenge")
        self.assertLess(consumed, compare)

    def test_space_authority_is_current_owner_or_admin_only(self):
        helper = self.lower.split(
            "function private.ordax_product_oauth_can_act_as_space_v1", 1
        )[1].split(
            "revoke all on function private.ordax_product_oauth_can_act_as_space_v1", 1
        )[0]
        self.assertIn("s.state = 'active'", helper)
        self.assertIn("s.kind = 'professional'", helper)
        self.assertIn("s.owner_user_id = p_user_id", helper)
        self.assertIn("m.role in ('owner','admin')", helper)
        self.assertNotIn("'member'", helper)
        self.assertNotIn("'viewer'", helper)

    def test_acheguese_seed_is_disabled_without_invented_redirect(self):
        self.assertIn("'acheguese-web-01'", self.sql)
        self.assertIn("'ordax:first-party:acheguese'", self.sql)
        self.assertIn("'{}'::text[]", self.sql)
        self.assertIn("'disabled'", self.sql)
        for scope in (
            "network.space.read",
            "network.directory.read",
            "network.communities.read",
        ):
            self.assertIn(scope, self.sql)


if __name__ == "__main__":
    unittest.main()
