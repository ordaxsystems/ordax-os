import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  MVP_APP_DELIVERY_SCHEMA,
  MVP_FIRST_ONLINE_REFRESH_SCHEMA,
  getMvpAppDeliveryPolicy,
  planMvpFirstOnlineRefresh,
} from "../system/services/apps/mvp-delivery-policy.mjs";

const rootUrl = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), "utf8"));
}

function sorted(values) {
  return [...values].sort();
}

test("minimal MVP surface keeps only structural plus Files and Internet as launch blockers", async () => {
  const policy = getMvpAppDeliveryPolicy();
  const contract = await json("docs/contracts/mvp-app-delivery.json");
  const distribution = await json("docs/contracts/app-distribution.json");

  assert.equal(policy.schema, MVP_APP_DELIVERY_SCHEMA);
  assert.equal(policy.authority, "none");
  assert.equal(policy.optionalAppsBlockPublicLaunch, false);
  assert.equal(policy.networkSkipPreservesUsableOfflineSystem, true);

  assert.deepEqual(sorted(policy.structuralAppIds), ["account", "settings", "store", "system"]);
  assert.deepEqual(sorted(policy.bundledBootstrapAppIds), ["files", "internet"]);
  assert.deepEqual(
    sorted(policy.onDemandAppIds),
    ["activity", "assistant", "network", "notes", "projects", "studio"],
  );

  assert.deepEqual(sorted(contract.initial_usb.structural_app_ids), sorted(policy.structuralAppIds));
  assert.deepEqual(sorted(contract.initial_usb.bootstrap_app_ids), sorted(policy.bundledBootstrapAppIds));
  assert.deepEqual(sorted(contract.initial_usb.on_demand_app_ids), sorted(policy.onDemandAppIds));
  assert.equal(contract.initial_usb.optional_apps_block_public_launch, false);
  assert.equal(contract.initial_usb.physical_payload_shrink_required_before_public_launch, false);
  assert.equal(contract.initial_usb.current_image_may_retain_dormant_on_demand_payloads, true);
  assert.equal(distribution.mvp.optional_apps_block_public_launch, false);
  assert.equal(contract.launch_scope.notes_completion_required_before_public_launch, false);
  assert.equal(contract.launch_scope.store_functionality_required_before_public_launch, false);
});

test("offline First Run stays usable and defers successful update discovery", async () => {
  const firstRun = await json("docs/contracts/first-run.json");
  const plan = planMvpFirstOnlineRefresh({ online: false });

  assert.equal(plan.schema, MVP_FIRST_ONLINE_REFRESH_SCHEMA);
  assert.equal(plan.state, "offline");
  assert.equal(plan.checkBaseUpdate, false);
  assert.equal(plan.refreshSignedAppCatalog, false);
  assert.deepEqual(plan.ensureBootstrapAppIds, []);
  assert.equal(plan.blocksFirstRunCompletion, false);
  assert.equal(plan.authority, "none");

  assert.equal(firstRun.network.skippable, true);
  assert.equal(firstRun.network.offline_skip_defers_successful_discovery, true);
  assert.equal(firstRun.network.update_discovery_failure_must_not_block_completion, true);
});

test("first online state reuses the Stable supervisor update owner without making OOBE a second updater", async () => {
  const contract = await json("docs/contracts/mvp-app-delivery.json");
  const distribution = await json("docs/contracts/app-distribution.json");
  const firstRun = await json("docs/contracts/first-run.json");
  const plan = planMvpFirstOnlineRefresh({ online: true });

  assert.equal(plan.schema, MVP_FIRST_ONLINE_REFRESH_SCHEMA);
  assert.equal(plan.state, "online-refresh-required");
  assert.equal(plan.checkBaseUpdate, true);
  assert.equal(plan.refreshSignedAppCatalog, true);
  assert.deepEqual(sorted(plan.ensureBootstrapAppIds), ["files", "internet"]);
  assert.deepEqual(
    sorted(plan.onDemandAppIds),
    ["activity", "assistant", "network", "notes", "projects", "studio"],
  );
  assert.equal(plan.onDemandAutoInstall, false);
  assert.equal(plan.blocksFirstRunCompletion, false);
  assert.equal(plan.authority, "none");

  assert.equal(firstRun.network.first_online_update_policy, "docs/contracts/mvp-app-delivery.json");
  assert.equal(firstRun.network.successful_connection_makes_official_update_discovery_reachable, true);
  assert.equal(firstRun.network.update_discovery_owner, "system/supervisor");
  assert.equal(firstRun.network.update_discovery_transport, "official-signed-release-channel");
  assert.equal(firstRun.network.update_discovery_mode, "periodic-signed-channel-polling");
  assert.equal(firstRun.network.update_discovery_default_interval_seconds, 60);
  assert.equal(firstRun.network.direct_oobe_update_executor_allowed, false);
  assert.equal(firstRun.network.direct_oobe_wake_required_for_launch, false);
  assert.equal(firstRun.network.retry_after_first_run_owned_by_supervisor, true);
  assert.equal(firstRun.network.runtime_update_polling_status, "source-connected-physical-proof-pending");

  assert.equal(contract.first_online_refresh.discovery_owner, "system/supervisor");
  assert.equal(contract.first_online_refresh.discovery_mode, "periodic-signed-channel-polling");
  assert.equal(contract.first_online_refresh.default_interval_seconds, 60);
  assert.equal(contract.first_online_refresh.check_official_base_update, true);
  assert.equal(contract.first_online_refresh.ensure_current_bootstrap_apps, true);
  assert.equal(contract.first_online_refresh.refresh_signed_first_party_app_catalog, true);
  assert.equal(contract.first_online_refresh.auto_install_on_demand_apps, false);
  assert.equal(contract.evolution.store_or_catalog_may_mint_install_authority, false);
  assert.equal(distribution.security.first_online_catalog_refresh_may_mint_install_authority, false);
});

