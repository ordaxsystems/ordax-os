#!/usr/bin/env python3
"""Regression tests for the pre-MVP ecosystem foundation."""

import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

FOUNDATION = ROOT / "docs" / "contracts" / "foundation.json"
ENTITLEMENTS = ROOT / "docs" / "contracts" / "entitlements.json"
SPACES = ROOT / "docs" / "contracts" / "spaces-and-profile-packs.json"
MEMORY = ROOT / "docs" / "contracts" / "memory.json"
CLOUD_MEMORY_SYNC = ROOT / "docs" / "contracts" / "cloud-memory-sync-boundary.json"
MODEL_ROUTER = ROOT / "docs" / "contracts" / "model-router.json"
APP_DISTRIBUTION = ROOT / "docs" / "contracts" / "app-distribution.json"
PROFILE_PROVISIONING = ROOT / "docs" / "contracts" / "profile-provisioning.json"
EXTERNAL_AI = ROOT / "docs" / "contracts" / "external-ai-bridge.json"
LEGAL_PACK = ROOT / "system" / "profile-packs" / "legal-br" / "v1" / "manifest.json"
DEVELOPER_PACK = ROOT / "system" / "profile-packs" / "developer" / "v1" / "manifest.json"
MIGRATION_1 = ROOT / "infra" / "supabase" / "product" / "migrations" / "0001_product_foundation.sql"
MIGRATION_3 = ROOT / "infra" / "supabase" / "product" / "migrations" / "0003_spaces_single_profile_pack_owner.sql"
MIGRATION_4 = ROOT / "infra" / "supabase" / "product" / "migrations" / "0004_server_authoritative_mutations.sql"
MIGRATION_5 = ROOT / "infra" / "supabase" / "product" / "migrations" / "0005_private_indexes_and_active_pack_catalog.sql"
SURFACE_WORKFLOW = ROOT / ".github" / "workflows" / "surface-web-candidate.yml"


