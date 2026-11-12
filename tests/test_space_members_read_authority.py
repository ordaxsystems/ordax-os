from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261017143000_space_members_action_capabilities_v1.sql"
LATEST_READ_MIGRATION = ROOT / "infra/supabase/product/migrations/20261017190000_space_members_state_actions_v1.sql"


def source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def function_block(sql: str, name: str) -> str:
    match = re.search(
        rf"create(?: or replace)? function {re.escape(name)}.*?\n\$\$;",
        sql,
        re.S | re.I,
    )
    if match is None:
        raise AssertionError(f"function block not found: {name}")
    return match.group(0)


class SpaceMembersReadAuthorityTests(unittest.TestCase):
    def test_members_read_is_bounded_and_uses_canonical_authority(self):
        sql = source()
        block = function_block(sql, "public.ordax_list_space_members_v1")
        self.assertIn("security definer", block.lower())
        self.assertIn("set search_path = ''", block.lower())
        self.assertIn("ordax_policy.can_access_space(p_space_id)", block)
        self.assertIn("ordax_policy.can_admin_space(p_space_id)", block)
        self.assertIn("p_limit < 1 or p_limit > 128", block)
        self.assertIn("order by m.user_id asc", block)
        self.assertIn("p_after_user_id is null or m.user_id > p_after_user_id", block)
        self.assertIn("cross join lateral private.ordax_space_member_action_capabilities_v1", block.lower())

    def test_latest_members_read_projects_meaningful_transitions(self):
        sql = LATEST_READ_MIGRATION.read_text(encoding="utf-8").lower()
        block = function_block(sql, "public.ordax_list_space_members_v1")
        self.assertIn("a.can_suspend and m.state = 'active' as can_suspend", block)
        self.assertIn("a.can_reactivate and m.state = 'suspended' as can_reactivate", block)
        self.assertIn("cross join lateral private.ordax_space_member_action_capabilities_v1", block)
        self.assertIn("ordax_policy.can_access_space(p_space_id)", block)
        self.assertNotIn("update public.ordax_space_members", block)
        self.assertNotIn("delete from public.ordax_space_members", block)

    def test_members_read_exposes_no_mutation_and_is_authenticated_only(self):
        sql = source()
        block = function_block(sql, "public.ordax_list_space_members_v1").lower()
        for forbidden in (
            "insert into public.ordax_space_members",
            "update public.ordax_space_members",
            "delete from public.ordax_space_members",
        ):
            self.assertNotIn(forbidden, block)
        tail = sql.lower()[sql.lower().index("create function public.ordax_list_space_members_v1"):]
        self.assertIn(
            "revoke all on function public.ordax_list_space_members_v1(uuid, uuid, integer)",
            tail,
        )
        self.assertIn(
            "grant execute on function public.ordax_list_space_members_v1(uuid, uuid, integer)",
            tail,
        )
        self.assertIn("to authenticated", tail)

    def test_members_read_projects_only_contract_fields_and_target_actions(self):
        block = function_block(source(), "public.ordax_list_space_members_v1").lower()
        match = re.search(r"returns table\s*\((.*?)\)\s*language", block, re.S)
        self.assertIsNotNone(match)
        fields = [
            line.strip().split()[0].rstrip(",")
            for line in match.group(1).splitlines()
            if line.strip()
        ]
        self.assertEqual(fields, [
            "space_id",
            "user_id",
            "role",
            "state",
            "can_change_role",
            "can_suspend",
            "can_reactivate",
            "can_remove",
            "assignable_roles",
        ])

    def test_target_action_helper_is_private_and_canonical(self):
        sql = source().lower()
        helper = function_block(sql, "private.ordax_space_member_action_capabilities_v1")
        self.assertIn("p_actor_user_id <> p_target_user_id", helper)
        self.assertIn("not coalesce(p_target_is_owner, false)", helper)
        self.assertIn("p_target_role <> 'admin'", helper)
        self.assertIn("array['admin', 'member', 'viewer']::text[]", helper)
        self.assertIn("array['member', 'viewer']::text[]", helper)
        self.assertIn(
            "revoke all on function private.ordax_space_member_action_capabilities_v1",
            sql,
        )
        self.assertNotRegex(
            sql,
            r"grant\s+execute\s+on\s+function\s+private\.ordax_space_member_action_capabilities_v1",
        )

    def test_mutation_reuses_target_projection_and_preserves_replay_order(self):
        block = function_block(source(), "public.ordax_mutate_space_membership_v1").lower()
        receipt = block.index("from private.ordax_space_membership_action_receipts")
        replay_return = block.index("return query", receipt)
        projection = block.index("from private.ordax_space_member_action_capabilities_v1", replay_return)
        self.assertLess(receipt, replay_return)
        self.assertLess(replay_return, projection)
        self.assertIn("v_actor_can_admin := ordax_policy.can_admin_space(p_space_id)", block[:receipt])
        self.assertIn("v_role = any(coalesce(v_capability.assignable_roles", block)
        self.assertNotIn("p_target_user_id = v_actor then", block)
        self.assertNotIn("v_target.role = 'admin'\n    or", block)
        self.assertNotIn("v_role = 'admin'", block)


if __name__ == "__main__":
    unittest.main()
