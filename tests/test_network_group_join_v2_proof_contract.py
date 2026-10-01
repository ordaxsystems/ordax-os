#!/usr/bin/env python3
"""Regression guard for the transient group-join v2 SQL proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_group_join_v2_prototype.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"


class NetworkGroupJoinV2ProofContractTests(unittest.TestCase):
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
            "function private.ordax_network_join_group_internal_v2_proof", 1
        )[1].split(
            "function public.ordax_network_join_group_v2_proof", 1
        )[0]
        public_section = self.sql.split(
            "function public.ordax_network_join_group_v2_proof", 1
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
        self.assertIn("'group-join'", self.sql)
        self.assertIn("resource_id", self.sql)
        self.assertIn("retry_after_seconds", self.sql)

    def test_composite_key_is_the_natural_idempotency_boundary(self):
        private_section = self.sql.split(
            "function private.ordax_network_join_group_internal_v2_proof", 1
        )[1].split(
            "revoke all on function private.ordax_network_join_group_internal_v2_proof", 1
        )[0]
        membership_lookup = private_section.index("select gm.* into v_membership")
        rate_call = private_section.index("ordax_network_consume_rate_v1")
        self.assertLess(membership_lookup, rate_call)
        self.assertIn("for update", private_section)
        self.assertIn(
            "on conflict (group_id, space_id) do nothing",
            private_section,
        )
        self.assertIn("'group-membership:'", private_section)
        self.assertIn(
            "network-group-v2-proof-idempotent-consumed-rate",
            self.sql,
        )

    def test_reactivation_is_locked_and_retry_safe(self):
        self.assertIn("v_reactivate := true", self.sql)
        self.assertIn("gm.state = 'left'", self.sql)
        self.assertIn("gm.role = 'member'", self.sql)
        self.assertIn(
            "network-group-v2-proof-reactivation-rate-count-invalid",
            self.sql,
        )
        self.assertIn(
            "network-group-v2-proof-reactivation-retry-consumed-rate",
            self.sql,
        )

    def test_rate_limit_removes_only_provisional_membership_and_keeps_state(self):
        self.assertIn(
            "delete from public.ordax_network_group_memberships",
            self.sql,
        )
        self.assertIn("network-group-v2-proof-rate-state-not-durable", self.sql)
        self.assertIn(
            "network-group-v2-proof-rate-limited-membership-persisted",
            self.sql,
        )
        self.assertIn("v_count <> 41", self.sql)

    def test_invalid_invite_only_and_viewer_denials_do_not_consume_quota(self):
        self.assertIn("network-group-v2-proof-invalid-consumed-rate", self.sql)
        self.assertIn("network-group-v2-proof-invite-denied-consumed-rate", self.sql)
        self.assertIn("network-group-v2-proof-viewer-denied-shape-invalid", self.sql)
        self.assertIn("when sqlstate '42501'", self.sql)

    def test_proof_introspection_remains_space_scoped(self):
        self.assertIn("ordax_network_group_join_rate_count_v2_proof", self.sql)
        self.assertIn("ordax_network_group_join_snapshot_v2_proof", self.sql)
        self.assertIn("ordax_network_assert_space_actor_v1", self.sql)

    def test_workflow_executes_group_join_proof_after_canonical_schema_proof(self):
        base = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_multitenant_hardening.sql"
        )
        group_join = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_group_join_v2_prototype.sql"
        )
        self.assertLess(base, group_join)
        self.assertIn(
            "python -m unittest tests.test_network_group_join_v2_proof_contract -v",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
