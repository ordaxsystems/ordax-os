import json
import re
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = (
    ROOT
    / "infra"
    / "supabase"
    / "product"
    / "migrations"
    / "20261007050000_service_quota_ledger_v1.sql"
)
CONTRACT = ROOT / "docs" / "contracts" / "service-quotas.json"
WORKFLOW = ROOT / ".github" / "workflows" / "service-quota-contract.yml"
POSTGRES_PROOF = ROOT / "tests" / "sql" / "test_service_quota_ledger_v1.sql"
CONCURRENCY_PROOF = ROOT / "tests" / "test_service_quota_ledger_concurrency.sh"


class ServiceQuotaLedgerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.workflow = WORKFLOW.read_text(encoding="utf-8").lower()
        cls.postgres_proof = POSTGRES_PROOF.read_text(encoding="utf-8").lower()
        cls.concurrency_proof = CONCURRENCY_PROOF.read_text(encoding="utf-8").lower()

    def test_private_usage_and_reservations_have_no_direct_api_mutation_authority(self):
        for table in (
            "private.ordax_service_quota_usage",
            "private.ordax_service_quota_reservations",
        ):
            self.assertIn(f"alter table {table} enable row level security;", self.sql)
            self.assertRegex(
                self.sql,
                re.compile(
                    rf"revoke\s+all\s+on\s+table\s+{re.escape(table)}\s+"
                    r"from\s+public,\s*anon,\s*authenticated,\s*service_role"
                ),
            )
        self.assertNotRegex(
            self.sql,
            r"create\s+policy.*ordax_service_quota_(usage|reservations)",
        )

    def test_usage_is_subject_scoped_and_logical_not_provider_metered(self):
        self.assertIn("user_id uuid references auth.users(id) on delete cascade", self.sql)
        self.assertIn(
            "space_id uuid references public.ordax_spaces(space_id) on delete cascade",
            self.sql,
        )
        self.assertIn(
            "check ((user_id is not null)::integer + (space_id is not null)::integer = 1)",
            self.sql,
        )
        self.assertIn("used_units bigint not null default 0", self.sql)
        self.assertNotIn("provider_bucket", self.sql)
        self.assertNotIn("provider_object_key", self.sql)

    def test_reservation_resolves_server_entitlement_instead_of_accepting_client_limit(self):
        signature = self.sql.split(
            "create or replace function private.ordax_reserve_service_quota_v1", 1
        )[1].split("returns table", 1)[0]
        self.assertNotIn("p_limit", signature)
        self.assertIn("from public.ordax_entitlement_grants g", self.sql)
        self.assertIn("quota-policy-unavailable", self.sql)
        self.assertIn("quota-policy-ambiguous", self.sql)
        self.assertIn("quota-policy-invalid", self.sql)
        self.assertIn("v_policy_value->>'type' <> 'quota'", self.sql)
        self.assertIn("v_policy_value->>'unit' <> p_unit", self.sql)
        self.assertIn("v_policy_value->>'decision' not in ('allowed','denied')", self.sql)
        self.assertIn(
            "v_policy_value - array['decision','type','unit','limit']::text[]",
            self.sql,
        )

    def test_reservation_serializes_subject_and_blocks_growth_over_quota(self):
        self.assertIn("pg_catalog.pg_advisory_xact_lock", self.sql)
        self.assertIn("for update;", self.sql)
        self.assertIn("'over-quota-retained'", self.sql)
        self.assertIn("'quota-exceeded'", self.sql)
        self.assertIn("v_used + v_reserved + p_requested_units <= v_limit", self.sql)
        self.assertIn("p_ttl_seconds < 60 or p_ttl_seconds > 3600", self.sql)
        self.assertIn("quota-idempotency-conflict", self.sql)
        self.assertIn("quota-idempotency-key-reused", self.sql)

    def test_account_and_space_usage_lookup_apply_key_after_subject_union(self):
        expected = """where (
    (
      p_user_id is not null
      and u.user_id = p_user_id
      and u.space_id is null
    )
    or (
      p_space_id is not null
      and u.space_id = p_space_id
      and u.user_id is null
    )
  )
    and u.quota_key = p_quota_key"""
        self.assertIn(expected, self.sql)

    def test_commit_is_idempotent_and_expired_reservation_cannot_consume_usage(self):
        self.assertIn(
            "create or replace function private.ordax_commit_service_quota_reservation_v1",
            self.sql,
        )
        self.assertIn("if v_reservation.state = 'committed' then", self.sql)
        expiry = self.sql.index("if v_reservation.expires_at <= statement_timestamp() then")
        increment = self.sql.index(
            "set used_units = u.used_units + v_reservation.requested_units"
        )
        self.assertLess(expiry, increment)
        self.assertIn("state = 'expired'", self.sql)

    def test_internal_mutators_are_not_directly_executable_by_api_roles(self):
        for signature in (
            "private.ordax_reserve_service_quota_v1(\n  uuid, uuid, text, text, bigint, text, integer\n)",
            "private.ordax_commit_service_quota_reservation_v1(uuid)",
            "private.ordax_release_service_quota_reservation_v1(uuid)",
        ):
            self.assertIn(f"revoke all on function {signature}", self.sql)
        self.assertIn("from public, anon, authenticated, service_role;", self.sql)

    def test_operational_status_is_service_role_only(self):
        self.assertIn(
            "create or replace function public.ordax_service_quota_usage_status_v1",
            self.sql,
        )
        self.assertIn("security definer", self.sql)
        self.assertIn("set search_path = ''", self.sql)
        self.assertIn(
            "grant execute on function public.ordax_service_quota_usage_status_v1(uuid, uuid, text)\n  to service_role;",
            self.sql,
        )

    def test_contract_keeps_commercial_values_unassigned_and_rollout_closed(self):
        ledger = self.contract["server_ledger"]
        self.assertTrue(ledger["source_ready"])
        self.assertFalse(ledger["production_applied"])
        self.assertFalse(ledger["public_allocation_enabled"])
        self.assertFalse(self.contract["prepared_resources"][0]["commercial_value_assigned"])
        encoding = self.contract["quota_grant_encoding"]
        self.assertEqual(encoding["type"], "quota")
        self.assertEqual(encoding["decision_values"], ["allowed", "denied"])
        self.assertTrue(encoding["numeric_limit_may_be_null_only_when_explicitly_unmetered"])

    def test_ci_executes_behavioral_proof_on_disposable_postgres(self):
        self.assertIn("image: postgres:16", self.workflow)
        self.assertIn("psql -v on_error_stop=1 -f tests/sql/test_service_quota_ledger_v1.sql", self.workflow)
        self.assertIn("bash tests/test_service_quota_ledger_concurrency.sh", self.workflow)
        self.assertIn("persist-credentials: false", self.workflow)
        self.assertNotIn("supabase.co", self.workflow)
        self.assertIn(
            "\\ir ../../infra/supabase/product/migrations/20261007050000_service_quota_ledger_v1.sql",
            self.postgres_proof,
        )
        self.assertIn("set role service_role;", self.postgres_proof)
        self.assertIn("quota-service-role-direct-dml-accepted", self.postgres_proof)
        self.assertIn("quota-ambiguous-policy-accepted", self.postgres_proof)
        self.assertIn("quota-expired-reservation-consumed-usage", self.postgres_proof)

    def test_concurrency_proof_uses_two_real_connections_and_asserts_one_winner(self):
        self.assertGreaterEqual(self.concurrency_proof.count("reserve 'concurrent-request-"), 2)
        self.assertGreaterEqual(self.concurrency_proof.count(" &\n"), 2)
        self.assertIn("wait \"$pid_a\"", self.concurrency_proof)
        self.assertIn("wait \"$pid_b\"", self.concurrency_proof)
        self.assertIn("false|quota-exceeded|60", self.concurrency_proof)
        self.assertIn("true|within-quota|60", self.concurrency_proof)
        self.assertIn("0|60|1", self.concurrency_proof)


if __name__ == "__main__":
    unittest.main()
