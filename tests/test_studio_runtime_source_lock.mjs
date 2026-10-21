import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const SOURCE_LOCK_PATH = new URL(
  "../system/services/device-agent/studio-runtime-source-lock.json",
  import.meta.url,
);
const INTEGRATION_PATH = new URL(
  "../docs/contracts/studio-runtime-integration.json",
  import.meta.url,
);
const ENROLLMENT_PATH = new URL(
  "../infra/supabase/development/functions/ordax-development-github-enroll/index.ts",
  import.meta.url,
);

async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("Studio runtime source lock pins the merged headless compatibility contract", async () => {
  const lock = await readJson(SOURCE_LOCK_PATH);

  assert.equal(lock.$schema, "prototype-ordax.studio-runtime-source-lock/1");
  assert.equal(lock.source.repository, "https://github.com/ordaxsystems/ordax-runtime");
  assert.match(lock.source.commit, /^[0-9a-f]{40}$/);
  assert.equal(lock.source.commit, "eaf47d2adc1c8be54a4240e1fbe539a3cda44649");
  assert.deepEqual(lock.source.compatibility_contract, {
    path: "docs/contracts/ordax-os-runtime-compatibility.json",
    schema: "ordax.studio-runtime-compatibility/1",
    sha256: "34d889808e9f79412580422a5d7fa7c182f5d50e9dba07eb07934af5aff790f8",
    product_version: "0.4.7",
  });

  assert.equal(lock.runtime.profile, "headless");
  assert.equal(lock.runtime.python, ">=3.11");
  assert.deepEqual(lock.runtime.entrypoints, ["ordax-dev-agent", "ordax-device-agent"]);
  assert.equal(lock.runtime.device_agent_schema, "ordax.device-agent/1");
  assert.equal(
    lock.runtime.capability_reader_schema,
    "ordax.device-agent-capability-reader/1",
  );
  // Pin provenance only; runtime code, grant evaluation and execution stay
  // in the canonical ordax-runtime/Platform owners, not in this OS lock.
  assert.equal(
    lock.runtime.product_transport_owner,
    "ordax_dev_agent.product_device_control_plane.ProductDeviceControlPlane",
  );
  assert.equal(lock.runtime.product_transport_path, "/v3/device/transport");
  assert.deepEqual(lock.runtime.product_transport_operations, [
    "heartbeat", "claim", "start", "lease", "progress", "report", "recover-report",
  ]);
  assert.equal(
    lock.runtime.central_attestation_owner,
    "ordax_dev_agent.product_central_session.ProductCentralSessionClient",
  );
  assert.equal(lock.runtime.native_device_identity_provider, "ProductDeviceIdentityStore.read_enrolled_credential");
  assert.equal(lock.runtime.native_identity_provider_supported, true);
  // The upstream compatibility contract names the canonical inner dispatcher.
  assert.equal(lock.runtime.native_composition_entrypoint, "ordax_dev_agent.main.run");
  // The separate Linux executable enters through native_main, then dispatches.
  assert.equal(lock.runtime.native_executable_name, "ordax-product-agent");
  assert.equal(lock.runtime.native_executable_source, "native/ordax-product-agent/entrypoint.py");
  assert.equal(lock.runtime.native_executable_entrypoint, "ordax_dev_agent.native_main.main");
  assert.notEqual(lock.runtime.native_composition_entrypoint, lock.runtime.native_executable_entrypoint);
  assert.equal(lock.runtime.native_composition_explicit_config_required, true);
  assert.equal(lock.runtime.native_composition_main_thread_required, true);
  assert.equal(lock.runtime.native_composition_uses_canonical_dispatch_loop, true);
  assert.equal(lock.runtime.device_id_match_required, true);
  assert.equal(lock.runtime.duplicate_persisted_token_forbidden, true);
  assert.equal(lock.runtime.runtime_kind_authority, "upstream-compatibility-contract:ordax_os.native_runtime_kind");
});

test("Studio runtime source lock is source-only and cannot silently activate dispatch", async () => {
  const lock = await readJson(SOURCE_LOCK_PATH);

  assert.equal(lock.distribution.runtime_packaged_in_stable, false);
  assert.equal(lock.distribution.runtime_network_download_allowed, false);
  assert.equal(lock.distribution.runtime_artifact_claimed, false);
  assert.equal(lock.distribution.source_binding_only, true);
  assert.equal(lock.distribution.signed_runtime_slot_available, false);
  assert.equal(lock.distribution.activation_channel, "ordax-runtime-component-channel");

  for (const owner of [
    "identity_owner",
    "spaces_owner",
    "permissions_owner",
    "intelligence_owner",
    "memory_owner",
    "model_router_owner",
  ]) {
    assert.equal(lock.authority[owner], "ordax-os");
  }
  assert.equal(lock.authority.same_action_gateway_required, true);
  assert.equal(lock.authority.surface_raw_execute_forbidden, true);
  assert.equal(lock.authority.parallel_runtime_forbidden, true);

  assert.equal(lock.activation.capability_discovery_contract_pinned, true);
  assert.equal(lock.activation.dispatch_enabled, false);
  assert.equal(lock.activation.action_gateway_activation_required, true);
  assert.equal(lock.activation.boot_critical, false);
  assert.equal(lock.activation.attestation_enabled, false);
  assert.equal(lock.activation.requires_signed_runtime_slot, true);
  assert.equal(lock.activation.requires_runtime_health_proof, true);
  assert.equal(lock.activation.requires_product_oauth_client_consent, true);
  assert.equal(lock.activation.requires_device_scoped_grants, true);
  assert.equal(lock.activation.requires_native_policy, true);
  assert.equal(lock.activation.intelligence_grants_do_not_authorize_remote_actions, true);
  assert.equal(lock.activation.single_device_heartbeat_owner_required, true);
  assert.equal(lock.activation.verified_os_runtime_provenance_required, true);
});

