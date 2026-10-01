#!/usr/bin/env python3
"""Regression guard for the transient direct-create v2 SQL proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_direct_create_v2_prototype.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"


class NetworkDirectCreateV2ProofContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()

    def test_prototype_is_transactional_and_never_a_migration(self):
        self.assertIn("test_network_multitenant_hardening.sql immediately", self.sql)
        self.assertIn("begin;", self.sql)
        self.assertIn("rollback;", self.sql)
        self.assertIn("_v2_proof", self.sql)
        self.assertNotIn("apply_migration", self.workflow)
        self.assertNotIn("infra/supabase/product/migrations", str(SQL).lower())

    def test_public_boundary_is_invoker_and_private_logic_is_definer(self):
        private_section = self.sql.split(
            "function private.ordax_network_create_direct_internal_v2_proof", 1
        )[1].split(
            "function public.ordax_network_create_direct_v2_proof", 1
        )[0]
        public_section = self.sql.split(
            "function public.ordax_network_create_direct_v2_proof", 1
        )[1].split(
            "-- proof-only scoped inspection", 1
        )[0]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)
        self.assertNotIn("when others", private_section)

    def test_all_v2_outcomes_are_explicit(self):
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, self.sql)
        self.assertIn("'direct-create'", self.sql)
        self.assertIn("resource_id", self.sql)
        self.assertIn("retry_after_seconds", self.sql)

    def test_existing_or_concurrent_pair_is_idempotent_before_rate_consumption(self):
        private_section = self.sql.split(
            "function private.ordax_network_create_direct_internal_v2_proof", 1
        )[1].split(
            "revoke all on function private.ordax_network_create_direct_internal_v2_proof", 1
        )[0]
        existing_lookup = private_section.index("select c.conversation_id, c.state")
        rate_call = private_section.index("ordax_network_consume_rate_v1")
        self.assertLess(existing_lookup, rate_call)
        self.assertIn("on conflict (direct_pair_key) do nothing", private_section)
        self.assertIn("network-direct-v2-proof-idempotent-consumed-rate", self.sql)

    def test_rate_limit_removes_provisional_conversation_but_keeps_rate_state(self):
        self.assertIn("delete from public.ordax_network_conversations", self.sql)
        self.assertIn("network-direct-v2-proof-rate-state-not-durable", self.sql)
        self.assertIn(
            "network-direct-v2-proof-rate-limited-conversation-persisted",
            self.sql,
        )
        self.assertIn("v_count <> 31", self.sql)

    def test_invalid_blocked_and_viewer_denial_do_not_create_resources(self):
        self.assertIn("network-direct-v2-proof-invalid-shape-invalid", self.sql)
        self.assertIn("network-direct-v2-proof-blocked-shape-invalid", self.sql)
        self.assertIn("network-direct-v2-proof-viewer-denied-shape-invalid", self.sql)
        self.assertIn("network-direct-v2-proof-blocked-consumed-rate", self.sql)
        self.assertIn("when sqlstate '42501'", self.sql)

    def test_proof_introspection_remains_space_scoped(self):
        self.assertIn("ordax_network_direct_rate_count_v2_proof", self.sql)
        self.assertIn("ordax_network_direct_exists_v2_proof", self.sql)
        self.assertIn("ordax_network_assert_space_actor_v1", self.sql)

    def test_workflow_executes_direct_proof_after_canonical_schema_proof(self):
        base = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_multitenant_hardening.sql"
        )
        direct = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_direct_create_v2_prototype.sql"
        )
        self.assertLess(base, direct)
        self.assertIn(
            "python -m unittest tests.test_network_direct_create_v2_proof_contract -v",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
