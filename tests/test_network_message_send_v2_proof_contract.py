#!/usr/bin/env python3
"""Regression guard for the transient message-send v2 SQL proof."""

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SQL = ROOT / "tests" / "sql" / "test_network_message_send_v2_prototype.sql"
WORKFLOW = ROOT / ".github" / "workflows" / "network-multitenant-proof.yml"


class NetworkMessageSendV2ProofContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = SQL.read_text(encoding="utf-8").lower()
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()

    def test_prototype_is_transactional_and_not_a_migration(self):
        self.assertIn("test_network_multitenant_hardening.sql immediately", self.sql)
        self.assertIn("begin;", self.sql)
        self.assertIn("rollback;", self.sql)
        self.assertIn("_v2_proof", self.sql)
        self.assertNotIn("apply_migration", self.workflow)

    def test_public_boundary_is_security_invoker_private_logic_is_definer(self):
        private_section = self.sql.split(
            "function private.ordax_network_send_message_internal_v2_proof", 1
        )[1].split(
            "function public.ordax_network_send_message_v2_proof", 1
        )[0]
        public_section = self.sql.split(
            "function public.ordax_network_send_message_v2_proof", 1
        )[1].split(
            "-- proof-only introspection helpers", 1
        )[0]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)

    def test_outcome_vocabulary_is_explicit(self):
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, self.sql)
        self.assertIn("retry_after_seconds", self.sql)
        self.assertIn("resource_id", self.sql)

    def test_idempotent_retry_does_not_consume_rate(self):
        self.assertIn("network-message-v2-proof-idempotent-consumed-rate", self.sql)
        self.assertIn("on conflict (sender_space_id, client_idempotency_key) do nothing", self.sql)

    def test_rate_limited_message_is_removed_but_counter_survives(self):
        self.assertIn("delete from public.ordax_network_messages", self.sql)
        self.assertIn("network-message-v2-proof-rate-state-not-durable", self.sql)
        self.assertIn("network-message-v2-proof-rate-limited-message-persisted", self.sql)
        self.assertIn("v_count <> 121", self.sql)

    def test_proof_introspection_stays_scoped_and_transient(self):
        self.assertIn("ordax_network_rate_count_v2_proof", self.sql)
        self.assertIn("ordax_network_message_exists_v2_proof", self.sql)
        self.assertIn("ordax_network_assert_space_actor_v1", self.sql)
        self.assertIn("v_actor <> p_actor_user_id", self.sql)
        self.assertNotIn(
            "infra/supabase/product/migrations",
            str(SQL).lower(),
        )

    def test_viewer_denial_and_invalid_input_are_structured(self):
        self.assertIn("network-message-v2-proof-denied-shape-invalid", self.sql)
        self.assertIn("network-message-v2-proof-invalid-shape-invalid", self.sql)
        self.assertIn("when sqlstate '42501'", self.sql)

    def test_plain_text_control_characters_fail_before_persistence_or_rate(self):
        self.assertIn("regexp_replace(v_body", self.sql)
        self.assertIn("[[:cntrl:]]", self.sql)
        self.assertIn("message-body-control-character", self.sql)
        self.assertIn("network-message-v2-proof-control-character-persisted", self.sql)
        self.assertIn("network-message-v2-proof-control-character-consumed-rate", self.sql)

    def test_workflow_orders_v1_before_v2_on_the_same_ephemeral_schema(self):
        v1 = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_multitenant_hardening.sql"
        )
        v2 = self.workflow.index(
            "psql -v on_error_stop=1 -f tests/sql/test_network_message_send_v2_prototype.sql"
        )
        self.assertLess(v1, v2)
        self.assertNotIn("createdb network_message_v2", self.workflow)

    def test_workflow_executes_the_v2_proof(self):
        self.assertIn(
            "psql -v on_error_stop=1 -f tests/sql/test_network_message_send_v2_prototype.sql",
            self.workflow,
        )
        self.assertIn(
            "python -m unittest tests.test_network_message_send_v2_proof_contract -v",
            self.workflow,
        )


if __name__ == "__main__":
    unittest.main()
