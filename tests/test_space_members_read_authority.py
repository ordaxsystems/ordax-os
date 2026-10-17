from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261017102000_space_members_read_authority_v1.sql"


def source() -> str:
    return MIGRATION.read_text(encoding="utf-8")


class SpaceMembersReadAuthorityTests(unittest.TestCase):
    def test_members_read_is_bounded_and_uses_canonical_authority(self):
        sql = source()
        self.assertIn("create or replace function public.ordax_list_space_members_v1", sql)
        self.assertIn("security definer", sql)
        self.assertIn("set search_path = ''", sql)
        self.assertIn("ordax_policy.can_access_space(p_space_id)", sql)
        self.assertIn("p_limit < 1 or p_limit > 128", sql)
        self.assertIn("order by m.user_id asc", sql)
        self.assertIn("p_after_user_id is null or m.user_id > p_after_user_id", sql)

    def test_members_read_exposes_no_mutation_and_is_authenticated_only(self):
        sql = source()
        body = re.search(
            r"create or replace function public\.ordax_list_space_members_v1.*?\$\$;(.*?)commit;",
            sql,
            re.S | re.I,
        )
        self.assertIsNotNone(body)
        lowered = body.group(0).lower()
        for forbidden in (
            "insert into public.ordax_space_members",
            "update public.ordax_space_members",
            "delete from public.ordax_space_members",
        ):
            self.assertNotIn(forbidden, lowered)
        self.assertIn(
            "revoke all on function public.ordax_list_space_members_v1(uuid, uuid, integer)",
            lowered,
        )
        self.assertIn("from public, anon, authenticated, service_role", lowered)
        self.assertIn(
            "grant execute on function public.ordax_list_space_members_v1(uuid, uuid, integer)",
            lowered,
        )
        self.assertIn("to authenticated", lowered)

    def test_members_read_returns_only_contract_fields(self):
        sql = source().lower()
        match = re.search(r"returns table\s*\((.*?)\)\s*language", sql, re.S)
        self.assertIsNotNone(match)
        fields = [
            line.strip().split()[0].rstrip(",")
            for line in match.group(1).splitlines()
            if line.strip()
        ]
        self.assertEqual(fields, ["space_id", "user_id", "role", "state"])


if __name__ == "__main__":
    unittest.main()
