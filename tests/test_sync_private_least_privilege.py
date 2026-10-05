import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261005024000_sync_private_least_privilege_v1.sql"
SYNC_STORE = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925004832_account_sync_private_store_v1.sql"
INCREMENTAL = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013355_account_sync_incremental_cursor_v1.sql"
SNAPSHOT = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013524_account_sync_atomic_snapshot_v1.sql"
EXPORT = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925031000_account_data_export_v1.sql"


class SyncPrivateLeastPrivilegeTests(unittest.TestCase):
    def setUp(self):
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_all_private_table_consuming_public_rpcs_become_definer_boundaries(self):
        expected = (
            "public.ordax_apply_sync_mutation_v1",
            "public.ordax_apply_sync_mutation_v2",
            "public.ordax_pull_sync_changes_v1",
            "public.ordax_list_sync_objects_v1",
            "public.ordax_sync_snapshot_v1",
            "public.ordax_sync_snapshot_page_v2",
            "public.ordax_account_export_v1",
        )
        for function in expected:
            pattern = rf"alter\s+function\s+{re.escape(function)}\s*\([^;]*?\)\s*security\s+definer\s*;"
            self.assertRegex(self.sql, pattern, function)

    def test_sync_executor_is_non_login_non_inheriting_and_cannot_bypass_rls(self):
        role_block = re.search(
            r"create\s+role\s+ordax_sync_executor(?P<body>[^;]+);",
            self.sql,
            re.DOTALL,
        )
        self.assertIsNotNone(role_block)
        body = role_block.group("body")
        self.assertIn("nologin", body)
        self.assertIn("noinherit", body)
        self.assertIn("nobypassrls", body)
        self.assertNotIn("superuser", body)
        self.assertNotIn("createrole", body)
        self.assertNotIn("createdb", body)
        self.assertIn("grant ordax_sync_executor to postgres;", self.sql)
        self.assertNotIn("grant ordax_sync_executor to postgres with admin option", self.sql)
        self.assertNotIn("grant authenticated to ordax_sync_executor", self.sql)
        self.assertNotIn("grant service_role to ordax_sync_executor", self.sql)

    def test_sync_rpc_ownership_is_moved_off_postgres(self):
        sync_rpcs = (
            "public.ordax_apply_sync_mutation_v1",
            "public.ordax_apply_sync_mutation_v2",
            "public.ordax_pull_sync_changes_v1",
            "public.ordax_list_sync_objects_v1",
            "public.ordax_sync_snapshot_v1",
            "public.ordax_sync_snapshot_page_v2",
        )
        for function in sync_rpcs:
            pattern = rf"alter\s+function\s+{re.escape(function)}\s*\([^;]*?\)\s*owner\s+to\s+ordax_sync_executor\s*;"
            self.assertRegex(self.sql, pattern, function)
        self.assertNotRegex(
            self.sql,
            r"alter\s+function\s+public\.ordax_account_export_v1\s*\(\s*\)\s*owner\s+to\s+ordax_sync_executor",
        )

    def test_executor_privileges_are_sync_scoped_and_rls_remains_authoritative(self):
        self.assertIn("grant usage on schema private to ordax_sync_executor;", self.sql)
        self.assertIn("grant usage on schema auth to ordax_sync_executor;", self.sql)
        self.assertIn("grant execute on function auth.uid() to ordax_sync_executor;", self.sql)
        self.assertIn(
            "grant select, insert, update on table private.ordax_sync_objects\n  to ordax_sync_executor;",
            self.sql,
        )
        self.assertIn(
            "grant select, insert on table private.ordax_sync_mutations\n  to ordax_sync_executor;",
            self.sql,
        )
        self.assertIn(
            "grant usage, select on sequence private.ordax_sync_mutations_change_seq_seq\n  to ordax_sync_executor;",
            self.sql,
        )
        for policy in (
            "ordax_sync_objects_select_own",
            "ordax_sync_objects_insert_own",
            "ordax_sync_objects_update_own",
            "ordax_sync_mutations_select_own",
            "ordax_sync_mutations_insert_own",
        ):
            pattern = rf"alter\s+policy\s+{policy}[^;]*to\s+authenticated,\s*ordax_sync_executor\s*;"
            self.assertRegex(self.sql, pattern, policy)

    def test_authenticated_has_no_direct_sync_transport_table_or_sequence_privileges_after_migration(self):
        for table in (
            "private.ordax_sync_objects",
            "private.ordax_sync_mutations",
        ):
            pattern = rf"revoke\s+all\s+on\s+table\s+{re.escape(table)}\s+from\s+public,\s*anon,\s*authenticated\s*;"
            self.assertRegex(self.sql, pattern, table)

        self.assertRegex(
            self.sql,
            r"revoke\s+all\s+on\s+sequence\s+private\.ordax_sync_mutations_change_seq_seq\s+"
            r"from\s+public,\s*anon,\s*authenticated\s*;",
        )
        self.assertNotRegex(
            self.sql,
            r"grant\s+(?:select|insert|update|delete|truncate|references|trigger|all)[^;]*"
            r"on\s+table\s+private\.ordax_sync_(?:objects|mutations)[^;]*to\s+authenticated",
        )
        self.assertNotRegex(
            self.sql,
            r"grant\s+usage\s+on\s+schema\s+private\s+to\s+authenticated",
        )

    def test_existing_rpc_implementations_pin_empty_search_path_and_bind_subject(self):
        sources = "\n".join(
            path.read_text(encoding="utf-8").lower()
            for path in (SYNC_STORE, INCREMENTAL, SNAPSHOT, EXPORT)
        )
        for function in (
            "ordax_apply_sync_mutation_v1",
            "ordax_apply_sync_mutation_v2",
            "ordax_pull_sync_changes_v1",
            "ordax_list_sync_objects_v1",
            "ordax_sync_snapshot_v1",
            "ordax_account_export_v1",
        ):
            start = sources.find(f"function public.{function}")
            self.assertNotEqual(start, -1, function)
            tail = sources[start : start + 14000]
            self.assertIn("set search_path = ''", tail, function)
            self.assertIn("auth.uid()", tail, function)

    def test_account_export_definer_is_read_only_and_explicitly_owner_bound(self):
        source = EXPORT.read_text(encoding="utf-8").lower()
        start = source.index("create or replace function public.ordax_account_export_v1")
        body = source[start:]
        for forbidden in (
            " insert ",
            " update ",
            " delete ",
            " truncate ",
            " execute ",
            " dynamic sql",
        ):
            self.assertNotIn(forbidden, body)
        self.assertIn("auth.uid()", body)
        self.assertIn("where o.owner_user_id = (select user_id from me)", body)
        self.assertIn("set search_path = ''", body)

    def test_hardening_does_not_create_parallel_rpc_or_compatibility_bridge(self):
        self.assertNotIn("create or replace function", self.sql)
        self.assertNotIn("create function", self.sql)
        self.assertNotIn("compatibility bridge", self.sql)
        self.assertNotIn("grant usage on schema private to authenticated", self.sql)


if __name__ == "__main__":
    unittest.main()
