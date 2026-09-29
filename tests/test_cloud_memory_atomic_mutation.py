#!/usr/bin/env python3
"""Source guards for the server-authoritative cloud Memory mutation."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929184500_cloud_memory_atomic_mutation_v1.sql"
PRIVILEGE_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929190000_cloud_memory_atomic_mutation_privilege_boundary_v1.sql"
SERVER_AUTHORITY_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "0004_server_authoritative_mutations.sql"
BOUNDARY = ROOT / "docs" / "contracts" / "cloud-memory-sync-boundary.json"


class CloudMemoryAtomicMutationTests(unittest.TestCase):
    def test_boundary_requires_atomic_server_authority(self):
        contract = json.loads(BOUNDARY.read_text(encoding="utf-8"))
        self.assertFalse(contract["source_of_truth"]["independent_dual_write_allowed"])
        self.assertTrue(contract["source_of_truth"]["server_authoritative_atomic_write_required"])
        self.assertEqual(contract["authorization"]["entitlement_required"], "memory.cloud.enabled")
        self.assertFalse(contract["privacy"]["restricted_memory_cloud_sync_enabled"])
        self.assertFalse(contract["eligible_scopes"]["device"])
        self.assertFalse(contract["eligible_scopes"]["project"])
        self.assertFalse(contract["eligible_scopes"]["session"])

    def test_rpc_is_security_invoker_and_keeps_public_rollout_fail_closed(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("create or replace function public.ordax_apply_memory_mutation_v1", sql)
        self.assertIn("security invoker", sql)
        self.assertIn("set search_path = ''", sql)
        privilege_sql = PRIVILEGE_MIGRATION.read_text(encoding="utf-8").lower()
        authority_sql = SERVER_AUTHORITY_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("security invoker", privilege_sql)
        self.assertIn("private.ordax_apply_memory_mutation_internal_v1", privilege_sql)
        self.assertIn("security definer", privilege_sql)
        self.assertNotIn("create or replace function public.ordax_apply_memory_mutation_internal_v1", privilege_sql)
        self.assertIn("revoke insert, update, delete on table public.ordax_memory_items from authenticated", authority_sql)
        self.assertNotIn("service_role", sql + privilege_sql)
        self.assertIn("memory.cloud.enabled", sql)
        self.assertIn("e.entitlement_value ->> 'decision' = 'allowed'", sql)
        self.assertIn("p_scope not in ('account','space')", sql)
        self.assertIn("restricted-memory-cloud-sync-disabled", sql)
        self.assertIn("private.ordax_can_access_space", sql)
        self.assertIn("client-generated-memory-id-not-allowed", sql)
        self.assertIn("revoke all on function public.ordax_apply_memory_mutation_v1", sql)
        self.assertIn("grant execute on function public.ordax_apply_memory_mutation_v1", sql)

    def test_memory_and_sync_mutate_inside_one_database_function(self):
        sql = MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("insert into private.ordax_sync_objects", sql)
        self.assertIn("update private.ordax_sync_objects", sql)
        self.assertIn("insert into private.ordax_sync_mutations", sql)
        self.assertIn("insert into public.ordax_memory_items", sql)
        self.assertIn("update public.ordax_memory_items", sql)
        self.assertIn("'memory'", sql)
        self.assertIn("p_base_server_revision", sql)
        self.assertIn("idempotency-key-reused", sql)
        self.assertIn("memory-cloud-entitlement-required", sql)
        self.assertIn("'state', 'deleted'", sql)
        self.assertNotIn("ordax_apply_sync_mutation_v2(", sql)


if __name__ == "__main__":
    unittest.main()
