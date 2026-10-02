#!/usr/bin/env python3
"""Source regressions for the first OrdaX Network backend slice."""

from pathlib import Path
import json
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

    def test_public_network_rpcs_never_hold_definer_authority(self):
        for public_rpc in (
            "ordax_network_list_directory_v1",
            "ordax_network_list_communities_v1",
            "ordax_network_list_my_memberships_v1",
        ):
            section = self.sql.split(
                f"create or replace function public.{public_rpc}", 1
            )[1].split("revoke all on function", 1)[0]
            self.assertIn("security invoker", section)
            self.assertNotIn("security definer", section)

        for private_rpc in (
            "private.ordax_network_list_directory_internal_v1",
            "private.ordax_network_list_communities_internal_v1",
            "private.ordax_network_list_my_memberships_internal_v1",
        ):
            self.assertIn(private_rpc, self.sql)

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

    def test_directory_prefix_search_has_collation_safe_index(self):
        self.assertIn("lower(public_name) text_pattern_ops", self.sql)
        self.assertIn("lower(p.public_name) like", self.sql)

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

    def test_contract_records_applied_backend_without_public_activation(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertEqual(
            contract["status"],
            "mvp-backend-applied-public-activation-disabled",
        )
        implementation = contract["implementation"]
        self.assertTrue(implementation["backend_schema_applied"])
        self.assertTrue(implementation["v1_foundation_applied"])
        self.assertEqual(
            implementation["v2_mutations_applied"],
            [
                "message-send",
                "direct-create",
                "block-change",
                "group-join",
                "report-create",
                "group-create",
            ],
        )
        self.assertFalse(implementation["direct_browser_table_grants"])
        self.assertFalse(implementation["public_network_enabled"])

    def test_retention_and_tombstone_policy_is_explicit_and_deterministic(self):
        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        policy = contract["retention_tombstone_policy"]
        self.assertEqual(policy["version"], 1)
        self.assertEqual(policy["profile_pack_removal"], "no-network-state-change")
        deletion = policy["space_or_account_deletion"]
        self.assertEqual(deletion["directory_profile"], "cascade-with-space")
        self.assertEqual(deletion["community_membership"], "cascade-with-space")
        self.assertEqual(deletion["group_membership"], "cascade-with-space")
        self.assertEqual(deletion["conversation_membership"], "cascade-with-space")
        self.assertEqual(deletion["blocks"], "cascade-with-space")
        self.assertEqual(
            deletion["owned_group"],
            "retain-tombstoned-owner-and-archive",
        )
        self.assertEqual(
            deletion["owned_group_conversation"],
            "close-on-owner-loss",
        )
        self.assertEqual(
            deletion["messages"],
            "retain-content-tombstone-sender-attribution",
        )
        self.assertEqual(
            deletion["reports"],
            "retain-content-tombstone-reporter-and-creator-attribution",
        )
        self.assertEqual(
            deletion["audit_events"],
            "retain-event-tombstone-actor-attribution",
        )
        self.assertFalse(policy["automatic_time_based_message_purge"])
        self.assertFalse(policy["user_message_delete_in_mvp"])
        self.assertEqual(
            policy["retained_collaborative_content_expiry"],
            "none-in-mvp",
        )


if __name__ == "__main__":
    unittest.main()
