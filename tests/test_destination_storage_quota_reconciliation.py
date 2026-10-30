"""The source migration history is not the runtime state of a populated destination."""

import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CONTRACT = ROOT / "docs/contracts"
MIGRATIONS = ROOT / "infra/supabase/product/migrations"
EXPECTED_ABSENT = {
    "public.ordax_user_objects",
    "private.ordax_user_object_provider_refs",
    "private.ordax_user_upload_reservations",
    "private.ordax_service_quota_usage",
    "private.ordax_service_quota_reservations",
}


class DestinationStorageQuotaReconciliationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.owner = json.loads((CONTRACT / "public-auth-hardening.json").read_text())
        cls.storage = json.loads((CONTRACT / "user-cloud-storage.json").read_text())
        cls.quotas = json.loads((CONTRACT / "service-quotas.json").read_text())
        cls.runtime = cls.storage["deployment"]
        cls.ledger = cls.quotas["server_ledger"]
        cls.evidence = json.loads((ROOT / cls.runtime["destination_inventory_evidence"]).read_text())
        cls.history = json.loads((ROOT / cls.runtime["historical_deployment_evidence"]).read_text())

    def test_one_destination_owner_and_no_fake_success(self):
        dest = self.owner["postgresql_destination"]
        ref = dest["project_ref"]
        self.assertTrue(dest["existing_auth_users_observed"])
        self.assertFalse(dest["functional_provider_cutover_complete"])
        self.assertEqual(self.runtime["target_project_ref"], ref)
        self.assertEqual(self.ledger["target_project_ref"], ref)
        self.assertEqual(self.evidence["target_project_ref"], ref)
        self.assertFalse(self.runtime["transactional_schema_deployed"])
        self.assertFalse(self.ledger["production_applied"])
        self.assertFalse(self.runtime["public_rollout_enabled"])
        self.assertFalse(self.ledger["public_allocation_enabled"])
        self.assertFalse(self.runtime["replay_historical_migrations_unmodified_allowed"])
        self.assertFalse(self.ledger["replay_historical_migrations_unmodified_allowed"])
        self.assertFalse(self.evidence["runtime_proofs"]["public_account_release_approved"])

    def test_all_five_missing_tables_are_explicit_not_rls_off(self):
        self.assertEqual(set(self.evidence["tables"]), EXPECTED_ABSENT)
        self.assertTrue(all(value is False for value in self.evidence["tables"].values()))
        expected_storage = {x for x in EXPECTED_ABSENT if not x.startswith("private.ordax_service_quota")}
        expected_quota = EXPECTED_ABSENT - expected_storage
        self.assertEqual(set(self.runtime["observed_tables"]), expected_storage)
        self.assertEqual(set(self.ledger["observed_tables"]), expected_quota)
        self.assertTrue(all(value is False for value in self.runtime["observed_tables"].values()))
        self.assertTrue(all(value is False for value in self.ledger["observed_tables"].values()))
        self.assertFalse(self.runtime["private_tables_rls_hardening"]["production_applied"])
        self.assertFalse(self.runtime["quota_reservation_link"]["production_applied"])
        self.assertFalse(self.ledger["usage_reduction"]["production_applied"])

    def test_old_policy_schema_dependency_requires_explicit_reconciliation(self):
        source = (MIGRATIONS / "20261005171000_user_cloud_storage_foundation_v2.sql").read_text()
        self.assertIn("ordax_policy.can_access_space(space_id)", source)
        self.assertEqual(self.runtime["legacy_rls_policy_schema_dependency"], "ordax_policy")
        self.assertFalse(self.runtime["legacy_rls_policy_schema_dependency_present"])
        self.assertTrue(self.runtime["legacy_rls_policy_must_be_reconciled_before_installation"])
        self.assertFalse(self.evidence["schema_preconditions"]["ordax_policy"])
        self.assertTrue(self.evidence["function_preconditions"]["private.ordax_touch_updated_at()"])
        self.assertTrue(self.runtime["existing_user_data_must_be_preserved"])

    def test_prior_deployment_assertions_remain_historical_not_live(self):
        self.assertTrue(self.history["cannot_claim_current_destination_installation"])
        self.assertTrue(self.history["cloud_storage_prior_deployment"]["transactional_schema_deployed"])
        self.assertTrue(self.history["quota_ledger_prior_deployment"]["production_applied"])
        self.assertEqual(self.ledger["historical_deployment_evidence"], self.runtime["historical_deployment_evidence"])
        self.assertEqual(self.ledger["destination_inventory_evidence"], self.runtime["destination_inventory_evidence"])
        self.assertEqual(self.evidence["related_storage_quota_migration_names_found"], [])
        self.assertTrue(self.evidence["destination_has_existing_auth_users"])

    def test_current_product_rollouts_remain_fail_closed(self):
        self.assertEqual(
            self.storage["status"],
            "source-foundation-destination-not-installed-rollout-disabled",
        )
        self.assertEqual(
            self.quotas["status"],
            "source-ledger-destination-not-installed-commercial-values-unassigned-rollout-disabled",
        )
        self.assertFalse(self.storage["invariants"]["provider_storage_is_authorization_source"])
        self.assertFalse(self.storage["provider"]["bucket_deployed_by_this_foundation"])
        self.assertFalse(self.ledger["live_private_tables_rls_enabled"])
        self.assertFalse(self.ledger["live_api_role_dml_denied_verified"])
        self.assertFalse(self.ledger["live_private_helpers_api_execute_denied_verified"])
        self.assertFalse(self.ledger["live_operational_status_service_role_only_verified"])


if __name__ == "__main__":
    unittest.main()
