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
  assert.equal(lock.source.commit, "218e049cc1364e270c566f41de048725ec692c26");
  assert.deepEqual(lock.source.compatibility_contract, {
    path: "docs/contracts/ordax-os-runtime-compatibility.json",
    schema: "ordax.studio-runtime-compatibility/1",
    sha256: "9fe0d913a8f679bb79bb95549aa390373fcba12070d01557334951da9b3e5a1f",
    product_version: "0.4.2",
  });

  assert.equal(lock.runtime.profile, "headless");
  assert.equal(lock.runtime.python, ">=3.11");
  assert.deepEqual(lock.runtime.entrypoints, ["ordax-dev-agent", "ordax-device-agent"]);
  assert.equal(lock.runtime.device_agent_schema, "ordax.device-agent/1");
  assert.equal(
    lock.runtime.capability_reader_schema,
    "ordax.device-agent-capability-reader/1",
  );
});

test("Studio runtime source lock is source-only and cannot silently activate dispatch", async () => {
  const lock = await readJson(SOURCE_LOCK_PATH);

  assert.equal(lock.distribution.runtime_packaged_in_stable, false);
  assert.equal(lock.distribution.runtime_network_download_allowed, false);
  assert.equal(lock.distribution.runtime_artifact_claimed, false);
  assert.equal(lock.distribution.source_binding_only, true);

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

  assert.match(source, /const REPOSITORY = "washingtonmsdj\/ordax-runtime";/);
  assert.match(source, /const REPOSITORY_ID = "1406415790";/);
  assert.match(
    source,
    /washingtonmsdj\/ordax-runtime\/\.github\/workflows\/ordax-agent-recovery\.yml@refs\/heads\/main/,
  );
  assert.doesNotMatch(source, /washingtonmsdj\/mcp-blender/);
});
