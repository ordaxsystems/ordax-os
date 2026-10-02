#!/usr/bin/env python3
"""Guard the permanent block-change v2 migration against proven prototype drift."""

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
PROOF = ROOT / "tests" / "sql" / "test_network_block_change_v2_prototype.sql"
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261002053000_network_block_change_v2.sql"
)


def executable_sql(text: str) -> str:
    lines = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("--"):
            continue
        lines.append(stripped)
    return re.sub(r"\s+", " ", " ".join(lines)).strip()


class NetworkBlockChangeV2MigrationContractTests(unittest.TestCase):
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
        self.assertNotIn("ordax_network_block_rate_count_v2", lower)
        self.assertNotIn("ordax_network_block_exists_v2", lower)

    def test_promoted_functions_match_proven_prototype_exactly(self):
        proof_start = self.proof.index(
            "create or replace function private.ordax_network_block_resource_id_v2_proof"
        )
        proof_end = self.proof.index(
            "create or replace function private.ordax_network_block_rate_count_v2_proof"
        )
        proof_segment = self.proof[proof_start:proof_end].replace("_v2_proof", "_v2")

        migration_start = self.migration.index(
            "create or replace function private.ordax_network_block_resource_id_v2"
        )
        migration_end = self.migration.lower().rindex("commit;")
        migration_segment = self.migration[migration_start:migration_end]

        self.assertEqual(
            executable_sql(proof_segment),
            executable_sql(migration_segment),
        )

    def test_public_boundary_remains_invoker_only(self):
        lower = self.migration.lower()
        internal = lower.split(
            "function private.ordax_network_set_block_internal_v2", 1
        )[1].split(
            "function public.ordax_network_set_block_v2", 1
        )[0]
        public = lower.split(
            "function public.ordax_network_set_block_v2", 1
        )[1]
        self.assertIn("security definer", internal)
        self.assertIn("set search_path = ''", internal)
        self.assertIn("security invoker", public)
        self.assertNotIn("security definer", public)
        self.assertIn("from public, anon", public)
        self.assertIn("to authenticated", public)

    def test_block_unblock_idempotency_and_rate_semantics_are_preserved(self):
        lower = self.migration.lower()
        for outcome in (
            "'applied'",
            "'idempotent'",
            "'rate_limited'",
            "'denied'",
            "'invalid'",
        ):
            self.assertIn(outcome, lower)
        self.assertIn("'block:' || p_space_id::text || ':' || p_target_space_id::text", lower)
        self.assertIn("on conflict (blocker_space_id, blocked_space_id) do nothing", lower)
        self.assertIn("for update", lower)
        self.assertIn("ordax_network_consume_rate_v1", lower)
        self.assertIn("delete from public.ordax_network_blocks", lower)
        self.assertIn("block-already-applied", lower)
        self.assertIn("block-already-removed", lower)
        self.assertIn("block-rate-limited", lower)
        self.assertIn("unblock-rate-limited", lower)


if __name__ == "__main__":
    unittest.main()
