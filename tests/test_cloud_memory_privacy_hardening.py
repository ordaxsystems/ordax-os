#!/usr/bin/env python3
"""Source guards for issue #685 cloud Memory privacy hardening."""

from __future__ import annotations

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
BOUNDARY = ROOT / "docs" / "contracts" / "cloud-memory-sync-boundary.json"
SYNC_MODEL = ROOT / "docs" / "contracts" / "sync-model.json"
HARDENING = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929193000_cloud_memory_privacy_hardening_v1.sql"
OLD_GENERIC_GUARD = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260929122500_account_memory_sync_guard_v1.sql"
PULL_MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20260925013355_account_sync_incremental_cursor_v1.sql"


class CloudMemoryPrivacyHardeningTests(unittest.TestCase):
    def test_dedicated_atomic_rpc_remains_the_only_memory_mutation_backend(self):
        boundary = json.loads(BOUNDARY.read_text(encoding="utf-8"))
        self.assertEqual(boundary["implementation"]["rpc"], "public.ordax_apply_memory_mutation_v1")
        self.assertFalse(boundary["implementation"]["generic_sync_rpc_accepts_memory"])
        self.assertFalse(boundary["implementation"]["public_rollout_enabled"])
        self.assertFalse(OLD_GENERIC_GUARD.exists())

    def test_hardening_rejects_known_never_sync_material_at_storage_boundary(self):
        sql = HARDENING.read_text(encoding="utf-8").lower()
        self.assertIn("ordax_memory_reject_never_sync_material_v1", sql)
        self.assertIn("memory-never-sync-material", sql)
        self.assertIn("private key", sql)
        self.assertIn("authorization", sql)
        self.assertIn("bearer", sql)
        self.assertIn("access|refresh", sql)
        self.assertIn("password", sql)
        self.assertNotIn("create or replace function public.ordax_apply_sync_mutation_v1", sql)
        self.assertNotIn("create or replace function public.ordax_apply_sync_mutation_v2", sql)

    def test_forget_scrubs_replayable_history_without_deleting_cursor_rows(self):
        hardening = HARDENING.read_text(encoding="utf-8").lower()
        pull = PULL_MIGRATION.read_text(encoding="utf-8").lower()
        self.assertIn("ordax_memory_scrub_forgotten_sync_history_v1", hardening)
        self.assertIn("update private.ordax_sync_mutations", hardening)
        self.assertIn("mutation_kind = 'delete'", hardening)
        self.assertIn("tombstone = true", hardening)
        self.assertIn("stable_object_id = new.memory_id::text", hardening)
        self.assertNotIn("delete from private.ordax_sync_mutations", hardening)
        self.assertIn("m.change_seq >", pull)
        self.assertIn("m.payload", pull)

    def test_sync_model_records_server_privacy_guards_without_promoting_client_rollout(self):
        sync = json.loads(SYNC_MODEL.read_text(encoding="utf-8"))
        memory = next(item for item in sync["syncable_data_classes"] if item["id"] == "memory")
        backend = sync["backend"]
        self.assertFalse(memory["current_client_integration"])
        self.assertFalse(memory["production_enabled"])
        self.assertTrue(memory["backend_atomic_mutation_deployed"])
        self.assertFalse(memory["backend_generic_sync_rpc_accepts_memory"])
        self.assertTrue(memory["client_generated_backend_memory_id_allowed"])
        self.assertEqual(
            memory["client_generated_backend_memory_id_constraint"],
            "uuid-v4-first-create-only",
        )
        self.assertTrue(memory["local_first_identity_source_prepared"])
        self.assertFalse(memory["local_first_identity_applied"])
        self.assertFalse(memory["live_backend_identity_binding_implemented"])
        self.assertEqual(
            memory["live_backend_identity_compatibility"],
            "source-contract-resolved-deployment-and-live-wiring-pending",
        )
        self.assertTrue(backend["memory_backend_data_class_storage_enabled"])
        self.assertFalse(backend["memory_live_client_data_class_enabled"])
        self.assertTrue(backend["memory_local_first_identity_source_prepared"])
        self.assertFalse(backend["memory_local_first_identity_applied"])
        self.assertFalse(backend["memory_gateway_policy_live_wiring"])
        self.assertEqual(backend["memory_atomic_mutation_rpc"], "ordax_apply_memory_mutation_v1")
        self.assertEqual(backend["memory_privacy_hardening_status"], "source-prepared-not-applied")


if __name__ == "__main__":
    unittest.main()
