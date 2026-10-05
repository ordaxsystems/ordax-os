from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261005164500_user_cloud_storage_foundation_v2.sql"
CONTRACT = ROOT / "docs/contracts/user-cloud-storage.json"


class UserCloudStorageSourceTests(unittest.TestCase):
    def test_migration_uses_hardened_policy_boundary(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn("ordax_policy.can_access_space(space_id)", sql)
        self.assertNotIn("private.ordax_can_access_space", sql)
        self.assertIn("revoke all on table private.ordax_user_object_bindings", sql)
        self.assertIn("revoke all on table private.ordax_user_upload_reservations", sql)
        self.assertNotIn("grant select on table private.", sql.lower())
        self.assertNotIn("grant insert on table private.", sql.lower())
        self.assertNotIn("grant update on table private.", sql.lower())
        self.assertNotIn("grant delete on table private.", sql.lower())

    def test_api_roles_cannot_mutate_metadata_or_private_relations(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        self.assertIn(
            "revoke all on table public.ordax_user_objects from public, anon, authenticated, service_role;",
            sql,
        )
        self.assertIn("grant select on table public.ordax_user_objects to authenticated;", sql)
        for role in ("anon", "authenticated", "service_role"):
            self.assertNotIn(f"grant insert on table public.ordax_user_objects to {role}", sql.lower())
            self.assertNotIn(f"grant update on table public.ordax_user_objects to {role}", sql.lower())
            self.assertNotIn(f"grant delete on table public.ordax_user_objects to {role}", sql.lower())

    def test_provider_binding_is_not_in_public_metadata_table(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        public_table = sql.split("create table public.ordax_user_objects (", 1)[1].split(");", 1)[0]
        self.assertNotIn("provider_bucket", public_table)
        self.assertNotIn("provider_object_key", public_table)
        self.assertIn("create table private.ordax_user_object_bindings", sql)

    def test_rollout_contract_remains_disabled(self):
        import json

        contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        self.assertFalse(contract["public_rollout_enabled"])
        self.assertTrue(contract["mvp_required"])
        self.assertEqual(contract["quota_key"], "storage.user.bytes")
        self.assertFalse(contract["database_boundary"]["private_schema_api_roles_allowed"])
        self.assertFalse(contract["database_boundary"]["service_role_direct_private_authority_allowed"])
        self.assertFalse(contract["database_boundary"]["runtime_mutation_boundary_enabled"])


if __name__ == "__main__":
    unittest.main()
