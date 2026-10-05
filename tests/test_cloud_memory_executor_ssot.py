import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "cloud-memory-sync-boundary.json"
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261005033000_private_domain_executors_v1.sql"
)


class CloudMemoryExecutorSsotTests(unittest.TestCase):
    def setUp(self):
        self.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.implementation = self.contract["implementation"]

    def test_contract_records_current_domain_executor_boundary(self):
        impl = self.implementation
        self.assertEqual(impl["security_mode"], "domain-executor-definer-wrapper")
        self.assertEqual(impl["public_wrapper_owner"], "ordax_memory_executor")
        self.assertTrue(impl["public_wrapper_security_definer"])
        self.assertTrue(impl["public_wrapper_search_path_pinned_empty"])
        self.assertEqual(
            impl["public_wrapper_execute"],
            {"anon": False, "authenticated": True, "service_role": True},
        )
        self.assertEqual(
            impl["private_helper"],
            "private.ordax_apply_memory_mutation_internal_v1",
        )
        self.assertEqual(impl["private_helper_owner"], "postgres")
        self.assertTrue(impl["private_helper_security_definer"])
        self.assertTrue(impl["private_helper_search_path_pinned_empty"])
        self.assertEqual(
            impl["private_helper_execute"],
            {
                "anon": False,
                "authenticated": False,
                "service_role": False,
                "ordax_memory_executor": True,
            },
        )
        self.assertTrue(impl["authenticated_security_definer_execute_intentional"])
        self.assertTrue(impl["authenticated_authority_limited_to_public_wrapper"])
        self.assertFalse(impl["api_roles_direct_private_helper_execute_allowed"])

    def test_executor_role_contract_matches_fail_closed_migration(self):
        executor = self.implementation["executor_role"]
        self.assertEqual(
            executor,
            {
                "login": False,
                "inherit": False,
                "bypass_rls": False,
                "superuser": False,
                "create_db": False,
                "create_role": False,
                "replication": False,
                "direct_table_grants": False,
                "owned_relations": False,
                "public_schema_create": False,
            },
        )
        match = re.search(
            r"create\s+role\s+ordax_memory_executor(?P<body>[^;]+);",
            self.sql,
            re.DOTALL,
        )
        self.assertIsNotNone(match)
        body = match.group("body")
        for token in (
            "nosuperuser",
            "nocreatedb",
            "nocreaterole",
            "noinherit",
            "nologin",
            "noreplication",
            "nobypassrls",
        ):
            self.assertIn(token, body)
        self.assertIn("direct table grant detected", self.sql)
        self.assertIn("executor owns relation", self.sql)
        self.assertIn("create privilege leaked", self.sql)

    def test_private_helper_is_not_directly_executable_by_api_roles(self):
        helper = "private.ordax_apply_memory_mutation_internal_v1"
        start = self.sql.index(f"revoke all on function {helper}")
        tail = self.sql[start : start + 2200]
        self.assertIn(
            "from public, anon, authenticated, service_role, ordax_network_executor, ordax_memory_executor",
            tail,
        )
        self.assertIn(f"grant execute on function {helper}", tail)
        self.assertIn("to ordax_memory_executor", tail)
        self.assertIn("api role still executes private domain helper", self.sql)

    def test_public_wrapper_is_the_intentional_authenticated_boundary(self):
        signature = "public.ordax_apply_memory_mutation_v1"
        start = self.sql.index(f"alter function {signature}")
        tail = self.sql[start : start + 5000]
        self.assertIn("security definer", tail)
        self.assertIn("set search_path = '';", tail)
        self.assertIn("owner to ordax_memory_executor", tail)
        self.assertRegex(
            tail,
            r"revoke\s+all\s+on\s+function\s+public\.ordax_apply_memory_mutation_v1[\s\S]*?"
            r"from\s+public,\s*anon,\s*authenticated,\s*service_role\s*;",
        )
        self.assertRegex(
            tail,
            r"grant\s+execute\s+on\s+function\s+public\.ordax_apply_memory_mutation_v1[\s\S]*?"
            r"to\s+authenticated,\s*service_role\s*;",
        )

    def test_rollout_stays_disabled_while_security_ssot_is_reconciled(self):
        self.assertFalse(self.contract["public_mvp_enabled"])
        self.assertFalse(self.implementation["public_rollout_enabled"])
        self.assertEqual(
            self.implementation["authenticated_proof"]["status"],
            "two-client-source-ready-execution-pending",
        )
        self.assertFalse(
            self.implementation["bidirectional_restore_proof"]["remote_execution_completed"]
        )


if __name__ == "__main__":
    unittest.main()
