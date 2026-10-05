import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261005025500_sync_private_least_privilege_v2.sql"
SOURCES = (
    ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925004832_account_sync_private_store_v1.sql",
    ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013355_account_sync_incremental_cursor_v1.sql",
    ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013524_account_sync_atomic_snapshot_v1.sql",
    ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925031000_account_data_export_v1.sql",
)


class SyncPrivateLeastPrivilegeV2Tests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_executor_cannot_login_inherit_or_bypass_rls(self):
        match = re.search(r"create role ordax_sync_executor(?P<body>[^;]+);", self.sql, re.DOTALL)
        self.assertIsNotNone(match)
        body = match.group("body")
        for required in ("nologin", "noinherit", "nobypassrls"):
            self.assertIn(required, body)
        for forbidden in ("superuser", "createrole", "createdb"):
            self.assertNotIn(forbidden, body)

    def test_application_roles_lose_all_direct_sync_transport_authority(self):
        for relation in ("private.ordax_sync_objects", "private.ordax_sync_mutations"):
            self.assertRegex(
                self.sql,
                rf"revoke\s+all\s+on\s+table\s+{re.escape(relation)}\s+from\s+public,\s*anon,\s*authenticated\s*;",
            )
        self.assertIn(
            "revoke all on sequence private.ordax_sync_mutations_change_seq_seq from public, anon, authenticated;",
            self.sql,
        )

    def test_rpc_acl_is_reasserted_and_never_defaults_to_public(self):
        names = (
            "ordax_apply_sync_mutation_v1",
            "ordax_apply_sync_mutation_v2",
            "ordax_pull_sync_changes_v1",
            "ordax_list_sync_objects_v1",
            "ordax_sync_snapshot_v1",
            "ordax_sync_snapshot_page_v2",
            "ordax_account_export_v1",
        )
        for name in names:
            self.assertRegex(self.sql, rf"revoke\s+all\s+on\s+function\s+public\.{name}\s*\(")
        self.assertNotIn("grant execute on all functions", self.sql)

    def test_sync_rpcs_move_to_executor_but_export_does_not(self):
        for name in (
            "ordax_apply_sync_mutation_v1",
            "ordax_apply_sync_mutation_v2",
            "ordax_pull_sync_changes_v1",
            "ordax_list_sync_objects_v1",
            "ordax_sync_snapshot_v1",
            "ordax_sync_snapshot_page_v2",
        ):
            start = self.sql.index(f"alter function public.{name}")
            self.assertIn("security definer", self.sql[start:start + 400])
            self.assertIn("owner to ordax_sync_executor", self.sql[start:start + 800])
        export = self.sql[self.sql.index("alter function public.ordax_account_export_v1"):]
        self.assertIn("security definer", export)
        self.assertNotIn("ordax_account_export_v1()\n  owner to ordax_sync_executor", export)

    def test_create_privilege_exists_only_during_owner_transfer(self):
        grant = self.sql.index("grant create on schema public to ordax_sync_executor;")
        owner = self.sql.index("owner to ordax_sync_executor;")
        revoke = self.sql.index("revoke create on schema public from ordax_sync_executor;")
        self.assertLess(grant, owner)
        self.assertGreater(revoke, owner)

    def test_existing_definitions_are_search_path_pinned_and_subject_bound(self):
        source = "\n".join(path.read_text(encoding="utf-8").lower() for path in SOURCES)
        for name in (
            "ordax_apply_sync_mutation_v1",
            "ordax_apply_sync_mutation_v2",
            "ordax_pull_sync_changes_v1",
            "ordax_list_sync_objects_v1",
            "ordax_sync_snapshot_v1",
            "ordax_account_export_v1",
        ):
            start = source.find(f"function public.{name}")
            self.assertNotEqual(start, -1, name)
            tail = source[start:start + 16000]
            self.assertIn("set search_path = ''", tail, name)
            self.assertIn("auth.uid()", tail, name)


if __name__ == "__main__":
    unittest.main()
