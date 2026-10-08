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

    def test_migration_sources_are_single_owned_and_versioned(self):
        names = self.destination["canonical_migrations_applied"]
        self.assertEqual(len(names), len(set(names)), "duplicate SQL source")
        self.assertGreaterEqual(len(names), 5)
        sources = {}
        for name in names:
            self.assertEqual(Path(name).name, name)
            self.assertTrue(name.endswith(".sql"))
            path = SOURCE / name
            self.assertTrue(path.is_file(), f"missing canonical migration: {name}")
            sql = path.read_text(encoding="utf-8").lower()
            self.assertTrue(sql.lstrip().startswith("begin;"))
            self.assertTrue(sql.rstrip().endswith("commit;"))
            sources[name] = sql

        registration = next(
            body for name, body in sources.items()
            if "account_registration_legal_receipt_v1.sql" in name
        )
        self.assertIn("ordax-registration-legal-intent-required", registration)
        self.assertIn("private.ordax_account_legal_receipts", registration)
        self.assertIn("enable row level security", registration)
        self.assertIn("to service_role", registration)

        login_guard = next(
            body for name, body in sources.items()
            if "public_login_legal_receipt_guard_v1.sql" in name
        )
        self.assertIn("ordax_account_has_registration_legal_receipt_v1", login_guard)
        self.assertIn("from public, anon, authenticated, service_role", login_guard)
        self.assertIn("to service_role", login_guard)


if __name__ == "__main__":
    unittest.main()
