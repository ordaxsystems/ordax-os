#!/usr/bin/env python3
"""Guard the permanent group-join v2 migration against proven prototype drift."""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "tests" / "sql" / "test_network_group_join_v2_prototype.sql"
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261002053500_network_group_join_v2.sql"
)


def executable_sql(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        lines.append(stripped)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


class NetworkGroupJoinV2MigrationContractTests(unittest.TestCase):
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
        self.assertNotIn("proof-only scoped inspection", lower)

    def test_promoted_rpc_matches_proven_prototype_exactly(self):
        proof_start = self.proof.index(
            "create or replace function private.ordax_network_join_group_internal_v2_proof"
        )
        proof_end = self.proof.index("-- Proof-only scoped inspection.")
        proof_segment = self.proof[proof_start:proof_end].replace("_v2_proof", "_v2")

        migration_start = self.migration.index(
            "create or replace function private.ordax_network_join_group_internal_v2"
        )
        migration_end = self.migration.lower().rindex("commit;")
        migration_segment = self.migration[migration_start:migration_end]

        self.assertEqual(
            executable_sql(proof_segment),
            executable_sql(migration_segment),
        )

    def test_public_boundary_remains_invoker_only(self):
        lower = self.migration.lower()
        private_section = lower.split(
            "function private.ordax_network_join_group_internal_v2", 1
        )[1].split(
            "function public.ordax_network_join_group_v2", 1
        )[0]
        public_section = lower.split(
            "function public.ordax_network_join_group_v2", 1
        )[1]
        self.assertIn("security definer", private_section)
        self.assertIn("set search_path = ''", private_section)
        self.assertIn("security invoker", public_section)
        self.assertNotIn("security definer", public_section)
        self.assertIn("from public, anon", public_section)
        self.assertIn("to authenticated", public_section)

    def test_join_idempotency_reactivation_and_rate_semantics_are_preserved(self):
        lower = self.migration.lower()
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, lower)
        self.assertIn("ordax_network_assert_space_actor_v1", lower)
        self.assertIn("ordax_network_assert_community_member_v1", lower)
        self.assertIn("for update", lower)
        self.assertIn("on conflict (group_id, space_id) do nothing", lower)
        self.assertIn("ordax_network_consume_rate_v1", lower)
        self.assertIn("group-membership-idempotent", lower)
        self.assertIn("group-membership-not-reactivatable", lower)
        self.assertIn("group-join-rate-limited", lower)
        self.assertIn("network-group-v2-reactivation-lost", lower)


if __name__ == "__main__":
    unittest.main()
