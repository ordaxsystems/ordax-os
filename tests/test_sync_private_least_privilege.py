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

    def test_authenticated_has_no_direct_sync_transport_table_privileges_after_migration(self):
        for table in (
            "private.ordax_sync_objects",
            "private.ordax_sync_mutations",
        ):
            pattern = rf"revoke\s+all\s+on\s+table\s+{re.escape(table)}\s+from\s+public,\s*anon,\s*authenticated\s*;"
            self.assertRegex(self.sql, pattern, table)

        self.assertNotRegex(
            self.sql,
            r"grant\s+(?:select|insert|update|delete|truncate|references|trigger|all)[^;]*"
            r"on\s+table\s+private\.ordax_sync_(?:objects|mutations)[^;]*to\s+authenticated",
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

    def test_hardening_is_not_a_parallel_rpc_or_compatibility_bridge(self):
        self.assertNotIn("create or replace function", self.sql)
        self.assertNotIn("create function", self.sql)
        self.assertNotIn("legacy", self.sql)
        self.assertNotIn("compat", self.sql)
        self.assertNotIn("grant usage on schema private", self.sql)


if __name__ == "__main__":
    unittest.main()
