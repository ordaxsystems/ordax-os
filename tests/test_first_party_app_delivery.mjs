import assert from "node:assert/strict";
import test from "node:test";

import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import {
  getFirstPartyAppDeliveryPolicy,
  listFirstPartyAppDeliveryPolicies,
  projectFirstPartyAppDelivery,
} from "../system/services/apps/delivery-policy.mjs";

function observation(overrides = {}) {
  return {
    installed: false,
    catalogued: true,
    transition: "idle",
    blockedReason: null,
    failedRetained: false,
    ...overrides,
  };
}

test("delivery policy covers every locally present first-party app and may also describe absent products", () => {
  const apps = listFirstPartyApps();
  const appIds = apps.map((app) => app.id).sort();
  const policyIds = listFirstPartyAppDeliveryPolicies().map((policy) => policy.appId).sort();
  const policyIdSet = new Set(policyIds);
  assert.equal(policyIdSet.size, policyIds.length);
  for (const appId of appIds) {
    assert.equal(policyIdSet.has(appId), true, `${appId}: locally present app requires delivery policy`);
  }
  for (const app of apps) {
    assert.equal(
      app.localization.packPolicy,
      "component-scoped",
      `${app.id}: independently delivered first-party apps must keep component-scoped localization`,
    );
  }
  assert.equal(getFirstPartyAppDeliveryPolicy("notes")?.discovery, "store-only");
  assert.equal(getFirstPartyAppDeliveryPolicy("store")?.deliveryClass, "structural");
});

test("optional utility products inherit only Store-only delivery policy, not installed state", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = new URL("../docs/contracts/first-party-app-delivery.json", import.meta.url);
  const contract = JSON.parse(await readFile(source, "utf8"));
  const declared = contract.current_target_policy;
  const policies = listFirstPartyAppDeliveryPolicies();
  const sorted = values => [...values].sort();
  for (const [group, expected] of [
    ["structural", declared.structural],
    ["bootstrap", declared.bootstrap],
    ["on-demand", declared.on_demand],
  ]) {
    assert.deepEqual(
      sorted(policies.filter(policy => policy.deliveryClass === group).map(policy => policy.appId)),
      sorted(expected),
      group + " contract and runtime delivery policy must agree",
    );
  }

  const utilities = [
    "calculator", "clock", "converter", "text-viewer", "image-viewer",
    "calendar", "colors", "character-map", "paint", "media-player",
    "pdf-viewer", "toolbox",
  ];
  for (const appId of utilities) {
    const policy = getFirstPartyAppDeliveryPolicy(appId);
    assert.equal(policy?.deliveryClass, "on-demand", appId);
    assert.equal(policy?.discovery, "store-only", appId);
    assert.equal(policy?.removable, true, appId);
    const missing = projectFirstPartyAppDelivery(appId, observation({catalogued:false}));
    assert.equal(missing.state, "not-catalogued", appId);
    assert.equal(missing.launchable, false, appId);
    assert.equal(missing.installable, false, appId);
    const catalogued = projectFirstPartyAppDelivery(appId, observation());
    assert.equal(catalogued.state, "available", appId);
    assert.equal(catalogued.showInLauncher, false, appId);
    assert.equal(catalogued.launchable, false, appId);
    assert.equal(catalogued.dataRemovalRequiresSeparateAction, true, appId);
  }
});

test("structural surfaces fail closed when their payload is missing", () => {
  for (const appId of ["settings", "account", "system", "store"]) {
    const policy = getFirstPartyAppDeliveryPolicy(appId);
    assert.equal(policy.deliveryClass, "structural");
    assert.equal(policy.removable, false);

    const projection = projectFirstPartyAppDelivery(appId, observation());
    assert.equal(projection.state, "blocked");
    assert.equal(projection.reason, "structural-payload-missing");
    assert.equal(projection.launchable, false);
    assert.equal(projection.installable, false);
    assert.equal(projection.openAction, "none");
  }
});

test("clean OS has no removable bootstrap app; Internet is available only by verified installation", () => {
  assert.deepEqual(listFirstPartyAppDeliveryPolicies().filter(policy => policy.deliveryClass === "bootstrap"), []);
  for (const appId of ["internet"]) {
    const policy = getFirstPartyAppDeliveryPolicy(appId);
    assert.equal(policy.deliveryClass, "on-demand");
    assert.equal(policy.discovery, "store-only");
    assert.equal(policy.removable, true);

    const installed = projectFirstPartyAppDelivery(appId, observation({ installed: true, catalogued: false }));
    assert.equal(installed.state, "installed");
    assert.equal(installed.launchable, true);
    assert.equal(installed.removable, true);
    assert.equal(installed.openAction, "launch");
    assert.equal(installed.dataRemovalRequiresSeparateAction, true);
  }
});