test("signed Stable releases can add optional first-party apps without making independent app delivery a launch blocker", async () => {
  const contract = await json("docs/contracts/mvp-app-delivery.json");

  assert.equal(contract.launch_delivery.owner, "system/supervisor");
  assert.equal(contract.launch_delivery.transport, "official-signed-release-channel");
  assert.equal(contract.launch_delivery.optional_app_completion_may_arrive_via_signed_stable_release, true);
  assert.equal(contract.launch_delivery.signed_stable_release_may_add_or_upgrade_first_party_apps, true);
  assert.equal(contract.launch_delivery.usb_reimage_required_for_later_first_party_app_addition, false);
  assert.equal(contract.launch_delivery.independent_component_slot_delivery_required_before_public_launch, false);
  assert.equal(contract.launch_delivery.store_required_before_public_launch, false);
});

test("future independent app delivery remains hardened but is a post-launch optimization", async () => {
  const contract = await json("docs/contracts/mvp-app-delivery.json");

  assert.equal(contract.evolution.new_first_party_app_may_start_on_demand, true);
  assert.equal(contract.evolution.promote_to_bootstrap_requires_signed_release_policy_change, true);
  assert.equal(contract.evolution.bootstrap_promotion_may_provision_app_without_reimaging_usb, true);
  assert.equal(contract.evolution.independent_app_delivery_is_post_launch_optimization, true);

  assert.deepEqual(contract.independent_delivery_pipeline, [
    "catalog",
    "artifact-identity",
    "trust-provenance",
    "compatibility",
    "stage",
    "health-probation",
    "promote",
    "inventory-receipt",
  ]);

  assert.equal(contract.independent_delivery_transition_gate.does_not_block_first_public_launch, true);
  const required = new Set(
    contract.independent_delivery_transition_gate
      .remove_dormant_on_demand_payloads_from_base_when_independent_delivery_is_used_only_after,
  );
  for (const proof of [
    "native-installed-inventory-proof",
    "verified-first-install-proof",
    "reinstall-proof",
    "offline-retained-installed-app-proof",
    "failed-update-keeps-last-known-good-proof",
    "rollback-proof",
    "uninstall-keeps-user-data-proof",
  ]) {
    assert.equal(required.has(proof), true, `missing delivery proof gate ${proof}`);
  }
});

test("first-online planner rejects ambiguous connectivity instead of guessing", () => {
  assert.throws(() => planMvpFirstOnlineRefresh({ online: "yes" }), /boolean online state/);
  assert.throws(() => planMvpFirstOnlineRefresh({}), /boolean online state/);
});

test("optional Windows runtime development cannot become a public MVP launch dependency", async () => {
  const policy = await json("docs/contracts/mvp-app-delivery.json");
  const compatibility = await json("docs/contracts/application-compatibility.json");
  const wine = await json("bootstrap/windows-compat-runtime/source.json");
  const delivery = policy.optional_platform_runtimes;

  assert.deepEqual(delivery.non_blocking_capability_contracts, [
    "docs/contracts/application-compatibility.json",
  ]);
  assert.equal(delivery.candidate_runtime_build_completion_blocks_public_launch, false);
  assert.equal(delivery.unverified_runtime_included_in_minimal_usb, false);
  assert.equal(delivery.unverified_runtime_may_be_advertised_as_executable, false);
  assert.equal(delivery.future_runtime_activation_requires_independent_artifact_trust_and_sandbox_proof, true);
  assert.equal(delivery.future_runtime_activation_must_not_modify_boot_or_first_run_requirements, true);
  assert.equal(delivery.cannot_override_canonical_public_release_or_physical_promotion_gates, true);

  // The compatibility contract is the SSOT for actual runtime availability.
  // MVP launch scope never translates Wine source/build CI into an execution grant.
  assert.equal(compatibility.boot_critical, false);
  assert.equal(compatibility.security.runtime_failure_blocks_boot, false);
  assert.equal(compatibility.execution_available, false);
  assert.equal(compatibility.installation_available, false);
  assert.equal(compatibility.profile_creation_available, false);
  assert.equal(compatibility.public_availability, false);
  assert.equal(compatibility.security.runtime_source_proof_grants_activation, false);
  assert.equal(compatibility.security.runtime_source_proof_grants_execution, false);

  assert.equal(wine.product_scope, "owner-development-only");
  assert.equal(wine.security.boot_critical, false);
  assert.equal(wine.distribution.stable_base_inclusion_allowed, false);
  assert.equal(wine.distribution.stable_mvp_activation_allowed, false);
  assert.equal(wine.distribution.network_download_at_runtime_allowed, false);
  assert.equal(wine.distribution.signed_component_required_before_activation, true);
  assert.equal(wine.distribution.content_addressed_artifact_required_before_activation, true);

  // Essential signed-release and First Run paths remain required and independent.
  assert.deepEqual(sorted(policy.initial_usb.bootstrap_app_ids), ["files", "internet"]);
  assert.equal(policy.launch_delivery.transport, "official-signed-release-channel");
  assert.equal(policy.first_online_refresh.failure_must_not_block_first_run_completion, true);
  assert.equal(policy.launch_delivery.independent_component_slot_delivery_required_before_public_launch, false);
});
