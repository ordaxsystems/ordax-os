from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929122500_account_memory_sync_guard_v1.sql"
CURSOR_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013355_account_sync_incremental_cursor_v1.sql"
GATEWAY_POLICY = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "memory-sync-policy.mjs"
GATEWAY = ROOT / "infra" / "supabase" / "functions" / "ordax-account-gateway" / "index.ts"


class AccountMemoryBackendGuardTests(unittest.TestCase):
    def test_memory_guard_extends_canonical_rpc_without_second_sync_path(self):
        sql = MIGRATION.read_text(encoding="utf-8")
        lower = sql.lower()
        cursor_sql = CURSOR_MIGRATION.read_text(encoding="utf-8").lower()

        self.assertIn("create or replace function public.ordax_apply_sync_mutation_v1", lower)
        self.assertIn("'memory'", lower)
        self.assertIn("security invoker", lower)
        self.assertIn("auth.uid()", lower)
        self.assertNotIn("security definer", lower)
        self.assertNotIn("service_role", lower)
        self.assertNotIn("create table", lower)
        self.assertNotIn("create schema", lower)
        self.assertNotIn("ordax_apply_memory_sync", lower)
        self.assertIn("from public.ordax_apply_sync_mutation_v1", cursor_sql)
        self.assertIn("ordax_apply_sync_mutation_v2", cursor_sql)

    def test_sql_guard_binds_owner_versions_scope_sensitivity_and_stable_identity(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("p_object_schema_version <> 1", sql)
        self.assertIn("p_resolver_version <> 1", sql)
        self.assertIn("v_memory->>'ownerkind' is distinct from 'account'", sql)
        self.assertIn("v_memory->>'ownerid' is distinct from v_user_id::text", sql)
        self.assertIn("v_identity->>'ownerid' is distinct from v_user_id::text", sql)
        self.assertIn("v_memory->>'scope' not in ('account','space','project')", sql)
        self.assertIn("v_memory->>'sensitivity' not in ('normal','private')", sql)
        self.assertIn("'ordax.memory-sync-payload/1'", sql)
        self.assertIn("'ordax.memory/1'", sql)
        self.assertIn("'memory/' || rtrim", sql)
        self.assertIn("convert_to(v_memory_id, 'utf8')", sql)
        self.assertIn("invalid-memory-stable-object-id", sql)

    def test_sql_guard_is_null_safe_and_requires_exact_json_types(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("not (p_payload ? 'schema')", sql)
        self.assertIn("jsonb_typeof(p_payload->'schema') is distinct from 'string'", sql)
        self.assertIn("jsonb_typeof(v_identity->'ownerid') is distinct from 'string'", sql)
        self.assertIn("jsonb_typeof(v_memory->'ownerid') is distinct from 'string'", sql)
        self.assertIn("jsonb_typeof(v_memory->'content') is distinct from 'string'", sql)
        self.assertIn("jsonb_typeof(v_memory->'spaceid') is distinct from 'null'", sql)
        self.assertIn("p_stable_object_id is distinct from v_expected_object_id", sql)

    def test_sql_guard_rejects_never_sync_material_and_tombstones_never_carry_content(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("private key", sql)
        self.assertIn("authorization[[:space:]]*:[[:space:]]*bearer", sql)
        self.assertIn("(access|refresh)[_-]?token", sql)
        self.assertIn("password[[:space:]]*[:=]", sql)
        self.assertIn("memory-never-sync-material", sql)
        self.assertIn("p_payload ? 'memoryidentity'", sql)
        self.assertIn("p_payload ? 'memory'", sql)
        self.assertIn("invalid-memory-sync-tombstone", sql)

    def test_idempotency_key_is_bound_to_exact_mutation(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("idempotency-key-reused-for-different-mutation", sql)
        self.assertIn("v_mutation.data_class is distinct from p_data_class", sql)
        self.assertIn("v_mutation.stable_object_id is distinct from p_stable_object_id", sql)
        self.assertIn("v_mutation.payload is distinct from p_payload", sql)
        self.assertIn("v_mutation.tombstone is distinct from p_tombstone", sql)

    def test_gateway_policy_reuses_canonical_memory_sync_validator_but_memory_remains_disabled(self):
        policy = GATEWAY_POLICY.read_text(encoding="utf-8")
        gateway = GATEWAY.read_text(encoding="utf-8")
        self.assertIn("validateMemorySyncMutation", policy)
        self.assertIn("system/services/sync/account-memory-runtime.mjs", policy)
        data_classes = gateway.split("const DATA_CLASSES = new Set([", 1)[1].split("]);", 1)[0]
        self.assertNotIn('"memory"', data_classes)
        self.assertIn('"appearance"', data_classes)
        self.assertIn('"preferences"', data_classes)
        self.assertIn('"workspace-metadata"', data_classes)


if __name__ == "__main__":
    unittest.main()
