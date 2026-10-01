#!/usr/bin/env python3
"""Guard the permanent message-send v2 migration against proof drift."""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "tests" / "sql" / "test_network_message_send_v2_prototype.sql"
MIGRATION = ROOT / "infra" / "supabase" / "product" / "migrations" / "20261001220000_network_message_send_v2.sql"

# The transient proof historically escaped these characters twice, so it proved
# rejection of unsafe C0 controls but did not actually prove the documented
# tab/newline/carriage-return allowance. The permanent migration fixes exactly
# this literal; no other executable drift from the proven RPC is accepted.
PROOF_CONTROL_LITERAL = r"E'\\t\\n\\r'"
MIGRATION_CONTROL_LITERAL = r"E'\t\n\r'"


def executable_sql(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        lines.append(stripped)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


class NetworkMessageSendV2MigrationContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proof = PROOF.read_text(encoding="utf-8")
        cls.migration = MIGRATION.read_text(encoding="utf-8")

    def test_migration_is_permanent_and_fixture_free(self):
        lower = self.migration.lower()
        self.assertIn("begin;", lower)
        self.assertIn("commit;", lower)
        self.assertNotIn("rollback;", lower)
        self.assertNotIn("_v2_proof", lower)
        self.assertNotIn("insert into auth.users", lower)
        self.assertNotIn("set local role", lower)
        self.assertNotIn("create temporary table", lower)

    def test_promoted_rpc_matches_proof_with_only_audited_control_literal_fix(self):
        proof_start = self.proof.index(
            "create or replace function private.ordax_network_send_message_internal_v2_proof"
        )
        proof_end = self.proof.index("-- Proof-only introspection helpers")
        proof_segment = self.proof[proof_start:proof_end].replace("_v2_proof", "_v2")

        migration_start = self.migration.index(
            "create or replace function private.ordax_network_send_message_internal_v2"
        )
        migration_end = self.migration.lower().rindex("commit;")
        migration_segment = self.migration[migration_start:migration_end]

        self.assertEqual(proof_segment.count(PROOF_CONTROL_LITERAL), 1)
        self.assertEqual(migration_segment.count(MIGRATION_CONTROL_LITERAL), 1)
        self.assertNotIn(PROOF_CONTROL_LITERAL, migration_segment)

        corrected_proof_segment = proof_segment.replace(
            PROOF_CONTROL_LITERAL,
            MIGRATION_CONTROL_LITERAL,
            1,
        )
        self.assertEqual(
            executable_sql(corrected_proof_segment),
            executable_sql(migration_segment),
        )

    def test_public_boundary_remains_invoker_only(self):
        lower = self.migration.lower()
        private_section = lower.split(
            "function private.ordax_network_send_message_internal_v2", 1
        )[1].split(
            "function public.ordax_network_send_message_v2", 1
        )[0]
        public_section = lower.split(
            "function public.ordax_network_send_message_v2", 1
        )[1]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)
        self.assertIn("to authenticated", public_section)

    def test_all_canonical_outcomes_and_content_guard_are_preserved(self):
        lower = self.migration.lower()
        for outcome in ("'applied'", "'idempotent'", "'rate_limited'", "'denied'", "'invalid'"):
            self.assertIn(outcome, lower)
        self.assertIn("prototype-ordax.network-mutation-outcome/2", lower)
        self.assertIn("message-body-control-character", lower)
        self.assertIn("ordax_network_assert_conversation_sender_v1", lower)
        self.assertIn("ordax_network_consume_rate_v1", lower)
        self.assertIn("on conflict (sender_space_id, client_idempotency_key) do nothing", lower)
        self.assertIn(MIGRATION_CONTROL_LITERAL, self.migration)


if __name__ == "__main__":
    unittest.main()
