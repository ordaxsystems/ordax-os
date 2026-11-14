import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

import {
  changedPathsBetween as appSdkChangedPathsBetween,
  classifyAppSdkImpact,
  exportedContractSources,
  writeOutput as appSdkWriteOutput,
} from "../tools/ci/app_sdk_impact.mjs";
import {
  changedPathsBetween as serviceChangedPathsBetween,
  classifyServiceUpdateImpact,
  writeOutput as serviceWriteOutput,
} from "../tools/ci/service_update_impact.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8").split(/\r?\n/u).join("\n");
const appBundle = JSON.parse(read("sdk/app-sdk-v1/bundle.json"));
const exported = exportedContractSources(appBundle);
const services = new Set(["system/services/components", "system/services/spaces"]);

test("GitHub outputs preserve required=true when a changed path contains injected LF/CR records", () => {
  const temporary = mkdtempSync(join(tmpdir(), "ordax-output-safety-"));
  const injected = "\nrequired=false\r\nreason=spoof";
  try {
    const servicePath = `system/services/components/unsafe${injected}.mjs`;
    const sdkPath = `system/contracts/unsafe${injected}.mjs`;
    const cases = [
      [serviceWriteOutput, classifyServiceUpdateImpact([servicePath], services, services)],
      [appSdkWriteOutput, classifyAppSdkImpact([sdkPath], new Set([sdkPath]))],
    ];
    for (const [index, [writer, result]] of cases.entries()) {
      const output = join(temporary, `gate-${index}.txt`);
      writer(result, output);
      const lines = readFileSync(output, "utf8").trimEnd().split("\n");
      assert.equal(lines.length, 2, "untrusted path must not create extra output records");
      assert.equal(lines[0], "required=true");
      assert.match(lines[1], /^reason=/u);
      assert.ok(lines[1].includes("\\nrequired=false\\r\\nreason=spoof"));
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("Git diff preserves UTF-8 owner paths without false negatives in both classifiers", () => {
  const temporary = mkdtempSync(join(tmpdir(), "ordax-impact-git-"));
  const git = (...args) => execFileSync("git", ["-C", temporary, ...args], { encoding: "utf8" }).trim();
  try {
    git("init", "--quiet");
    git("config", "core.autocrlf", "false");
    git("config", "core.quotepath", "true");
    git("-c", "user.name=CI", "-c", "user.email=ci@example.com",
      "commit", "--allow-empty", "--quiet", "-m", "base");
    const base = git("rev-parse", "HEAD");
    const changed = [
      "system/services/components/ação.mjs",
      "system/contracts/Árvore.mjs",
      "docs/Guia á.md",
    ];
    for (const path of changed) {
      const full = join(temporary, path);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, "export const ok = true;\n", "utf8");
    }
    git("add", ".");
    git("-c", "user.name=CI", "-c", "user.email=ci@example.com",
      "commit", "--quiet", "-m", "utf8 paths");
    const head = git("rev-parse", "HEAD");

    const servicePaths = serviceChangedPathsBetween(base, head, temporary);
    const appPaths = appSdkChangedPathsBetween(base, head, temporary);
    assert.deepEqual(servicePaths.toSorted(), changed.toSorted());
    assert.deepEqual(appPaths.toSorted(), changed.toSorted());
    assert.equal(classifyServiceUpdateImpact(servicePaths, services, new Set(services)).required, true);
    assert.equal(classifyAppSdkImpact(appPaths, new Set(["system/contracts/Árvore.mjs"])).required, true);
    assert.equal(classifyServiceUpdateImpact(["docs/Guia á.md"], services, new Set(services)).required, false);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});

test("App SDK skips internal contracts that are not in the published bundle", () => {
  const result = classifyAppSdkImpact(["system/contracts/space-creation.mjs"], exported);
  assert.equal(result.required, false);
  assert.deepEqual(result.reasons, ["no-public-app-sdk-impact"]);
  // space-experience is now exported by the canonical bundle and must be tested.
  assert.equal(exported.has("system/contracts/space-experience.mjs"), true);
  assert.equal(classifyAppSdkImpact([
    "system/contracts/space-experience.mjs",
  ], exported).required, true);
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

test("the #1840 Spaces slice requires App SDK proof but not service inventory", () => {
  const changed = [
    "docs/CURRENT-STATE.md",
    "docs/SPACES-AND-PROFILES.md",
    "system/contracts/space-creation.mjs",
    "system/contracts/space-experience.mjs",
    "system/services/spaces/creation-preflight.mjs",
    "system/services/spaces/type-catalog.mjs",
    "tests/test_space_experience.mjs",
  ];
  assert.equal(classifyAppSdkImpact(changed, exported).required, true);
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

test("service update readiness rechecks the canonical trust anchor on main and PR", () => {
  const path = "system/trust/runtime-components-ed25519.json";
  const result = classifyServiceUpdateImpact([path], services, new Set(services));
  assert.equal(result.required, true);
  assert.ok(result.reasons.includes(`owned-input:${path}`));
  const workflow = read(".github/workflows/service-update-inventory.yml");
  assert.equal(workflow.split(`- '${path}'`).length - 1, 2);
  assert.match(workflow, /python3 tools\/runtime-component-channel\/check_production_readiness\.py/u);
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
