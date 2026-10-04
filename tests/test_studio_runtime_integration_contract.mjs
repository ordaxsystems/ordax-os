import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { studioApp } from "../system/apps/studio/app.mjs";
import {
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
  DEVICE_AGENT_PORT_SCHEMA,
} from "../system/contracts/device-agent.mjs";
import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import { LOCAL_AI_PORT_SCHEMA } from "../system/contracts/local-ai.mjs";
import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import { MODEL_ROUTER_PORT_SCHEMA } from "../system/contracts/model-router.mjs";
import {
  DEVICE_ACTION_RECEIPT_SCHEMA,
  DEVICE_ACTION_REQUEST_SCHEMA,
} from "../system/contracts/operational-realtime.mjs";
import { STUDIO_ACTION_CATALOG_SCHEMA } from "../system/contracts/studio-action-catalog.mjs";
import {
  STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA,
} from "../system/services/device-agent/studio-action-authorizer.mjs";

const rootUrl = new URL("../", import.meta.url);

async function json(path) {
  return JSON.parse(await readFile(new URL(path, rootUrl), "utf8"));
}

test("Studio runtime integration reuses the existing OS app and platform authorities", async () => {
  const contract = await json("docs/contracts/studio-runtime-integration.json");

  assert.equal(contract.product.app_id, studioApp.id);
  assert.equal(contract.product.product_name, studioApp.title);
  assert.equal(contract.product.single_product, true);
  assert.equal(contract.product.duplicate_studio_forbidden, true);
  assert.equal(contract.product.blender_is_capability_not_product, true);
  assert.equal(contract.product.unity_is_capability_not_product, true);

  assert.equal(contract.platform_authority.intelligence_schema, INTELLIGENCE_PORT_SCHEMA);
  assert.equal(contract.platform_authority.memory_schema, MEMORY_PORT_SCHEMA);
  assert.equal(contract.platform_authority.model_router_schema, MODEL_ROUTER_PORT_SCHEMA);
  assert.equal(contract.platform_authority.studio_must_not_create_parallel_identity, true);
  assert.equal(contract.platform_authority.studio_must_not_create_parallel_memory, true);
  assert.equal(contract.platform_authority.studio_must_not_create_parallel_model_router, true);
});

test("Studio discovery remains read-only while authorization is real and dispatch stays disabled", async () => {
  const contract = await json("docs/contracts/studio-runtime-integration.json");
  const deviceAgent = await json("docs/contracts/device-agent.json");

  assert.equal(contract.runtime_source.historical_incubation_repository, deviceAgent.historical_incubation_repository);
  assert.equal(contract.runtime_source.device_agent_schema, DEVICE_AGENT_PORT_SCHEMA);
  assert.equal(contract.runtime_source.capability_reader_schema, DEVICE_AGENT_CAPABILITY_READER_SCHEMA);
  assert.equal(contract.runtime_source.action_catalog_schema, STUDIO_ACTION_CATALOG_SCHEMA);
  assert.equal(contract.runtime_source.same_action_catalog_required, true);
  assert.equal(contract.capability_discovery.surface_receives_capability_reader_only, true);
  assert.equal(contract.capability_discovery.surface_receives_raw_execute, false);
  assert.equal(contract.capability_discovery.public_action_catalog_is_authority, false);
  assert.equal(contract.mutations.direct_device_agent_execute_from_surface_forbidden, true);
  assert.equal(contract.mutations.runtime_enabled, false);
  assert.equal(contract.mutations.authorization_runtime_enabled, true);
  assert.equal(contract.mutations.dispatch_runtime_enabled, false);
  assert.equal(contract.mutations.authorization_schema, STUDIO_DEVICE_ACTION_AUTHORIZATION_SCHEMA);
  assert.equal(contract.mutations.authorization_dispatch_authority, "none");
  assert.equal(contract.mutations.request_schema, DEVICE_ACTION_REQUEST_SCHEMA);
  assert.equal(contract.mutations.receipt_schema, DEVICE_ACTION_RECEIPT_SCHEMA);
  assert.equal(contract.mutations.action_catalog_schema, STUDIO_ACTION_CATALOG_SCHEMA);
  assert.equal(contract.mutations.capability_operation_binding_required, true);
  assert.equal(contract.mutations.same_action_gateway_required, true);
  assert.equal(contract.activation_gate.authorization_only, true);
  assert.equal(contract.activation_gate.does_not_enable_surface_mutations, true);
  assert.equal(deviceAgent.projects_integration.surface_execute_action_exposed, false);
});

test("Studio AI modes keep local Intelligence authoritative and external usage explicit", async () => {
  const contract = await json("docs/contracts/studio-runtime-integration.json");

  assert.equal(contract.ai_modes.local_24h.provider, LOCAL_AI_PORT_SCHEMA);
  assert.equal(contract.ai_modes.local_24h.owner, "ordax-os");
  assert.equal(contract.ai_modes.local_24h.default_external_usage, false);
  assert.equal(contract.ai_modes.chatgpt_mcp.user_initiated, true);
  assert.equal(contract.ai_modes.external_chatgpt_plan.runtime_enabled, false);
  assert.equal(contract.ai_modes.external_chatgpt_plan.explicit_opt_in_required, true);
  assert.equal(contract.ai_modes.external_chatgpt_plan.usage_notice_required, true);
  assert.match(contract.ai_modes.external_chatgpt_plan.usage_notice, /Work\/Codex/);
  assert.match(contract.ai_modes.external_chatgpt_plan.usage_notice, /not normal chat quota/);
  assert.equal(contract.ai_modes.external_chatgpt_plan.silent_fallback_forbidden, true);
  assert.equal(contract.ai_modes.provider_api.silent_fallback_forbidden, true);
  assert.equal(contract.handoff.memory_owner, "ordax-os");
  assert.equal(contract.handoff.browser_ui_automation_is_integration_foundation, false);
});
