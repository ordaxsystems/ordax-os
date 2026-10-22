import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  classifyAppSdkImpact,
  exportedContractSources,
} from "../tools/ci/app_sdk_impact.mjs";
import { classifyServiceUpdateImpact } from "../tools/ci/service_update_impact.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").split(/\r?\n/u).join("\n");
const appBundle = JSON.parse(read("sdk/app-sdk-v1/bundle.json"));
const exported = exportedContractSources(appBundle);
const services = new Set(["system/services/components", "system/services/spaces"]);

test("App SDK skips internal contracts that are not in the published bundle", () => {
  const result = classifyAppSdkImpact([
    "system/contracts/space-creation.mjs",
    "system/contracts/space-experience.mjs",
  ], exported);
  assert.equal(result.required, false);
  assert.deepEqual(result.reasons, ["no-public-app-sdk-impact"]);
  assert.equal(classifyAppSdkImpact([
    "docs/CURRENT-STATE.md",
    "system/services/spaces/creation-preflight.mjs",
  ], exported).required, false);
});

test("App SDK runs for exported contracts and its explicit non-contract owners", () => {
  assert.equal(exported.has("system/contracts/spaces.mjs"), true);
  assert.equal(classifyAppSdkImpact(["system/contracts/spaces.mjs"], exported).required, true);
  assert.equal(classifyAppSdkImpact(["tools/app-sdk/export.py"], exported).required, true);
  assert.equal(classifyAppSdkImpact([".github/workflows/app-sdk-contract.yml"], exported).required, true);
});

test("Internet source reintroduction triggers the fail-closed absence proof", () => {
  assert.equal(
    classifyAppSdkImpact(["system/apps/internet/runtime.mjs"], exported).required,
    true,
  );
  const workflow = read(".github/workflows/app-sdk-contract.yml");
  assert.equal(workflow.split('"system/apps/internet/**"').length - 1, 2);
});

test("service inventory skips content-only changes inside an existing service domain", () => {
  const result = classifyServiceUpdateImpact([
    "system/services/spaces/creation-preflight.mjs",
  ], services, new Set(services));
  assert.equal(result.required, false);
  assert.deepEqual(result.reasons, ["no-service-inventory-impact"]);
  assert.equal(classifyServiceUpdateImpact([
    "docs/SPACES-AND-PROFILES.md",
    "system/contracts/space-creation.mjs",
  ], services, new Set(services)).required, false);
});

test("the complete #1840 Spaces slice is non-causal to App SDK and service inventory", () => {
  const changed = [
    "docs/CURRENT-STATE.md",
    "docs/SPACES-AND-PROFILES.md",
    "system/contracts/space-creation.mjs",
    "system/contracts/space-experience.mjs",
    "system/services/spaces/creation-preflight.mjs",
    "system/services/spaces/type-catalog.mjs",
    "tests/test_space_experience.mjs",
  ];
  assert.equal(classifyAppSdkImpact(changed, exported).required, false);
  assert.equal(classifyServiceUpdateImpact(changed, services, new Set(services)).required, false);
});
test("service inventory runs when top-level service domains change", () => {
  const result = classifyServiceUpdateImpact([
    "system/services/future/index.mjs",
  ], services, new Set([...services, "system/services/future"]));
  assert.equal(result.required, true);
  assert.ok(result.reasons.includes("service-directory-set-changed"));
});

test("service inventory runs for component owners and canonical manifest inputs", () => {
  assert.equal(classifyServiceUpdateImpact([
    "system/services/components/service-update-readiness.mjs",
  ], services, new Set(services)).required, true);
  assert.equal(classifyServiceUpdateImpact([
    "system/apps/component-catalog.mjs",
  ], services, new Set(services)).required, true);
});

test("Notes absence workflow is scoped to the files the proof actually reads", () => {
  const workflow = read(".github/workflows/notes-externalization-boundary.yml");
  for (const broad of [
    "system/apps/**",
    "system/adapters/**",
    "system/contracts/**",
    "system/composition/**",
    "system/services/apps/**",
    "system/services/i18n/**",
    "system/surface/**",
  ]) assert.equal(workflow.includes(`- '${broad}'`), false, broad);

  for (const exact of [
    "system/apps/notes/**",
    "system/contracts/notes-store.mjs",
    "system/contracts/notes-file-importer.mjs",
    "system/surface/ui/file-notes-action.mjs",
    "system/adapters/native/notes.mjs",
    "system/adapters/web/notes.mjs",
    "system/services/i18n/catalog/notes.mjs",
    "system/surface/ui/file-space-controls.mjs",
    "system/apps/catalog.mjs",
    "system/apps/component-catalog.mjs",
    "system/composition/web/main.tsx",
    "system/composition/native/main.mjs",
    "system/surface/runtime/native_host_server.py",
    "system/surface/ui/desktop-shell.mjs",
    "system/services/apps/delivery-policy.mjs",
    "docs/contracts/first-party-app-delivery.json",
  ]) assert.equal(workflow.split(`- '${exact}'`).length - 1, 2, exact);
});

test("App SDK workflow gates its expensive proof on causal public-contract impact", () => {
  const workflow = read(".github/workflows/app-sdk-contract.yml");
  assert.match(workflow, /app-sdk-impact:\n    name: App SDK Causal Impact/u);
  assert.match(workflow, /app-sdk-contract:\n    needs: app-sdk-impact\n    if: needs\.app-sdk-impact\.outputs\.required == 'true'/u);
  assert.equal(workflow.split('"tools/ci/app_sdk_impact.mjs"').length - 1, 2);
  assert.equal(workflow.split('"tests/test_app_sdk_projects_ports.mjs"').length - 1, 2);
  assert.equal(workflow.split('"tests/test_causal_workflow_impact.mjs"').length - 1, 2);
  assert.match(workflow, /fetch-depth: 0/u);
});

test("service inventory keeps directory discovery broad but gates expensive audit causally", () => {
  const workflow = read(".github/workflows/service-update-inventory.yml");
  assert.equal(workflow.split("- 'system/services/**'").length - 1, 2);
  assert.equal(workflow.includes("- 'system/apps/**'"), false);
  assert.equal(workflow.split("- 'system/apps/component-catalog.mjs'").length - 1, 2);
  assert.match(workflow, /impact:\n    name: Native service inventory impact/u);
  assert.match(workflow, /audit-native-services:\n    needs: impact\n    if: needs\.impact\.outputs\.required == 'true'/u);
  assert.equal(workflow.split("- 'tools/ci/service_update_impact.mjs'").length - 1, 2);
  assert.equal(workflow.split("- 'tests/test_causal_workflow_impact.mjs'").length - 1, 2);
  assert.match(workflow, /fetch-depth: 0/u);
});
