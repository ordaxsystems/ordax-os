#!/usr/bin/env python3
"""Regression guard for the transient block-change v2 SQL proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_block_change_v2_prototype.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"


class NetworkBlockChangeV2ProofContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()

    def test_proof_is_transient(self):
        self.assertIn("begin;", self.sql)
        self.assertIn("rollback;", self.sql)
        self.assertIn("_v2_proof", self.sql)
        self.assertNotIn("infra/supabase/product/migrations", str(SQL).lower())

    def test_public_wrapper_is_invoker_private_logic_is_definer(self):
        private_section = self.sql.split(
            "function private.ordax_network_set_block_internal_v2_proof", 1
        )[1].split(
            "function public.ordax_network_set_block_v2_proof", 1
        )[0]
        public_section = self.sql.split(
            "function public.ordax_network_set_block_v2_proof", 1
        )[1].split(
            "function private.ordax_network_block_rate_count_v2_proof", 1
        )[0]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)
        self.assertNotIn("when others", private_section)

    def test_operation_uses_full_v2_outcome_vocabulary(self):
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, self.sql)
        self.assertIn("'block-change'", self.sql)
        self.assertIn("retry_after_seconds", self.sql)

    def test_block_relation_has_stable_logical_resource_id_without_schema_change(self):
        self.assertIn(
            "'block:' || p_space_id::text || ':' || p_target_space_id::text",
            self.sql,
        )
        self.assertIn("block-already-applied", self.sql)
        self.assertIn("block-already-removed", self.sql)

    def test_block_retry_and_unblock_retry_do_not_consume_second_quota(self):
        self.assertIn("network-block-v2-proof-idempotent-consumed-rate", self.sql)
        self.assertIn("network-unblock-v2-proof-idempotent-consumed-rate", self.sql)
        self.assertIn(
            "on conflict (blocker_space_id, blocked_space_id) do nothing",
            self.sql,
        )
        self.assertIn("for update", self.sql)

    def test_rate_limited_new_block_is_removed_and_rate_state_survives(self):
        self.assertIn("delete from public.ordax_network_blocks", self.sql)
        self.assertIn("network-block-v2-proof-rate-state-not-durable", self.sql)
        self.assertIn("network-block-v2-proof-rate-limited-block-persisted", self.sql)
        self.assertIn("v_count <> 61", self.sql)

    def test_invalid_and_viewer_denial_are_structured(self):
        self.assertIn("network-block-v2-proof-invalid-shape-invalid", self.sql)
        self.assertIn("network-block-v2-proof-viewer-denied-shape-invalid", self.sql)
        self.assertIn("when sqlstate '42501'", self.sql)

    def test_workflow_executes_the_block_change_proof(self):
        self.assertIn(
            "psql -v on_error_stop=1 -f tests/sql/test_network_block_change_v2_prototype.sql",
            self.workflow,
        )
        self.assertIn(
            "python -m unittest tests.test_network_block_change_v2_proof_contract -v",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
