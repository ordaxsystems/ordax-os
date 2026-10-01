#!/usr/bin/env python3
"""Source regressions for Network group discovery and inbox."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261001044500_network_inbox_groups_v1.sql"


class NetworkInboxGroupsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_group_discovery_is_bounded_and_membership_scoped(self):
        self.assertIn("ordax_network_assert_community_member_v1", self.sql)
        self.assertIn("p_limit > 50", self.sql)
        self.assertIn(
            "(g.title, g.group_id) > (p_after_title, p_after_group_id)",
            self.sql,
        )
        self.assertIn("g.join_policy = 'members'", self.sql)
        self.assertIn("gm.state = 'active'", self.sql)

    def test_owner_cannot_leave_without_transfer(self):
        self.assertIn("network-group-owner-transfer-required", self.sql)
        self.assertIn("set state = 'left'", self.sql)
        self.assertIn("ordax_network_conversation_members", self.sql)

    def test_inbox_is_cursor_paginated_and_space_scoped(self):
        self.assertIn("mine.space_id = p_space_id", self.sql)
        self.assertIn("mine.state = 'active'", self.sql)
        self.assertIn("p_limit > 50", self.sql)
        self.assertIn("coalesce(c.last_message_at, c.created_at)", self.sql)
        self.assertNotIn(" offset ", self.sql)

    def test_mark_read_revalidates_conversation_authority(self):
        self.assertIn("ordax_network_assert_conversation_sender_v1", self.sql)
        self.assertIn("last_read_at = timezone('utc', now())", self.sql)

    def test_public_endpoints_are_security_invoker(self):
        for name in (
            "ordax_network_list_groups_v1",
            "ordax_network_leave_group_v1",
            "ordax_network_list_conversations_v1",
            "ordax_network_mark_read_v1",
        ):
            section = self.sql.split(
                f"create or replace function public.{name}", 1
            )[1].split("revoke all on function", 1)[0]
            self.assertIn("security invoker", section)
            self.assertNotIn("security definer", section)


if __name__ == "__main__":
    unittest.main()
