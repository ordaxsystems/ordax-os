import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MIGRATION = ROOT / "infra/supabase/product/migrations/20261003071000_user_cloud_storage_foundation_v1.sql"


class UserCloudStorageSourceTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.sql = MIGRATION.read_text(encoding="utf-8").lower()

    def test_metadata_is_not_directly_mutable_by_authenticated_clients(self):
        self.assertIn("revoke all on table public.ordax_user_objects from public, anon, authenticated", self.sql)
        self.assertIn("grant select on table public.ordax_user_objects to authenticated", self.sql)
        self.assertNotIn("grant insert on table public.ordax_user_objects to authenticated", self.sql)
        self.assertNotIn("grant update on table public.ordax_user_objects to authenticated", self.sql)
        self.assertNotIn("grant delete on table public.ordax_user_objects to authenticated", self.sql)

    def test_reservations_are_server_only(self):
        self.assertIn("private.ordax_user_upload_reservations", self.sql)
        self.assertIn(
            "revoke all on table private.ordax_user_upload_reservations from public, anon, authenticated",
            self.sql,
        )
        self.assertNotIn("grant select on table private.ordax_user_upload_reservations to authenticated", self.sql)

    def test_metadata_has_owner_digest_revision_and_lifecycle(self):
        for fragment in (
            "owner_user_id uuid not null references auth.users(id) on delete cascade",
            "sha256 text not null",
            "size_bytes bigint not null",
            "server_revision bigint not null",
            "state text not null default 'active'",
            "unique (provider, provider_bucket, provider_object_key)",
        ):
            self.assertIn(fragment, self.sql)

    def test_authenticated_read_policy_is_owner_scoped(self):
        self.assertIn("alter table public.ordax_user_objects enable row level security", self.sql)
        self.assertIn("owner_user_id = (select auth.uid())", self.sql)
        self.assertIn("private.ordax_can_access_space(space_id)", self.sql)

    def test_quota_key_is_structural_but_not_a_price_or_numeric_limit(self):
        self.assertIn("quota_key text not null default 'storage.user.bytes'", self.sql)
        self.assertNotIn("price", self.sql)
        self.assertNotIn("billing", self.sql)


if __name__ == "__main__":
    unittest.main()
