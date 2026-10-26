from __future__ import annotations

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261005171000_user_cloud_storage_foundation_v2.sql"
CONTRACT = ROOT / "docs/contracts/user-cloud-storage.json"
HARDENING = ROOT / "infra/supabase/product/migrations/20261007015500_user_cloud_storage_private_rls_hardening_v1.sql"
QUOTA_LINK = ROOT / "infra/supabase/product/migrations/20261007083746_user_cloud_storage_quota_reservation_link_v1.sql"


class UserCloudStorageSourceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))
        cls.hardening_sql = HARDENING.read_text(encoding="utf-8")
        cls.quota_link_sql = QUOTA_LINK.read_text(encoding="utf-8")

    def test_public_metadata_does_not_expose_provider_location(self) -> None:
        public_section = self.sql.split(
            "create table private.ordax_user_object_provider_refs", 1
        )[0]
        self.assertNotIn("provider_bucket", public_section)
        self.assertNotIn("provider_object_key", public_section)
        self.assertIn("create table private.ordax_user_object_provider_refs", self.sql)

    def test_client_surface_is_select_only_and_private_state_has_no_api_grants(self) -> None:
        self.assertIn(
            "grant select on table public.ordax_user_objects to authenticated;",
            self.sql,
        )
        self.assertNotRegex(
            self.sql,
            r"grant\s+(insert|update|delete|all).*ordax_user_objects.*authenticated",
        )
        for table in (
            "private.ordax_user_object_provider_refs",
            "private.ordax_user_upload_reservations",
        ):
            pattern = rf"revoke all on table {re.escape(table)}\s+from public, anon, authenticated, service_role;"
            self.assertRegex(self.sql, pattern)

    def test_private_provider_state_has_defense_in_depth_rls(self) -> None:
        for table in (
            "private.ordax_user_object_provider_refs",
            "private.ordax_user_upload_reservations",
        ):
            self.assertIn(
                f"alter table {table} enable row level security;",
                self.hardening_sql,
            )
            pattern = rf"revoke all on table {re.escape(table)}\s+from public, anon, authenticated, service_role;"
            self.assertRegex(self.hardening_sql, pattern)
        self.assertNotRegex(
            self.hardening_sql,
            r"create\s+policy|grant\s+.*\s+to\s+(anon|authenticated|service_role)",
        )

    def test_upload_reservation_is_bound_to_one_exact_quota_reservation(self) -> None:
        self.assertIn("add column quota_reservation_id uuid;", self.quota_link_sql)
        self.assertIn(
            "add constraint ordax_user_upload_reservations_quota_reservation_id_key\n  unique (quota_reservation_id);",
            self.quota_link_sql,
        )
        self.assertIn(
            "references private.ordax_service_quota_reservations(reservation_id)\n  on delete restrict;",
            self.quota_link_sql,
        )
        self.assertIn("alter column quota_reservation_id set not null;", self.quota_link_sql)
        self.assertNotRegex(
            self.quota_link_sql,
            r"grant\s+.*\s+to\s+(anon|authenticated|service_role)|create\s+policy",
        )

    def test_rls_uses_policy_boundary_not_private_implementation_helper(self) -> None:
        self.assertIn("ordax_policy.can_access_space(space_id)", self.sql)
        self.assertNotIn("private.ordax_can_access_space", self.sql)

    def test_identity_and_space_deletion_cannot_erase_cleanup_evidence_early(self) -> None:
        self.assertNotIn("on delete cascade", self.sql.lower())
        self.assertGreaterEqual(self.sql.lower().count("on delete restrict"), 4)
        self.assertIn("on delete restrict", self.quota_link_sql.lower())

    def test_domain_identity_contract_matches_transactional_schema(self) -> None:
        identity = self.contract["identity_contract"]
        self.assertEqual(identity["account_id"], "uuid")
        self.assertEqual(identity["space_id"], "uuid-or-null")
        self.assertEqual(identity["object_id"], "uuid")
        self.assertEqual(identity["reservation_id"], "uuid")
        self.assertEqual(identity["server_revision_min"], 1)
        self.assertEqual(
            identity["provider_values"],
            ["supabase-storage", "cloudflare-r2", "other"],
        )

    def test_rollout_remains_disabled_and_provider_is_not_authority(self) -> None:
        self.assertEqual(self.contract["status"], "source-foundation-rollout-disabled")
        self.assertFalse(self.contract["invariants"]["provider_storage_is_authorization_source"])
        self.assertFalse(self.contract["invariants"]["public_bucket_allowed"])
        self.assertTrue(self.contract["invariants"]["reservation_bound_to_exact_quota_reservation"])
        self.assertFalse(self.contract["invariants"]["quota_reservation_identity_may_be_inferred_from_size_or_subject"])
        self.assertFalse(self.contract["provider"]["bucket_deployed_by_this_foundation"])
        self.assertEqual(self.contract["quota"]["key"], "storage.user.bytes")
        self.assertTrue(self.contract["quota"]["upload_reservation_must_reference_exact_quota_reservation"])
        self.assertFalse(self.contract["quota"]["numeric_limit_defined"])

    def test_destination_installation_is_verified_and_rollout_disabled(self) -> None:
        self.assertEqual(self.contract["status"], "source-foundation-destination-not-installed-rollout-disabled")
        deployment = self.contract["deployment"]
        self.assertFalse(deployment["transactional_schema_deployed"])
        self.assertIsNone(deployment["deployed_migration"])
        self.assertFalse(deployment["private_tables_rls_hardening"]["production_applied"])
        self.assertFalse(deployment["quota_reservation_link"]["production_applied"])
        self.assertFalse(deployment["public_rollout_enabled"])
        self.assertFalse(deployment["replay_historical_migrations_unmodified_allowed"])
        self.assertFalse(deployment["server_mutation_executor_deployed"])
        self.assertTrue(all(v is False for v in deployment["observed_tables"].values()))

    def test_historical_deployment_is_not_promoted_to_destination(self) -> None:
        deployment = self.contract["deployment"]
        evidence = json.loads((ROOT / deployment["destination_inventory_evidence"]).read_text())
        history = json.loads((ROOT / deployment["historical_deployment_evidence"]).read_text())
        self.assertEqual(evidence["target_project_ref"], deployment["target_project_ref"])
        self.assertTrue(evidence["destination_has_existing_auth_users"])
        self.assertEqual(len(evidence["tables"]), 5)
        self.assertTrue(all(value is False for value in evidence["tables"].values()))
        self.assertTrue(history["cloud_storage_prior_deployment"]["transactional_schema_deployed"])
        self.assertTrue(history["cannot_claim_current_destination_installation"])


if __name__ == "__main__":
    unittest.main()
