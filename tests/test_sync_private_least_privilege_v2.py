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

    def test_executor_attributes_are_reasserted_even_if_role_already_exists(self):
        create = re.search(r"create role ordax_sync_executor\s*;", self.sql)
        self.assertIsNotNone(create)
        alter = re.search(
            r"alter\s+role\s+ordax_sync_executor\s+with(?P<body>[^;]+);",
            self.sql,
            re.DOTALL,
        )
        self.assertIsNotNone(alter)
        body = alter.group("body")
        for required in (
            "nosuperuser",
            "nocreatedb",
            "nocreaterole",
            "noinherit",
            "nologin",
            "noreplication",
            "nobypassrls",
        ):
            self.assertIn(required, body)
        self.assertNotIn("bypassrls", body.replace("nobypassrls", ""))
        self.assertNotIn("superuser", body.replace("nosuperuser", ""))

    def test_executor_receives_only_sync_transport_relation_rights(self):
        self.assertIn("revoke all on schema private from ordax_sync_executor;", self.sql)
        self.assertIn("revoke all on schema auth from ordax_sync_executor;", self.sql)
        self.assertIn("grant usage on schema private to ordax_sync_executor;", self.sql)
        self.assertIn("grant usage on schema auth to ordax_sync_executor;", self.sql)
        self.assertIn("grant execute on function auth.uid() to ordax_sync_executor;", self.sql)
        self.assertIn(
            "grant select, insert, update on table private.ordax_sync_objects to ordax_sync_executor;",
            self.sql,
        )
        self.assertIn(
            "grant select, insert on table private.ordax_sync_mutations to ordax_sync_executor;",
            self.sql,
        )
        self.assertIn(
            "grant usage, select on sequence private.ordax_sync_mutations_change_seq_seq to ordax_sync_executor;",
            self.sql,
        )
        self.assertNotIn("grant delete on table private.ordax_sync_objects to ordax_sync_executor", self.sql)
        self.assertNotIn("grant delete on table private.ordax_sync_mutations to ordax_sync_executor", self.sql)

    def test_sync_policies_are_executor_only(self):
        policies = (
            "ordax_sync_objects_select_own",
            "ordax_sync_objects_insert_own",
            "ordax_sync_objects_update_own",
            "ordax_sync_mutations_select_own",
            "ordax_sync_mutations_insert_own",
        )
        for policy in policies:
            pattern = rf"alter\s+policy\s+{policy}[^;]*to\s+ordax_sync_executor\s*;"
            self.assertRegex(self.sql, pattern, policy)
        self.assertNotRegex(
            self.sql,
            r"alter\s+policy\s+ordax_sync_(?:objects|mutations)_[a-z_]+[^;]*to[^;]*authenticated",
        )

    def test_application_and_service_roles_lose_all_direct_sync_transport_authority(self):
        for relation in ("private.ordax_sync_objects", "private.ordax_sync_mutations"):
            self.assertRegex(
                self.sql,
                rf"revoke\s+all\s+on\s+table\s+{re.escape(relation)}\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;",
            )
        self.assertRegex(
            self.sql,
            r"revoke\s+all\s+on\s+sequence\s+private\.ordax_sync_mutations_change_seq_seq\s+"
            r"from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;",
        )

    def test_rpc_acl_is_exactly_authenticated_not_public_or_service_role(self):
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
            self.assertRegex(
                self.sql,
                rf"revoke\s+all\s+on\s+function\s+public\.{name}\s*\([^;]*?\)\s+"
                r"from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;",
            )
            self.assertRegex(
                self.sql,
                rf"grant\s+execute\s+on\s+function\s+public\.{name}\s*\([^;]*?\)\s+to\s+authenticated\s*;",
            )
        self.assertNotIn("grant execute on all functions", self.sql)
        self.assertNotRegex(
            self.sql,
            r"grant\s+execute\s+on\s+function\s+public\.ordax_(?:apply_sync|pull_sync|list_sync|sync_snapshot|account_export)[^;]*"
            r"to[^;]*service_role",
        )

    def test_sync_rpcs_move_to_executor_and_reassert_empty_search_path(self):
        for name in (
            "ordax_apply_sync_mutation_v1",
            "ordax_apply_sync_mutation_v2",
            "ordax_pull_sync_changes_v1",
            "ordax_list_sync_objects_v1",
            "ordax_sync_snapshot_v1",
            "ordax_sync_snapshot_page_v2",
        ):
            start = self.sql.index(f"alter function public.{name}")
            tail = self.sql[start:start + 1200]
            self.assertIn("security definer", tail)
            self.assertIn("set search_path = ''", tail)
            self.assertIn("owner to ordax_sync_executor", tail)
        export = self.sql[self.sql.index("alter function public.ordax_account_export_v1"):]
        self.assertIn("security definer", export)
        self.assertIn("set search_path = ''", export)
        self.assertNotIn("ordax_account_export_v1()\n  owner to ordax_sync_executor", export)

    def test_create_privilege_exists_only_during_owner_transfer(self):
        grant = self.sql.index("grant create on schema public to ordax_sync_executor;")
        owner = self.sql.index("owner to ordax_sync_executor;")
        revoke = self.sql.index("revoke create on schema public from ordax_sync_executor;")
        self.assertLess(grant, owner)
        self.assertGreater(revoke, owner)
        self.assertEqual(self.sql.count("grant create on schema public to ordax_sync_executor;"), 1)
        self.assertEqual(self.sql.count("revoke create on schema public from ordax_sync_executor;"), 1)

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
