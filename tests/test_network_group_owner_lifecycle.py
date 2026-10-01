#!/usr/bin/env python3
"""Regression guards for Network group owner lifecycle."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261001051500_network_group_owner_lifecycle_v1.sql"


class NetworkGroupOwnerLifecycleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_owner_loss_archives_group_and_closes_group_conversation(self):
        self.assertIn("new.state := 'archived'", self.sql)
        self.assertIn("update public.ordax_network_conversations", self.sql)
        self.assertIn("c.state = 'active'", self.sql)
        self.assertIn("set state = 'closed'", self.sql)
        self.assertIn("group-owner-lost", self.sql)

    def test_trigger_is_only_for_real_owner_loss(self):
        self.assertIn("before update of owner_space_id", self.sql)
        self.assertIn(
            "old.owner_space_id is not null and new.owner_space_id is null",
            self.sql,
        )

    def test_lifecycle_trigger_has_no_public_execute_grant(self):
        self.assertIn(
            "revoke all on function private.ordax_network_archive_group_on_owner_loss_v1()",
            self.sql,
        )
        section = self.sql.split(
            "revoke all on function private.ordax_network_archive_group_on_owner_loss_v1()", 1
        )[1].split("create trigger", 1)[0]
        self.assertNotIn("grant execute", section)


if __name__ == "__main__":
    unittest.main()