class PreMvpEcosystemFoundationTests(unittest.TestCase):
    @staticmethod
    def load(path):
        return json.loads(path.read_text(encoding="utf-8"))

    def test_foundation_references_all_ecosystem_contracts(self):
        foundation = self.load(FOUNDATION)
        ecosystem = foundation["ecosystem_foundation"]
        self.assertEqual(ecosystem["status"], "pre-mvp-source-foundation")
        for relative_path in ecosystem["contracts"].values():
            self.assertTrue((ROOT / relative_path).is_file(), relative_path)
        self.assertTrue(ecosystem["memory_owned_by_ordax"])
        self.assertFalse(ecosystem["inference_provider_owns_memory"])
        self.assertFalse(ecosystem["product_mcp_reuses_development_owner_credentials"])
        self.assertTrue(ecosystem["github_project_access_prefers_github_app"])

    def test_commercial_foundation_does_not_turn_identity_into_paywall(self):
        foundation = self.load(FOUNDATION)
        plans = foundation["plans"]
        self.assertFalse(plans["billing_implemented"])
        self.assertFalse(plans["pricing_defined"])
        self.assertFalse(plans["commercial_tiers_defined"])
        self.assertFalse(plans["identity_is_plan_gated"])
        self.assertEqual(plans["provisional_private_space_limit"], 2)
        self.assertFalse(plans["profile_pack_categories_are_plan_locked"])

        entitlements = self.load(ENTITLEMENTS)
        self.assertTrue(entitlements["principles"]["identity_is_never_plan_gated"])
        self.assertTrue(entitlements["principles"]["offline_local_os_usage_is_never_plan_gated"])
        self.assertFalse(entitlements["principles"]["client_claimed_paid_state_is_authoritative"])

    def test_professional_profile_is_a_pack_on_a_space(self):
        contract = self.load(SPACES)
        self.assertTrue(contract["ownership"]["account_profile_is_not_a_professional_profile"])
        self.assertIn("professional", contract["space_kinds"])
        self.assertFalse(contract["profile_pack"]["may_auto_grant_privilege"])
        self.assertFalse(contract["profile_pack"]["may_install_unverified_code"])
        self.assertTrue(contract["profile_pack"]["knowledge_sources_require_provenance"])
        self.assertTrue(contract["profile_pack"]["knowledge_sources_require_freshness_policy"])

    def test_legal_pack_is_draft_and_requires_fresh_authoritative_sources(self):
        pack = self.load(LEGAL_PACK)
        self.assertEqual(pack["state"], "draft")
        self.assertEqual(pack["jurisdiction"], "BR")
        self.assertFalse(pack["activation"]["publicly_available"])
        self.assertTrue(pack["knowledge"]["source_date_required"])
        self.assertTrue(pack["knowledge"]["jurisdiction_required"])
        self.assertTrue(pack["knowledge"]["citation_required_for_retrieved_authority"])
        self.assertTrue(pack["knowledge"]["stale_knowledge_must_be_identified"])
        self.assertFalse(pack["intelligence"]["model_output_is_authoritative_source"])
        self.assertFalse(pack["security"]["auto_grant_privileges"])
        self.assertFalse(pack["security"]["allow_unsigned_apps"])

    def test_developer_pack_has_no_implicit_shell_or_privilege(self):
        pack = self.load(DEVELOPER_PACK)
        self.assertEqual(pack["state"], "draft")
        self.assertFalse(pack["security"]["auto_grant_privileges"])
        self.assertFalse(pack["security"]["generic_shell_implied"])

    def test_memory_belongs_to_ordax_and_semantic_index_is_derived(self):
        memory = self.load(MEMORY)
        self.assertTrue(memory["provider_neutral"])
        self.assertFalse(memory["model_owns_memory"])
        self.assertEqual(memory["scopes"], ["device", "account", "space", "project", "session"])
        self.assertTrue(memory["requirements"]["local_first"])
        self.assertTrue(memory["requirements"]["user_can_view"])
        self.assertTrue(memory["requirements"]["user_can_edit"])
        self.assertTrue(memory["requirements"]["user_can_delete"])
        self.assertFalse(memory["requirements"]["secret_material_as_memory_allowed"])
        self.assertTrue(memory["retrieval"]["semantic_index_is_derived_and_rebuildable"])

    def test_cloud_memory_sync_boundary_prevents_dual_source_of_truth(self):
        boundary = self.load(CLOUD_MEMORY_SYNC)
        self.assertFalse(boundary["public_mvp_enabled"])
        source = boundary["source_of_truth"]
        self.assertEqual(source["table"], "public.ordax_memory_items")
        self.assertEqual(source["sync_object_role"], "transport-mirror-only")
        self.assertFalse(source["independent_dual_write_allowed"])
        self.assertTrue(source["server_authoritative_atomic_write_required"])
        self.assertFalse(boundary["eligible_scopes"]["device"])
        self.assertFalse(boundary["eligible_scopes"]["project"])
        self.assertFalse(boundary["eligible_scopes"]["session"])
        self.assertEqual(
            boundary["authorization"]["entitlement_required"],
            "memory.cloud.enabled",
        )
        self.assertFalse(boundary["authorization"]["client_claimed_entitlement_trusted"])
        self.assertTrue(boundary["deletion"]["explicit_tombstone_required"])
        self.assertFalse(boundary["conflicts"]["silent_global_last_writer_wins"])
        self.assertEqual(boundary["conflicts"]["same_revision_divergence"], "reject")
        self.assertFalse(boundary["privacy"]["restricted_memory_cloud_sync_enabled"])

    def test_external_models_require_explicit_egress_and_do_not_own_memory(self):
        router = self.load(MODEL_ROUTER)
        self.assertTrue(router["rules"]["external_egress_requires_policy_and_user_visibility"])
        self.assertFalse(router["rules"]["memory_is_provider_owned"])
        self.assertTrue(router["rules"]["local_ai_remains_available_when_cloud_provider_unavailable"])

    def test_profile_provisioning_keeps_usb_light_and_install_fail_closed(self):
        provisioning = self.load(PROFILE_PROVISIONING)
        architecture = provisioning["architecture"]
        trust = provisioning["trust"]
        mvp = provisioning["mvp"]
        self.assertFalse(architecture["all_profile_payloads_preseeded_on_usb"])
        self.assertTrue(architecture["lightweight_catalog_metadata_may_be_bundled"])
        self.assertTrue(architecture["download_only_missing_components"])
        self.assertTrue(architecture["installed_profile_works_offline_when_local_dependencies_are_present"])
        self.assertTrue(architecture["space_and_memory_survive_profile_removal"])
        self.assertTrue(trust["available_remote_component_requires_sha256"])
        self.assertTrue(trust["available_remote_component_requires_signature"])
        self.assertFalse(trust["planned_component_is_installable"])
        self.assertFalse(trust["profile_may_auto_grant_privilege"])
        self.assertFalse(trust["unsigned_payload_install_allowed"])
        self.assertTrue(mvp["planner_enabled"])
        self.assertFalse(mvp["download_executor_enabled"])
        self.assertFalse(mvp["public_profile_install_enabled"])
        self.assertFalse(mvp["store_enabled"])
        self.assertEqual(mvp["legal_br"], "catalog-visible-activation-blocked")

    def test_profile_provisioning_gate_status_matches_implemented_source(self):
        provisioning = self.load(PROFILE_PROVISIONING)
        self.assertEqual(
            provisioning["completed_gates"],
            [
                "trusted-receipt-and-inventory-commit-after-verified-stage-health",
                "trusted-profile-provisioning-executor-verifies-package-writes-receipt-and-inventory",
                "profile-health-and-rollback",
                "surface-profile-catalog-ui",
            ],
        )
        self.assertEqual(
            provisioning["next_gates"],
            ["first-public-profile-proof"],
        )
        self.assertFalse(provisioning["mvp"]["public_profile_install_enabled"])
        self.assertFalse(provisioning["content_proof"]["public_release_trust_pinned"])
        self.assertFalse(provisioning["content_proof"]["activation_allowed"])
        handoff = provisioning["publication_handoff"]
        self.assertEqual(
            handoff["schema"],
            "prototype-ordax.profile-content-publication-handoff/1",
        )
        self.assertEqual(
            handoff["trust_policy"],
            "docs/contracts/profile-content-trust-policy.json",
        )
        self.assertTrue(handoff["exact_manifest_sha256_required"])
        self.assertTrue(handoff["exact_content_sha256_required"])
        self.assertFalse(handoff["private_key_access"])
        self.assertFalse(handoff["envelope_emitted"])
        self.assertTrue(handoff["canonical_anchor_must_be_unpinned"])
        self.assertTrue(handoff["publication_must_remain_disabled"])
        self.assertTrue(handoff["installation_must_remain_disabled"])
        self.assertTrue(handoff["activation_must_remain_disabled"])
        self.assertFalse(handoff["output_is_publication_evidence"])

    def test_store_foundation_never_bypasses_trust_or_permissions(self):
        distribution = self.load(APP_DISTRIBUTION)
        security = distribution["security"]
        self.assertFalse(security["unsigned_third_party_install_allowed"])
        self.assertFalse(security["profile_pack_may_bypass_package_verification"])
        self.assertFalse(security["profile_pack_may_auto_grant_permissions"])
        self.assertTrue(security["failed_update_preserves_working_version"])
        self.assertFalse(distribution["mvp"]["third_party_installation_enabled"])
        self.assertFalse(distribution["mvp"]["store_ui_enabled"])

    def test_product_mcp_uses_ordax_oauth_and_scoped_github_app_access(self):
        bridge = self.load(EXTERNAL_AI)
        self.assertEqual(bridge["transport"], "mcp")
        self.assertTrue(bridge["authentication"]["user_authenticates_to_ordax"])
        self.assertTrue(bridge["authentication"]["oauth_2_1_required_for_remote_clients"])
        self.assertTrue(bridge["authentication"]["pkce_required_for_public_clients"])
        self.assertFalse(bridge["authentication"]["development_owner_mcp_credentials_reusable_for_end_users"])
        self.assertEqual(bridge["project_sources"]["preferred_github_integration"], "github-app")
        self.assertTrue(bridge["project_sources"]["repository_allowlist_required"])
        self.assertFalse(bridge["project_sources"]["github_token_exposed_to_external_ai"])
        self.assertIn("generic-shell", bridge["forbidden"])
        self.assertIn("unscoped-github-account", bridge["forbidden"])
        direct = bridge["access_modes"]["direct_github_connector"]
        self.assertTrue(direct["supported"])
        self.assertFalse(direct["ordax_account_required"])
        self.assertFalse(direct["ordax_memory_granted"])
        self.assertFalse(direct["local_device_control_granted"])
        self.assertTrue(bridge["access_modes"]["coexistence_supported"])
        self.assertEqual(
            bridge["device_runtime"]["product_name"],
            "OrdaX Device Agent",
        )
        self.assertTrue(bridge["device_runtime"]["web_and_mcp_share_action_gateway"])

    def test_supabase_product_migration_has_rls_vector_and_no_provider_tokens(self):
        sql = MIGRATION_1.read_text(encoding="utf-8").lower()
        self.assertIn("create extension if not exists vector with schema extensions", sql)
        for table in (
            "ordax_accounts",
            "ordax_spaces",
            "ordax_space_members",
            "ordax_entitlement_grants",
            "ordax_profile_packs",
            "ordax_space_profile_packs",
            "ordax_memory_items",
            "ordax_memory_embeddings",
            "ordax_project_connections",
        ):
            self.assertIn(f"alter table public.{table} enable row level security", sql)
            self.assertIn(f"revoke all on table public.{table} from public, anon, authenticated", sql)
        for forbidden in ("github_token", "openai_api_key", "xai_api_key", "service_role_key"):
            self.assertNotIn(forbidden, sql)

    def test_space_pack_has_one_source_of_truth_and_owner_identity_is_immutable_to_client(self):
        sql = MIGRATION_3.read_text(encoding="utf-8").lower()
        self.assertIn("drop column if exists profile_pack_slug", sql)
        self.assertIn("revoke update on table public.ordax_spaces from authenticated", sql)
        self.assertIn("grant update (name, state, metadata)", sql)
        self.assertNotIn("owner_user_id)", sql)

    def test_scoped_product_mutations_are_server_authoritative(self):
        sql = MIGRATION_4.read_text(encoding="utf-8").lower()
        for table in (
            "ordax_spaces",
            "ordax_space_members",
            "ordax_memory_items",
            "ordax_memory_embeddings",
            "ordax_project_connections",
            "ordax_space_profile_packs",
            "ordax_entitlement_grants",
            "ordax_profile_packs",
        ):
            self.assertIn(
                f"revoke insert, update, delete on table public.{table} from authenticated",
                sql,
            )
        self.assertIn(
            "grant update (display_name) on table public.ordax_accounts to authenticated",
            sql,
        )


    def test_draft_packs_and_raw_embeddings_are_not_client_visible(self):
        sql = MIGRATION_5.read_text(encoding="utf-8").lower()
        self.assertIn(
            "using (state = 'active')",
            sql,
        )
        self.assertIn(
            "revoke select on table public.ordax_memory_embeddings from authenticated",
            sql,
        )

    def test_ecosystem_javascript_contracts_are_wired_into_surface_ci(self):
        workflow = SURFACE_WORKFLOW.read_text(encoding="utf-8")
        for path in (
            "system/contracts/entitlements.mjs",
            "system/contracts/spaces.mjs",
            "system/contracts/memory.mjs",
            "system/contracts/model-router.mjs",
            "tests/test_ecosystem_contracts.mjs",
        ):
            self.assertGreaterEqual(workflow.count(path), 2, path)
        self.assertIn(
            "node --test tests/test_ecosystem_contracts.mjs",
            workflow,
        )


if __name__ == "__main__":
    unittest.main()
