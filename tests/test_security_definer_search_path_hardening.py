from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "development"
    / "migrations"
    / "20261005024500_security_definer_search_path_hardening_v1.sql"
)


class SecurityDefinerSearchPathHardeningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_all_four_legacy_privileged_functions_are_hardened(self):
        for signature in (
            "public.ordax_finalize_artifact_upload(uuid, uuid, uuid, uuid)",
            "public.ordax_heartbeat_lease(uuid, uuid, uuid, integer)",
            "public.ordax_reconcile_orphan_commands(uuid)",
            "public.ordax_report_command(\n  uuid, uuid, uuid, text, integer, text, text, jsonb, jsonb, text, uuid\n)",
        ):
            self.assertIn(signature, self.sql)
        self.assertGreaterEqual(self.sql.count("set search_path = ''"), 4)

    def test_reconcile_uses_only_explicit_pg_temp_relation(self):
        self.assertIn("create temp table pg_temp.ordax_orphans_current", self.sql)
        self.assertIn("insert into pg_temp.ordax_orphans_current", self.sql)
        self.assertIn("using pg_temp.ordax_orphans_current", self.sql)
        self.assertIn("from pg_temp.ordax_orphans_current", self.sql)
        self.assertNotIn("create temp table ordax_orphans_current", self.sql)
        self.assertNotIn("using ordax_orphans_current", self.sql)
        self.assertNotIn("from ordax_orphans_current", self.sql)

    def test_browser_roles_are_revoked_and_service_role_is_explicit(self):
        self.assertEqual(self.sql.count("from public, anon, authenticated;"), 4)
        self.assertEqual(self.sql.count("to service_role;"), 4)

    def test_no_insecure_search_path_is_reintroduced(self):
        self.assertNotIn("search_path = public", self.sql)
        self.assertNotIn("search_path = 'public'", self.sql)
        self.assertNotIn("search_path = public, pg_temp", self.sql)
        self.assertNotIn("search_path to 'public'", self.sql)


if __name__ == "__main__":
    unittest.main()
