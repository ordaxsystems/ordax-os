import json
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MVP_CLOUD = ROOT / "docs/contracts/mvp-account-cloud.json"
USER_STORAGE = ROOT / "docs/contracts/user-cloud-storage.json"
PUBLIC_IDENTITY = ROOT / "docs/contracts/public-identity.json"
CLOUD_MEMORY = ROOT / "docs/contracts/cloud-memory-sync-boundary.json"
ENTITLEMENTS = ROOT / "docs/contracts/entitlements.json"


class MvpAccountCloudContractTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.mvp = json.loads(MVP_CLOUD.read_text(encoding="utf-8"))
        cls.storage = json.loads(USER_STORAGE.read_text(encoding="utf-8"))
        cls.identity = json.loads(PUBLIC_IDENTITY.read_text(encoding="utf-8"))
        cls.memory = json.loads(CLOUD_MEMORY.read_text(encoding="utf-8"))
        cls.entitlements = json.loads(ENTITLEMENTS.read_text(encoding="utf-8"))

    def test_account_cloud_is_mvp_required_but_not_boot_required(self):
        self.assertTrue(self.mvp["mvp_required"])
        self.assertFalse(self.mvp["account_required_for_boot"])
        self.assertTrue(self.mvp["local_offline_product_must_remain_usable"])

    def test_pricing_and_billing_are_not_activation_authority(self):
        self.assertFalse(self.mvp["pricing_required_for_mvp"])
        self.assertFalse(self.mvp["billing_activation_required_for_mvp"])
        self.assertFalse(self.entitlements["commercial_policy"]["billing_implemented"])
        self.assertFalse(self.entitlements["commercial_policy"]["prices_defined"])

    def test_current_public_account_and_memory_rollout_remain_fail_closed(self):
        self.assertFalse(self.identity["backend"]["public_auth_enabled"])
        self.assertFalse(self.identity["backend"]["account_registration_enabled"])
        self.assertFalse(self.identity["backend"]["public_cloud_memory_enabled"])
        self.assertFalse(self.memory["public_mvp_enabled"])
        self.assertFalse(self.memory["implementation"]["public_rollout_enabled"])

    def test_memory_never_sync_boundaries_are_preserved(self):
        self.assertFalse(self.memory["eligible_scopes"]["device"])
        self.assertFalse(self.memory["eligible_scopes"]["session"])
        self.assertFalse(self.memory["privacy"]["restricted_memory_cloud_sync_enabled"])
        self.assertFalse(self.memory["privacy"]["provider_tokens_in_memory_payload_allowed"])
        self.assertFalse(self.mvp["cloud_memory"]["restricted_memory_cloud_sync_allowed"])

    def test_user_object_storage_starts_private_and_disabled(self):
        self.assertTrue(self.storage["mvp_required"])
        self.assertFalse(self.storage["public_rollout_enabled"])
        self.assertFalse(self.storage["principles"]["public_bucket_allowed"])
        self.assertFalse(self.storage["mvp_provider_adapter"]["bucket_currently_deployed"])
        self.assertFalse(self.storage["authorization"]["service_role_in_client_allowed"])
        self.assertFalse(self.storage["quota"]["numeric_limit_defined"])

    def test_user_storage_cannot_turn_provider_or_client_into_authority(self):
        self.assertFalse(self.storage["principles"]["provider_storage_is_authorization_source"])
        self.assertFalse(self.storage["principles"]["client_claimed_quota_or_usage_is_authority"])
        self.assertTrue(self.storage["upload_protocol"]["server_reservation_required"])
        self.assertTrue(self.storage["upload_protocol"]["finalization_must_verify_size_and_digest"])
        self.assertFalse(self.storage["upload_protocol"]["upload_authorization_creates_action_gateway_authority"])

    def test_account_close_is_durable_and_provider_cleanup_precedes_identity_delete(self):
        close = self.mvp["account_close"]
        deletion = self.storage["deletion"]
        self.assertTrue(close["durable_cleanup_journal_required"])
        self.assertTrue(close["journal_must_survive_auth_identity_delete"])
        self.assertTrue(close["provider_blob_references_must_be_copied_before_identity_delete"])
        self.assertTrue(close["provider_cleanup_must_be_verified_before_identity_delete"])
        self.assertTrue(close["durable_auth_fence_required_before_identity_delete"])
        self.assertTrue(deletion["close_journal_survives_identity_deletion"])
        self.assertTrue(deletion["provider_references_copied_before_identity_delete"])
        self.assertTrue(deletion["identity_delete_requires_verified_provider_cleanup"])
        self.assertTrue(deletion["identity_delete_requires_durable_auth_fence"])

    def test_account_close_denies_stale_tokens_and_protects_shared_spaces(self):
        close = self.mvp["account_close"]
        deletion = self.storage["deletion"]
        self.assertTrue(close["stale_access_jwt_must_lose_ordax_data_plane_access"])
        self.assertTrue(close["owned_shared_space_requires_transfer_before_close"])
        self.assertTrue(deletion["stale_access_jwt_data_plane_denied_after_close_begins"])
        self.assertTrue(deletion["owned_shared_space_requires_transfer_before_account_close"])

    def test_cleanup_worker_is_source_ready_but_rollout_disabled(self):
        close = self.mvp["account_close"]
        backend = self.identity["backend"]
        self.assertTrue(close["cleanup_worker_source_implemented"])
        self.assertFalse(close["cleanup_worker_enabled_in_source"])
        self.assertFalse(close["cleanup_worker_deployed"])
        self.assertFalse(close["public_gateway_pending_state_handling_implemented"])
        self.assertTrue(backend["account_close_cleanup_worker_source_implemented"])
        self.assertFalse(backend["account_close_cleanup_worker_enabled_in_source"])
        self.assertFalse(backend["account_close_cleanup_worker_deployed"])
        self.assertFalse(backend["account_close_pending_gateway_response_implemented"])
        self.assertFalse(backend["account_close_enabled"])


if __name__ == "__main__":
    unittest.main()
