#!/usr/bin/env python3
"""Regression guard for the transient group-create v2 SQL proof."""

from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_group_create_v2_prototype.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"
CONTRACT = ROOT / "docs" / "contracts" / "network-mutation-outcome-v2.json"


class NetworkGroupCreateV2ProofContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

    def test_contract_requires_owner_space_scoped_idempotency(self):
        operation = self.contract["operations"]["group-create"]
        self.assertTrue(operation["idempotency_key_required"])
        self.assertEqual(operation["idempotency_scope"], "owner-space")

    def test_schema_delta_is_transient_and_legacy_compatible(self):
        self.assertIn("begin;", self.sql)
        self.assertIn("rollback;", self.sql)
        self.assertIn("add column client_idempotency_key text", self.sql)
        self.assertIn(
            "on public.ordax_network_groups(owner_space_id, client_idempotency_key)",
            self.sql,
        )
        self.assertIn("where owner_space_id is not null", self.sql)
        self.assertIn("and client_idempotency_key is not null", self.sql)
        self.assertNotIn("alter column client_idempotency_key set not null", self.sql)
        self.assertNotIn("infra/supabase/product/migrations", str(SQL).lower())

    def test_public_boundary_is_invoker_and_private_logic_is_definer(self):
        private_section = self.sql.split(
            "function private.ordax_network_create_group_internal_v2_proof", 1
        )[1].split(
            "function public.ordax_network_create_group_v2_proof", 1
        )[0]
        public_section = self.sql.split(
            "function public.ordax_network_create_group_v2_proof", 1
        )[1].split(
            "function private.ordax_network_group_create_rate_count_v2_proof", 1
        )[0]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)
        self.assertNotIn("when others", private_section)

    def test_all_outcomes_are_explicit(self):
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, self.sql)
        self.assertIn("'group-create'", self.sql)
        self.assertIn("resource_id", self.sql)
        self.assertIn("retry_after_seconds", self.sql)

    def test_retry_resolves_before_rate_and_conflicts_are_explicit(self):
        private_section = self.sql.split(
            "function private.ordax_network_create_group_internal_v2_proof", 1
        )[1].split(
            "revoke all on function private.ordax_network_create_group_internal_v2_proof", 1
        )[0]
        lookup = private_section.index(
            "where g.owner_space_id = p_space_id"
        )
        rate = private_section.index("ordax_network_consume_rate_v1")
        self.assertLess(lookup, rate)
        self.assertIn(
            "on conflict (owner_space_id, client_idempotency_key)",
            private_section,
        )
        self.assertIn("group-idempotent", private_section)
        self.assertIn("group-idempotency-conflict", private_section)
        self.assertIn(
            "network-group-create-v2-proof-idempotent-consumed-rate",
            self.sql,
        )
        self.assertIn(
            "network-group-create-v2-proof-conflict-consumed-rate",
            self.sql,
        )

    def test_denials_and_invalid_inputs_do_not_spend_quota(self):
        self.assertIn("network-group-create-v2-proof-invalid-consumed-rate", self.sql)
        self.assertIn("network-group-create-v2-proof-denials-consumed-rate", self.sql)
        self.assertIn(
            "network-group-create-v2-proof-community-denied-consumed-rate",
            self.sql,
        )
        self.assertIn("group-invite-flow-not-ready", self.sql)
        self.assertIn("when sqlstate '42501'", self.sql)

    def test_rate_limit_removes_provisional_group_and_keeps_counter(self):
        self.assertIn("delete from public.ordax_network_groups", self.sql)
        self.assertIn("network-group-create-v2-proof-rate-state-not-durable", self.sql)
        self.assertIn(
            "network-group-create-v2-proof-rate-limited-resource-persisted",
            self.sql,
        )
        self.assertIn("v_count <> 11", self.sql)

    def test_applied_group_has_complete_owner_conversation_structure(self):
        self.assertIn("ordax_network_group_create_snapshot_v2_proof", self.sql)
        self.assertIn("owner_membership_state", self.sql)
        self.assertIn("conversation_member_state", self.sql)
        self.assertIn("network-group-create-v2-proof-applied-state-invalid", self.sql)

    def test_workflow_executes_group_create_proof(self):
        base = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_multitenant_hardening.sql"
        )
        create = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_group_create_v2_prototype.sql"
        )
        self.assertLess(base, create)
        self.assertIn(
            "python -m unittest tests.test_network_group_create_v2_proof_contract -v",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
