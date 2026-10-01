#!/usr/bin/env python3
"""Regression guard for the transient report-create v2 SQL proof."""

from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_report_create_v2_prototype.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"
CONTRACT = ROOT / "docs" / "contracts" / "network-mutation-outcome-v2.json"


class NetworkReportCreateV2ProofContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_report_contract_requires_space_scoped_idempotency(self):
        report = self.contract["operations"]["report-create"]
        self.assertTrue(report["idempotency_key_required"])
        self.assertEqual(report["idempotency_scope"], "reporter-space")

    def test_schema_delta_is_transient_and_migration_compatible(self):
        self.assertIn("begin;", self.sql)
        self.assertIn("rollback;", self.sql)
        self.assertIn(
            "add column client_idempotency_key text",
            self.sql,
        )
        self.assertIn(
            "where client_idempotency_key is not null",
            self.sql,
        )
        self.assertNotIn("alter column client_idempotency_key set not null", self.sql)
        self.assertNotIn("infra/supabase/product/migrations", str(SQL).lower())

    def test_public_wrapper_is_invoker_private_logic_is_definer(self):
        private_section = self.sql.split(
            "function private.ordax_network_create_report_internal_v2_proof", 1
        )[1].split(
            "function public.ordax_network_create_report_v2_proof", 1
        )[0]
        public_section = self.sql.split(
            "function public.ordax_network_create_report_v2_proof", 1
        )[1].split(
            "function private.ordax_network_report_rate_count_v2_proof", 1
        )[0]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)
        self.assertNotIn("when others", private_section)

    def test_report_retry_is_race_safe_and_canonical(self):
        self.assertIn(
            "on conflict (reporter_space_id, client_idempotency_key)",
            self.sql,
        )
        self.assertIn("report-idempotent", self.sql)
        self.assertIn("report-idempotency-conflict", self.sql)
        self.assertIn("network-report-v2-proof-idempotent-consumed-rate", self.sql)
        self.assertIn("network-report-v2-proof-conflict-consumed-rate", self.sql)

    def test_all_outcomes_are_explicit(self):
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, self.sql)
        self.assertIn("'report-create'", self.sql)

    def test_rate_limited_report_is_removed_but_counter_survives(self):
        self.assertIn("delete from public.ordax_network_reports", self.sql)
        self.assertIn("network-report-v2-proof-rate-state-not-durable", self.sql)
        self.assertIn("network-report-v2-proof-rate-limited-report-persisted", self.sql)
        self.assertIn("v_count <> 21", self.sql)

    def test_workflow_executes_report_proof(self):
        self.assertIn(
            "psql -v on_error_stop=1 -f tests/sql/test_network_report_create_v2_prototype.sql",
            self.workflow,
        )
        self.assertIn(
            "python -m unittest tests.test_network_report_create_v2_proof_contract -v",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