test("Studio integration consumes the source lock without widening Surface authority", async () => {
  const integration = await readJson(INTEGRATION_PATH);

  assert.equal(
    integration.status,
    "source-pinned-authorization-runtime-dispatch-disabled",
  );
  assert.equal(
    integration.runtime_source.source_lock_path,
    "system/services/device-agent/studio-runtime-source-lock.json",
  );
  assert.equal(integration.runtime_source.source_binding_status, "pinned");
  assert.equal(integration.runtime_source.same_action_gateway_required, true);
  assert.equal(integration.runtime_source.parallel_runtime_forbidden, true);

  assert.equal(integration.mutations.runtime_enabled, false);
  assert.equal(integration.mutations.authorization_runtime_enabled, true);
  assert.equal(integration.mutations.dispatch_runtime_enabled, false);
  assert.equal(integration.mutations.authorization_dispatch_authority, "none");
  assert.equal(integration.mutations.direct_device_agent_execute_from_surface_forbidden, true);
  assert.equal(integration.mutations.same_action_gateway_required, true);

  assert.equal(integration.activation_gate.source_binding_pinned, true);
  assert.equal(integration.activation_gate.authorization_only, true);
  assert.equal(integration.activation_gate.does_not_enable_surface_mutations, true);
  assert.equal(integration.activation_gate.does_not_change_usb_release_gate, true);
  assert.equal(integration.activation_gate.does_not_make_studio_boot_critical, true);
});

test("Studio integration keeps ChatGPT normal, Work/Codex and provider API distinct", async () => {
  const integration = await readJson(INTEGRATION_PATH);
  const external = integration.ai_modes.external_chatgpt_plan;

  assert.equal(integration.ai_modes.chatgpt_mcp.user_initiated, true);
  assert.equal(integration.ai_modes.local_24h.default_external_usage, false);
  assert.equal(external.runtime_enabled, false);
  assert.equal(external.explicit_opt_in_required, true);
  assert.equal(external.usage_notice_required, true);
  assert.match(external.usage_notice, /Work\/Codex/i);
  assert.match(external.usage_notice, /not normal chat quota/i);
  assert.equal(external.silent_fallback_forbidden, true);
  assert.equal(integration.ai_modes.provider_api.runtime_enabled, false);
  assert.equal(integration.ai_modes.provider_api.separate_billing_notice_required, true);
  assert.equal(integration.ai_modes.provider_api.silent_fallback_forbidden, true);
});


test("development enrollment trusts only canonical ordax-runtime recovery workflow", async () => {
  const source = await readFile(ENROLLMENT_PATH, "utf8");

  assert.match(source, /const REPOSITORY = "ordaxsystems\/ordax-runtime";/);
  assert.match(source, /const REPOSITORY_ID = "1406415790";/);
  assert.match(
    source,
    /ordaxsystems\/ordax-runtime\/\.github\/workflows\/ordax-agent-recovery\.yml@refs\/heads\/main/,
  );
  // GitHub repository id remains stable across owner transfers; repository
  // and workflow_ref must move together with the signer.
  assert.doesNotMatch(source, /const REPOSITORY = "washingtonmsdj\/ordax-runtime";/);
  assert.doesNotMatch(source, /"washingtonmsdj\/ordax-runtime\/\.github\/workflows/);
  assert.doesNotMatch(source, /washingtonmsdj\/mcp-blender/);
});

test("Owner DEV CI candidate is recorded as evidence, not unsigned installation authority", async () => {
  const lock = await readJson(SOURCE_LOCK_PATH);
  assert.deepEqual(lock.candidate_evidence, {
    kind: "ci-only-unsigned",
    source_commit: lock.source.commit,
    platform: "linux-amd64-musl",
    workflow_run_id: 39572841771,
    artifact_id: 12332557477,
    archive_sha256: "791e80facaf07dc9d4a3c5941c5ad4a141614acaf89785c50519fac7cd9e2525",
    executable_sha256: "c432ec03bdd01df0eb8c2dbe5bcf147e93a7a94711f536154af14ce5719e6946",
    executable_size_bytes: 24995232,
    offline_proof_verified: true,
    device_execution_proven: false,
    signed_distribution_authorized: false,
    native_graphical_control_proven: false,
  });
  assert.equal(lock.distribution.source_binding_only, true);
  assert.equal(lock.distribution.signed_runtime_slot_available, false);
  assert.equal(lock.activation.dispatch_enabled, false);
  assert.equal(lock.activation.single_device_heartbeat_owner_required, true);
});
