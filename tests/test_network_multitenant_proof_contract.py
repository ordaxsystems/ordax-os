#!/usr/bin/env python3
"""Regression guard for the executable OrdaX Network SQL proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_multitenant_hardening.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"


class NetworkMultitenantProofContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()

    def test_workflow_runs_on_ephemeral_postgres_with_fail_fast_psql(self):
        self.assertIn("image: postgres:16", self.workflow)
        self.assertIn("psql -v on_error_stop=1", self.workflow)
        self.assertIn("persist-credentials: false", self.workflow)
        self.assertNotIn("supabase.co", self.workflow)
        self.assertNotIn("service_role_key", self.workflow)

    def test_exact_network_migrations_are_applied_in_order(self):
        migrations = [
            "20261001040000_network_directory_communities_v1.sql",
            "20261001043000_network_groups_messages_v1.sql",
            "20261001044500_network_inbox_groups_v1.sql",
            "20261001050000_network_security_hardening_v1.sql",
            "20261001051500_network_group_owner_lifecycle_v1.sql",
        ]
        positions = [self.sql.index(name) for name in migrations]
        self.assertEqual(positions, sorted(positions))

    def test_proof_covers_multi_tenant_negative_authority(self):
        for marker in (
            "network-proof-direct-message-table-readable",
            "network-proof-viewer-mutated-space-profile",
            "network-proof-cross-account-space-access",
            "network-proof-viewer-gained-send-authority",
            "network-proof-space-switch-retargeted-conversation",
            "network-proof-block-did-not-stop-send",
            "network-proof-report-cross-conversation-allowed",
        ):
            self.assertIn(marker, self.sql)

    def test_proof_covers_integrity_and_lifecycle(self):
        for marker in (
            "network-proof-direct-pair-not-deterministic",
            "network-proof-idempotent-retry-duplicated-message",
            "network-proof-group-owner-left-without-transfer",
            "network-proof-block-erased-history",
            "network-proof-rate-state-rolled-back-or-lost",
            "network-proof-owner-loss-did-not-archive-group",
            "network-proof-owner-loss-did-not-close-conversation",
            "network-proof-owner-loss-audit-missing",
        ):
            self.assertIn(marker, self.sql)

    def test_fixture_data_is_rolled_back(self):
        self.assertIn("begin;", self.sql)
        self.assertIn("rollback;", self.sql)
        self.assertIn("network_multitenant_sql_proof=pass", self.sql)


if __name__ == "__main__":
    unittest.main()
