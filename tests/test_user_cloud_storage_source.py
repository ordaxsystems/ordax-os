from __future__ import annotations

import json
import pathlib
import re
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261005171000_user_cloud_storage_foundation_v2.sql"
CONTRACT = ROOT / "docs/contracts/user-cloud-storage.json"


class UserCloudStorageSourceTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.sql = MIGRATION.read_text(encoding="utf-8")
        cls.contract = json.loads(CONTRACT.read_text(encoding="utf-8"))

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

    def test_rls_uses_policy_boundary_not_private_implementation_helper(self) -> None:
        self.assertIn("ordax_policy.can_access_space(space_id)", self.sql)
        self.assertNotIn("private.ordax_can_access_space", self.sql)

    def test_identity_and_space_deletion_cannot_erase_cleanup_evidence_early(self) -> None:
        self.assertNotIn("on delete cascade", self.sql.lower())
        self.assertGreaterEqual(self.sql.lower().count("on delete restrict"), 4)

    def test_rollout_remains_disabled_and_provider_is_not_authority(self) -> None:
        self.assertEqual(self.contract["status"], "source-foundation-rollout-disabled")
        self.assertFalse(self.contract["invariants"]["provider_storage_is_authorization_source"])
        self.assertFalse(self.contract["invariants"]["public_bucket_allowed"])
        self.assertFalse(self.contract["provider"]["bucket_deployed_by_this_foundation"])
        self.assertEqual(self.contract["quota"]["key"], "storage.user.bytes")
        self.assertFalse(self.contract["quota"]["numeric_limit_defined"])


if __name__ == "__main__":
    unittest.main()
