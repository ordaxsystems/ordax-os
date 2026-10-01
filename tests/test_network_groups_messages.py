#!/usr/bin/env python3
"""Source regressions for OrdaX Network groups/messages boundary."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261001043000_network_groups_messages_v1.sql"


class NetworkGroupsMessagesTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_all_collaboration_tables_are_rls_and_rpc_only(self):
        tables = (
            "public.ordax_network_groups",
            "public.ordax_network_group_memberships",
            "public.ordax_network_conversations",
            "public.ordax_network_conversation_members",
            "public.ordax_network_messages",
            "public.ordax_network_blocks",
            "public.ordax_network_reports",
            "private.ordax_network_rate_windows",
            "private.ordax_network_audit_events",
        )
        for table in tables:
            self.assertIn(f"alter table {table} enable row level security", self.sql)
        for table in tables[:-1]:
            self.assertIn(
                f"revoke all on table {table} from public, anon, authenticated",
                self.sql,
            )

    def test_direct_threads_have_one_pair_identity(self):
        self.assertIn("direct_pair_key text unique", self.sql)
        self.assertIn("ordax_network_direct_pair_key_v1", self.sql)
        self.assertIn("on conflict (direct_pair_key)", self.sql)

    def test_message_send_is_idempotent_and_bounded(self):
        self.assertIn("unique (sender_space_id, client_idempotency_key)", self.sql)
        self.assertIn("network-message-idempotency-conflict", self.sql)
        self.assertIn("char_length(body) between 1 and 4000", self.sql)
        self.assertIn("p_limit > 100", self.sql)
        self.assertIn(
            "(m.created_at, m.message_id) < (p_before_created_at, p_before_message_id)",
            self.sql,
        )
        self.assertNotIn(" offset ", self.sql)

    def test_rate_limits_are_server_side_and_bounded(self):
        self.assertIn("private.ordax_network_rate_windows", self.sql)
        self.assertIn("ordax_network_consume_rate_v1", self.sql)
        self.assertIn("network-rate-limit-exceeded", self.sql)
        for operation in (
            "group-create",
            "group-join",
            "direct-create",
            "message-send",
            "block-change",
            "report-create",
        ):
            self.assertIn(f"'{operation}'", self.sql)

    def test_reports_validate_target_existence_and_message_membership(self):
        self.assertIn("network-report-target-not-found", self.sql)
        self.assertIn("m.message_id::text = p_target_id", self.sql)
        self.assertIn("cm.space_id = p_space_id", self.sql)
        self.assertIn("cm.state = 'active'", self.sql)

    def test_block_is_server_enforced_for_direct_chat(self):
        self.assertIn("network-direct-blocked", self.sql)
        self.assertIn("public.ordax_network_blocks", self.sql)
        self.assertIn("ordax_network_assert_conversation_sender_v1", self.sql)

    def test_group_sender_requires_live_group_membership(self):
        self.assertIn("public.ordax_network_group_memberships", self.sql)
        self.assertIn("network-group-membership-required", self.sql)
        self.assertIn("gm.state = 'active'", self.sql)

    def test_public_rpcs_are_invoker_and_private_authority_is_definer(self):
        public_functions = (
            "ordax_network_create_group_v1",
            "ordax_network_join_group_v1",
            "ordax_network_create_direct_v1",
            "ordax_network_send_message_v1",
            "ordax_network_list_messages_v1",
            "ordax_network_set_block_v1",
            "ordax_network_create_report_v1",
        )
        for name in public_functions:
            section = self.sql.split(
                f"create or replace function public.{name}", 1
            )[1].split("revoke all on function", 1)[0]
            self.assertIn("security invoker", section)
            self.assertNotIn("security definer", section)

        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)

    def test_audit_does_not_store_message_body(self):
        section = self.sql.split(
            "create table private.ordax_network_audit_events", 1
        )[1].split(");", 1)[0]
        self.assertNotIn("body", section)
        self.assertNotIn("email", section)
        self.assertNotIn("reason", section)


if __name__ == "__main__":
    unittest.main()
