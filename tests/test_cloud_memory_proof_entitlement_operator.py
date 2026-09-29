#!/usr/bin/env python3
"""Regression guards for the operator-only cloud Memory proof entitlement."""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT / "infra" / "supabase" / "product" / "migrations"
    / "20260929195000_cloud_memory_proof_entitlement_operator_v1.sql"
)


class CloudMemoryProofEntitlementOperatorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.lower = cls.sql.lower()

    def test_operator_boundary_is_narrow_and_not_self_authorizing(self):
        self.assertIn("private.ordax_issue_cloud_memory_proof_entitlement_v1", self.lower)
        self.assertIn("private.ordax_revoke_cloud_memory_proof_entitlement_v1", self.lower)
        self.assertIn("'memory.cloud.enabled'", self.lower)
        self.assertIn("'cloud-memory-two-client-proof'", self.lower)
        self.assertIn("p_ttl_seconds < 300 or p_ttl_seconds > 1800", self.lower)
        self.assertIn("'source_commit', p_source_commit", self.lower)
        self.assertIn("'temporary', true", self.lower)
        self.assertNotIn("grant execute on function private.ordax_issue", self.lower)
        self.assertNotIn("grant execute on function private.ordax_revoke", self.lower)
        self.assertNotIn("create table if not exists", self.lower)
        self.assertNotIn("create or replace function", self.lower)

    def test_client_and_service_roles_cannot_execute_operator_functions(self):
        for signature in (
            "private.ordax_issue_cloud_memory_proof_entitlement_v1(uuid, integer, text, text)",
            "private.ordax_revoke_cloud_memory_proof_entitlement_v1(uuid, text, text)",
        ):
            pattern = (
                r"revoke all on function\s+"
                + re.escape(signature)
                + r"\s+from public, anon, authenticated, service_role;"
            )
            self.assertRegex(self.lower, pattern)

    def test_issue_is_audited_and_rejects_existing_active_grant(self):
        self.assertIn("private.ordax_cloud_memory_proof_entitlement_events", self.lower)
        self.assertIn("cloud-memory-proof-entitlement-already-active", self.lower)
        self.assertIn("e.valid_from <= v_now", self.lower)
        self.assertIn("(e.valid_until is null or e.valid_until > v_now)", self.lower)
        self.assertIn("'issued'", self.lower)
        self.assertIn("'revoked'", self.lower)
        audit_table = self.lower.split(
            "create table private.ordax_cloud_memory_proof_entitlement_events",
            1,
        )[1].split(");", 1)[0]
        self.assertNotIn("references auth.users", audit_table)
        self.assertNotIn("references public.ordax_entitlement_grants", audit_table)

    def test_revoke_only_targets_proof_specific_admin_grants(self):
        revoke = self.lower.split(
            "create function private.ordax_revoke_cloud_memory_proof_entitlement_v1",
            1,
        )[1]
        self.assertIn("e.entitlement_key = 'memory.cloud.enabled'", revoke)
        self.assertIn("e.source = 'admin'", revoke)
        self.assertIn(
            "e.entitlement_value ->> 'purpose' = 'cloud-memory-two-client-proof'",
            revoke,
        )
        self.assertIn("e.entitlement_value ->> 'temporary' = 'true'", revoke)
        self.assertIn("'decision', 'denied'", revoke)


if __name__ == "__main__":
    unittest.main()
