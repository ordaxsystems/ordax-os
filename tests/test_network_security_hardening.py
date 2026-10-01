#!/usr/bin/env python3
"""Regression guards for OrdaX Network security hardening."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
HARDENING = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261001050000_network_security_hardening_v1.sql"


class NetworkSecurityHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = HARDENING.read_text(encoding="utf-8").lower()

    def test_account_close_cannot_be_blocked_by_network_actor_fks(self):
        for table_column in (
            "ordax_network_memberships\n  alter column joined_by drop not null",
            "ordax_network_groups\n  alter column owner_space_id drop not null",
            "ordax_network_messages\n  alter column sender_space_id drop not null",
            "ordax_network_messages\n  alter column sender_user_id drop not null",
            "ordax_network_reports\n  alter column reporter_space_id drop not null",
        ):
            self.assertIn(table_column, self.sql)

        self.assertIn("on delete set null", self.sql)
        lifecycle_section = self.sql.split(
            "-- 1. account / space lifecycle", 1
        )[1].split("-- 2. bounded rate state", 1)[0]
        self.assertNotIn("on delete restrict", lifecycle_section)

    def test_rate_limiter_keeps_one_window_row_and_returns_decision(self):
        self.assertIn(
            "primary key (actor_user_id, actor_space_id, operation)",
            self.sql,
        )
        self.assertIn("returns boolean", self.sql)
        self.assertIn("return v_count <= p_limit", self.sql)
        self.assertIn("network-rate-actor-mismatch", self.sql)
        rate_function = self.sql.split(
            "create function private.ordax_network_consume_rate_v1", 1
        )[1].split("revoke all on function", 1)[0]
        self.assertNotIn("network-rate-limit-exceeded", rate_function)

    def test_reader_and_sender_authority_are_separate(self):
        self.assertIn("ordax_network_assert_conversation_reader_v1", self.sql)
        sender = self.sql.split(
            "create or replace function private.ordax_network_assert_conversation_sender_v1", 1
        )[1].split("revoke all on function", 1)[0]
        self.assertIn("sm.role in ('owner','admin','member')", sender)
        self.assertIn("network-space-send-authority-required", sender)
        self.assertIn("network-direct-counterparty-unavailable", sender)
        self.assertIn("network-direct-blocked", sender)

        reads = self.sql.split(
            "create or replace function private.ordax_network_list_messages_internal_v1", 1
        )[1].split("-- 4. mutations consume", 1)[0]
        self.assertIn("ordax_network_assert_conversation_reader_v1", reads)

    def test_message_idempotency_is_atomic_under_concurrent_retry(self):
        send = self.sql.split(
            "create or replace function private.ordax_network_send_message_internal_v1", 1
        )[1].split(
            "create or replace function private.ordax_network_set_block_internal_v1", 1
        )[0]
        self.assertIn(
            "on conflict (sender_space_id, client_idempotency_key) do nothing",
            send,
        )
        self.assertIn("network-message-idempotency-conflict", send)
        self.assertIn("network-message-idempotency-resolution-failed", send)
        self.assertIn("delete from public.ordax_network_messages", send)

    def test_unimplemented_invite_only_flow_fails_closed(self):
        group = self.sql.split(
            "create or replace function private.ordax_network_create_group_internal_v1", 1
        )[1].split(
            "create or replace function private.ordax_network_join_group_internal_v1", 1
        )[0]
        self.assertIn("network-group-invite-flow-not-ready", group)
        self.assertIn("p_join_policy <> 'members'", group)

    def test_report_targets_require_visibility_or_membership(self):
        report = self.sql.split(
            "create or replace function private.ordax_network_create_report_internal_v1", 1
        )[1].split("-- old public wrappers remain", 1)[0]
        self.assertIn("p.visibility = 'discoverable'", report)
        self.assertIn("cm.space_id = p_space_id", report)
        self.assertIn("g.join_policy = 'members'", report)
        self.assertIn("or gm.state = 'active'", report)
        self.assertIn("ordax_network_assert_conversation_reader_v1", report)

    def test_private_audit_attribution_is_tombstoned_on_delete(self):
        self.assertIn(
            "ordax_network_audit_events_actor_user_id_fkey", self.sql
        )
        self.assertIn(
            "ordax_network_audit_events_actor_space_id_fkey", self.sql
        )


if __name__ == "__main__":
    unittest.main()