test("catalogued on-demand app is never treated as installed", () => {
  const assistant = projectFirstPartyAppDelivery("assistant", observation());
  assert.equal(assistant.state, "available");
  assert.equal(assistant.launchable, false);
  assert.equal(assistant.installable, true);
  assert.equal(assistant.showInLauncher, true);
  assert.equal(assistant.openAction, "show-install");
  assert.equal(assistant.authority, "none");

  const notes = projectFirstPartyAppDelivery("notes", observation());
  assert.equal(notes.state, "available");
  assert.equal(notes.launchable, false);
  assert.equal(notes.installable, true);
  assert.equal(notes.showInLauncher, false);
  assert.equal(notes.openAction, "none");
});

test("not-catalogued on-demand app is not projected as installable", () => {
  const projection = projectFirstPartyAppDelivery(
    "studio",
    observation({ catalogued: false }),
  );
  assert.equal(projection.state, "not-catalogued");
  assert.equal(projection.launchable, false);
  assert.equal(projection.installable, false);
  assert.equal(projection.showInLauncher, false);
  assert.equal(projection.openAction, "none");
});

test("staging never means activation and may retain an existing launchable version", () => {
  const firstInstall = projectFirstPartyAppDelivery(
    "assistant",
    observation({ transition: "staged" }),
  );
  assert.equal(firstInstall.state, "staged");
  assert.equal(firstInstall.launchable, false);
  assert.equal(firstInstall.installable, false);

  const update = projectFirstPartyAppDelivery(
    "assistant",
    observation({ installed: true, transition: "staged" }),
  );
  assert.equal(update.state, "staged");
  assert.equal(update.launchable, true, "last-known-good installed version stays launchable during staged update");
  assert.equal(update.removable, false, "staged update cannot race with removal");
  assert.equal(update.openAction, "launch");
});

test("update and removal transitions are explicit and suppress conflicting actions", () => {
  const updating = projectFirstPartyAppDelivery(
    "assistant",
    observation({ installed: true, transition: "updating" }),
  );
  assert.equal(updating.state, "updating");
  assert.equal(updating.launchable, true, "current version remains launchable until promotion");
  assert.equal(updating.installable, false);
  assert.equal(updating.removable, false);
  assert.equal(updating.openAction, "launch");

  const removing = projectFirstPartyAppDelivery(
    "assistant",
    observation({ installed: true, transition: "removing" }),
  );
  assert.equal(removing.state, "removing");
  assert.equal(removing.launchable, false, "new launches stop while removal is in flight");
  assert.equal(removing.installable, false);
  assert.equal(removing.removable, false);
  assert.equal(removing.openAction, "none");
});

test("failed update can retain the previous installed app without coupling user-data deletion", () => {
  const projection = projectFirstPartyAppDelivery(
    "studio",
    observation({ installed: true, failedRetained: true }),
  );
  assert.equal(projection.state, "failed-retained");
  assert.equal(projection.launchable, true);
  assert.equal(projection.removable, true);
  assert.equal(projection.dataRemovalRequiresSeparateAction, true);
  assert.equal(projection.authority, "none");
});

test("invalid delivery observations fail closed", () => {
  assert.throws(
    () => projectFirstPartyAppDelivery("assistant", observation({ failedRetained: true })),
    /requires a known installed version/,
  );
  assert.throws(
    () => projectFirstPartyAppDelivery(
      "assistant",
      observation({ transition: "installing", blockedReason: "policy" }),
    ),
    /cannot coexist/,
  );
  assert.throws(
    () => projectFirstPartyAppDelivery(
      "assistant",
      observation({ installed: true, transition: "installing" }),
    ),
    /requires the app to be absent/,
  );
  for (const transition of ["updating", "removing"]) {
    assert.throws(
      () => projectFirstPartyAppDelivery("assistant", observation({ transition })),
      /requires a known installed version/,
    );
  }
  assert.throws(
    () => projectFirstPartyAppDelivery("unknown", observation()),
    /Unknown first-party app delivery id/,
  );
});

test("First-party app CI validates the same policy sources in PR and main push", async () => {
  const { readFile } = await import("node:fs/promises");
  const workflow = (await readFile(
    new URL("../.github/workflows/first-party-app-delivery.yml", import.meta.url), "utf8"
  )).replaceAll("\r\n", "\n");
  const push = workflow.split("  push:\n    branches: [main]\n    paths:\n")[1]?.split("  pull_request:\n")[0];
  const pr = workflow.split("  pull_request:\n    paths:\n")[1]?.split("  workflow_dispatch:\n")[0];
  assert.ok(push && pr, "both PR and main-push gates must exist");
  const paths = (section) => [...new Set(section.split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- '"))
    .map((line) => line.slice(3, -1)))].sort();
  assert.deepEqual(paths(pr), paths(push), "a release input must be validated before merging");
  for (const required of [
    "docs/contracts/runtime-component-package.json",
    "tools/app-policy/render_external_first_party_policy.py",
    "docs/contracts/surface-source.json",
  ]) {
    assert.ok(paths(pr).includes(required), required);
  }
  assert.match(workflow, /uses: \.\/\.github\/actions\/prepare-verified-surface/);
});
