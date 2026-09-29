#!/usr/bin/env python3
"""Source guards for the server-authoritative cloud Memory mutation."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929184500_cloud_memory_atomic_mutation_v1.sql"
PRIVILEGE_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929190000_cloud_memory_atomic_mutation_privilege_boundary_v1.sql"
PAYLOAD_CONTRACT_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929212500_cloud_memory_sync_payload_contract_v1.sql"
LOCAL_FIRST_IDENTITY_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929214500_cloud_memory_local_first_identity_v1.sql"
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
        # Historical v1 deliberately prohibited client-created ids. The later
        # forward-only local-first migration changes that contract safely.
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

    def test_transport_mirror_is_normalized_to_the_runtime_payload_contract(self):
        sql = PAYLOAD_CONTRACT_MIGRATION.read_text(encoding="utf-8")
        lower = sql.lower()
        self.assertIn("ordax.memory-sync-payload/1", sql)
        self.assertIn("ordax.memory/1", sql)
        self.assertIn("'memoryIdentity'", sql)
        self.assertIn("'ownerKind', 'account'", sql)
        self.assertIn("'ownerId', new.owner_user_id::text", sql)
        self.assertIn("'id', v_memory_uuid::text", sql)
        self.assertIn("update private.ordax_sync_objects", lower)
        self.assertIn("update private.ordax_sync_mutations", lower)
        self.assertIn("ordax_memory_canonical_sync_object_payload_v1", lower)
        self.assertIn("ordax_memory_canonical_sync_mutation_payload_v1", lower)
        self.assertIn("ordax_memory_scrub_forgotten_sync_history_v1", lower)
        self.assertNotIn("service_role", lower)
        self.assertNotIn("memory.cloud.enabled', '{\"decision\":\"allowed\"}", lower)

    def test_local_first_identity_is_stable_without_granting_client_authority(self):
        sql = LOCAL_FIRST_IDENTITY_MIGRATION.read_text(encoding="utf-8")
        lower = sql.lower()
        self.assertIn("create or replace function private.ordax_apply_memory_mutation_internal_v1", lower)
        self.assertIn("security definer", lower)
        self.assertIn("v_user_id uuid := (select auth.uid())", lower)
        self.assertIn("memory.cloud.enabled", lower)
        self.assertIn("v_domain_memory_exists boolean := false", lower)
        self.assertIn("v_memory_id := p_memory_id", lower)
        self.assertIn("memory-id-must-be-uuid-v4", lower)
        self.assertIn("memory-id-unavailable", lower)
        self.assertIn("memory-authority-state-inconsistent", lower)
        self.assertIn("elsif not v_domain_memory_exists then", lower)
        self.assertIn("insert into public.ordax_memory_items", lower)
        self.assertIn("insert into private.ordax_sync_mutations", lower)
        self.assertIn("update private.ordax_sync_objects", lower)
        self.assertIn("p_base_server_revision", lower)
        self.assertIn("idempotency-key-reused", lower)
        self.assertNotIn("client-generated-memory-id-not-allowed", lower)
        self.assertNotIn("service_role", lower)
        self.assertNotIn("insert into public.ordax_entitlement_grants", lower)
        self.assertNotIn("update public.ordax_entitlement_grants", lower)


if __name__ == "__main__":
    unittest.main()
