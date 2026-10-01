#!/usr/bin/env python3
"""Source regressions for the first OrdaX Network backend slice."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261001040000_network_directory_communities_v1.sql"
CONTRACT = ROOT / "docs" / "contracts" / "network-foundation.json"
AFFILIATIONS = ROOT / "system" / "network" / "profile-affiliations.json"


class NetworkBackendFoundationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_tables_are_rpc_only_and_rls_enabled(self):
        for table in (
            "public.ordax_network_space_profiles",
            "public.ordax_network_communities",
            "public.ordax_network_memberships",
            "private.ordax_network_membership_audit",
        ):
            self.assertIn(f"alter table {table} enable row level security", self.sql)
        self.assertIn(
            "revoke all on table public.ordax_network_space_profiles from public, anon, authenticated",
            self.sql,
        )
        self.assertIn(
            "revoke all on table public.ordax_network_memberships from public, anon, authenticated",
            self.sql,
        )

    def test_mutations_revalidate_space_authority_server_side(self):
        self.assertIn("private.ordax_network_assert_space_actor_v1", self.sql)
        self.assertIn("select auth.uid()", self.sql)
        self.assertIn("s.state = 'active'", self.sql)
        self.assertIn("s.kind = 'professional'", self.sql)
        self.assertIn("m.state = 'active'", self.sql)
        self.assertIn("p_require_admin", self.sql)
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)

    def test_membership_retries_are_idempotent(self):
        self.assertIn("if v_row.state = 'active' then", self.sql)
        self.assertIn("if v_row.state = 'left' then", self.sql)
        self.assertIn("for update", self.sql)

    def test_no_auto_join_or_auto_publication_path_is_seeded(self):
        self.assertIn("p_visibility text default 'hidden'", self.sql)
        self.assertNotIn("insert into public.ordax_network_memberships\nselect", self.sql)
        self.assertIn("'explicit-consent'", self.sql)
        self.assertIn("'industry.food.pizzeria.br'", self.sql)

    def test_directory_and_membership_reads_are_bounded(self):
        self.assertIn("p_limit integer default 20", self.sql)
        self.assertIn("p_limit > 50", self.sql)
        self.assertIn("(p.public_name, p.space_id) > (p_after_name, p_after_space_id)", self.sql)
        self.assertIn("p_limit integer default 100", self.sql)

    def test_private_audit_omits_message_or_account_content(self):
        audit_section = self.sql.split(
            "create table private.ordax_network_membership_audit", 1
        )[1].split(");", 1)[0]
        self.assertNotIn("email", audit_section)
        self.assertNotIn("message", audit_section)
        self.assertNotIn("content", audit_section)

    def test_contract_and_affiliation_files_are_present(self):
        self.assertTrue(CONTRACT.is_file())
        self.assertTrue(AFFILIATIONS.is_file())


if __name__ == "__main__":
    unittest.main()
