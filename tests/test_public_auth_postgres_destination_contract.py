"""Fail-closed checks for account provider cutover; no parallel identity authority."""

from __future__ import annotations

import json
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs" / "contracts" / "public-auth-hardening.json"
SOURCE = ROOT / "infra" / "supabase" / "product" / "migrations"


class AccountPostgresCutoverContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.destination = cls.contract["postgresql_destination"]

    def test_only_existing_provider_is_current_until_promotion(self):
        stage = self.destination
        self.assertFalse(stage["parallel_identity_write_enabled"])
        self.assertTrue(stage["project_ref"])
        self.assertTrue(stage["source_owner"].endswith("/migrations"))
        if not stage["functional_provider_cutover_complete"]:
            self.assertNotEqual(self.contract["target"]["project_ref"], stage["project_ref"])
            self.assertFalse(stage["public_registration_enabled"])
            self.assertFalse(stage["public_login_enabled"])
            self.assertFalse(stage["public_account_gateway_deployed"])
            self.assertFalse(stage["active_legal_policy_present"])

    def test_promotion_requires_proven_runtime_not_just_migrations(self):
        stage = self.destination
        if stage["functional_provider_cutover_complete"]:
            for name in (
                "public_account_gateway_deployed",
                "provider_settings_e2e_verified",
                "session_revocation_e2e_verified",
                "recovery_e2e_verified",
            ):
                self.assertTrue(stage[name], f"cutover requires {name}")
        else:
            self.assertFalse(stage["public_login_enabled"])
            self.assertFalse(stage["public_registration_enabled"])

    def test_destination_runtime_remains_closed_despite_sql_readiness(self):
        stage = self.destination
        self.assertTrue(stage["database_rate_limit_full_sql_proof_passed"])
        self.assertTrue(stage["database_rate_limit_test_rows_rolled_back"])
        self.assertTrue(stage["legacy_legal_quarantine_applied"])
        self.assertFalse(stage["public_auth_rate_limit_runtime_e2e_verified"])
        self.assertFalse(stage["public_login_enabled"])
        self.assertFalse(stage["public_registration_enabled"])
        self.assertFalse(stage["parallel_identity_write_enabled"])

    def test_migration_sources_are_single_owned_and_versioned(self):
        names = self.destination["canonical_migrations_applied"]
        self.assertEqual(len(names), len(set(names)), "duplicate SQL source")
        self.assertGreaterEqual(len(names), 8)
        sources = {}
        for name in names:
            self.assertEqual(Path(name).name, name)
            self.assertTrue(name.endswith(".sql"))
            path = SOURCE / name
            self.assertTrue(path.is_file(), f"missing canonical migration: {name}")
            sql = path.read_text(encoding="utf-8").lower()
            statements = [
                line.strip() for line in sql.splitlines()
                if line.strip() and not line.lstrip().startswith("--")
            ]
            self.assertEqual(statements[0], "begin;")
            self.assertEqual(statements[-1], "commit;")
            sources[name] = sql

        registration = next(
            body for name, body in sources.items()
            if "account_registration_legal_receipt_v1.sql" in name
        )
        self.assertIn("ordax-registration-legal-intent-required", registration)
        self.assertIn("private.ordax_account_legal_receipts", registration)
        self.assertIn("enable row level security", registration)
        self.assertIn("to service_role", registration)

        validation_v2 = next(
            body for name, body in sources.items()
            if "account_registration_intent_email_validation_v2.sql" in name
        )
        validation_body = validation_v2.split("create or replace function", 1)[1]
        self.assertNotIn("chr(0)", validation_body)
        self.assertIn("char_length(v_email) > 320 then", validation_body)
        self.assertIn("registration-legal-policy-unavailable", validation_body)
        self.assertIn("to service_role", validation_body)

        rate_limit = next(
            body for name, body in sources.items()
            if "public_auth_rate_limit_v1.sql" in name
        )
        self.assertIn("private.ordax_public_auth_rate_limits", rate_limit)
        self.assertIn("ordax_consume_public_auth_rate_limit_v1", rate_limit)
        self.assertIn("to service_role", rate_limit)
        self.assertIn("enable row level security", rate_limit)

        quarantine = next(
            body for name, body in sources.items()
            if "account_legacy_legal_quarantine_v1.sql" in name
        )
        self.assertIn("ordax_account_legal_quarantine", quarantine)
        self.assertIn("ordax_account_legal_receipts", quarantine)
        self.assertIn("to service_role", quarantine)

        login_guard = next(
            body for name, body in sources.items()
            if "public_login_legal_receipt_guard_v1.sql" in name
        )
        self.assertIn("ordax_account_has_registration_legal_receipt_v1", login_guard)
        self.assertIn("from public, anon, authenticated, service_role", login_guard)
        self.assertIn("to service_role", login_guard)


if __name__ == "__main__":
    unittest.main()
