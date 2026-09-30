import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  validateDeviceCapabilityGrant,
  validateDeviceProjectBinding,
} from "../system/contracts/device-agent.mjs";

const DEVICE_AGENT_CONTRACT = JSON.parse(
  readFileSync(new URL("../docs/contracts/device-agent.json", import.meta.url), "utf8"),
);

test("local project does not require GitHub", () => {
  const binding = validateDeviceProjectBinding({
    projectId: "dioramas-biblicos",
    deviceId: "surface-owner",
    sourceType: "local",
    localRegistered: true,
  });

  assert.equal(binding.githubRepositoryId, null);
  assert.equal(binding.sourceType, "local");
});

test("GitHub-only project does not pretend to control a local device", () => {
  const binding = validateDeviceProjectBinding({
    projectId: "web-app",
    sourceType: "github",
    githubRepositoryId: "123456789",
  });

  assert.equal(binding.deviceId, null);
  assert.equal(binding.localRegistered, false);
});

test("hybrid project requires both local registration and selected GitHub repo", () => {
  assert.throws(() => validateDeviceProjectBinding({
    projectId: "ordax",
    deviceId: "surface-owner",
    sourceType: "hybrid",
    localRegistered: true,
  }));
});

test("Web and MCP use scoped grants over the same OrdaX action gateway", () => {
  for (const client of ["ordax-web", "ordax-mobile", "ordax-desktop", "ordax-native", "mcp"]) {
    const grant = validateDeviceCapabilityGrant({
      accountId: "account-1",
      spaceId: "space-dev",
      projectId: "ordax",
      deviceId: "surface-owner",
      client,
      capability: "git.diff",
      mode: "read",
    });
    assert.equal(grant.actionGateway, "ordax");
  }
});

test("remote writes require approval and generic shell remains forbidden", () => {
  assert.throws(() => validateDeviceCapabilityGrant({
    accountId: "account-1",
    spaceId: "space-dev",
    projectId: "ordax",
    deviceId: "surface-owner",
    client: "mcp",
    capability: "project.text_write",
    mode: "write",
    approved: false,
  }));

  assert.throws(() => validateDeviceCapabilityGrant({
    accountId: "account-1",
    spaceId: "space-dev",
    projectId: "ordax",
    deviceId: "surface-owner",
    client: "ordax-web",
    capability: "shell.generic",
    mode: "read",
  }));
});


test("shared control plane keeps product and development authority separate", () => {
  const control = DEVICE_AGENT_CONTRACT.control_plane;
  assert.equal(control.backend_project, "ordax-control-plane");
  assert.equal(control.shared_backend_project_allowed, true);
  assert.equal(control.development_authority_separate_from_product_authority, true);
  assert.equal(control.development_device_agent_transport_allowed, true);
  assert.equal(control.development_credentials_may_authenticate_product_users, false);
  assert.equal(control.product_credentials_may_authenticate_engineering_jobs, false);
  assert.equal(control.product_action_gateway_may_reuse_development_operator_credentials, false);
  assert.equal(control.historical_development_tables_are_product_authority, false);
  assert.equal(control.bootstrap_dependency, false);
  assert.equal(control.existing_device_token_identity_recovery, true);
  assert.equal(control.github_runner_required_for_existing_device_recovery, false);
});
