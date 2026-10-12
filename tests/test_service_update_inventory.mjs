import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { listSystemComponents } from "../system/apps/component-catalog.mjs";
import {
  SERVICE_UPDATE_INVENTORY_SCHEMA,
  deriveNativeServiceUpdateInventory,
} from "../system/services/components/service-update-inventory.mjs";

const serviceDirectories = () => readdirSync(
  new URL("../system/services/", import.meta.url), { withFileTypes: true },
)
  .filter((entry) => entry.isDirectory())
  .map((entry) => "system/services/" + entry.name);

const inventory = (manifests = listSystemComponents(), paths = serviceDirectories()) =>
  deriveNativeServiceUpdateInventory({ manifests, servicePaths: paths });

test("every actual native service directory and every declared component is covered", () => {
  const result = inventory();
  assert.equal(result.schema, SERVICE_UPDATE_INVENTORY_SCHEMA);
  assert.equal(result.authority, "none");
  assert.deepEqual(
    result.domains.map((entry) => entry.path).sort(),
    serviceDirectories().sort(),
  );
  assert.deepEqual(
    result.components.map((entry) => entry.id).sort(),
    listSystemComponents().map((entry) => entry.id).sort(),
  );
  assert.equal(new Set(result.domains.map((entry) => entry.path)).size, result.domains.length);
  assert.equal(new Set(result.components.map((entry) => entry.id)).size, result.components.length);
  for (const entry of result.domains) {
    assert.equal(entry.releaseReadiness, "not-assessed-by-this-projection");
    if (entry.componentIds.length === 0) {
      assert.equal(entry.state, "embedded-domain-without-independent-component");
    } else {
      assert.equal(entry.state, "manifest-linked");
    }
  }
});

test("every component exposes dependency and restart impact from canonical manifests", () => {
  const result = inventory();
  for (const component of result.components) {
    const canonical = listSystemComponents().find((entry) => entry.id === component.id);
    assert.deepEqual(component.dependencies, canonical.dependencies);
    assert.equal(component.restartScope, canonical.restartScope);
    assert.equal(component.criticality, canonical.criticality);
    assert.equal(component.healthMode, canonical.healthMode);
    assert.deepEqual(
      component.directlyAffectedConsumers,
      listSystemComponents().filter((entry) => entry.dependencies.includes(component.id))
        .map((entry) => entry.id).sort(),
    );
  }
  const ai = result.components.find((component) => component.id === "local-ai-service");
  assert.ok(ai.directlyAffectedConsumers.includes("ordax-intelligence"));
  const intelligence = result.components.find((component) => component.id === "ordax-intelligence");
  assert.ok(intelligence.dependencies.includes("local-ai-service"));
  const base = result.components.find((component) => component.id === "ordax-base");
  assert.equal(base.restartScope, "reboot");
});

test("the real Local AI, Intelligence and Spaces reflect current truth", () => {
  const result = inventory();
  for (const id of ["local-ai-service", "ordax-intelligence"]) {
    const component = result.components.find((entry) => entry.id === id);
    assert.ok(component);
    assert.equal(component.releaseMode, "bundled");
    assert.equal(component.currentDelivery, "os-bundled");
    assert.equal(component.releaseReadiness, "not-assessed-by-this-projection");
  }
  const spaces = result.domains.find((entry) => entry.path === "system/services/spaces");
  assert.ok(spaces);
  assert.equal(spaces.releaseReadiness, "not-assessed-by-this-projection");
  // The existence of a source directory is not a standalone deployable artifact.
  assert.equal(spaces.componentIds.length, 0);
});

test("independent slot declaration by itself never claims production readiness", () => {
  const manifests = listSystemComponents().map((entry) =>
    entry.id === "local-ai-service"
      ? { ...entry, releaseMode: "component-slot" }
      : entry
  );
  const result = inventory(manifests);
  const localAi = result.components.find((entry) => entry.id === "local-ai-service");
  assert.equal(localAi.currentDelivery, "individual-declared-not-production-proven");
  assert.equal(localAi.releaseReadiness, "not-assessed-by-this-projection");
  for (const entry of result.components) {
    if (entry.releaseMode === "git-app") {
      assert.equal(entry.currentDelivery, "development-git-only");
      assert.equal(entry.releaseReadiness, "not-assessed-by-this-projection");
    }
  }
});

test("rejects duplicate paths, invalid paths and missing canonical owners", () => {
  const paths = serviceDirectories();
  assert.throws(() => inventory(listSystemComponents(), [...paths, paths[0]]), /Duplicate/);
  assert.throws(() => inventory(listSystemComponents(), ["../secret"]), /Invalid canonical/);
  assert.throws(
    () => inventory(listSystemComponents(), paths.filter((path) =>
      path !== "system/services/local-ai")),
    /missing service directory: system\/services\/local-ai/,
  );
});

test("the executable audit runs against actual repo source", () => {
  const run = spawnSync(process.execPath, [
    fileURLToPath(new URL("../tools/service-update-inventory.mjs", import.meta.url)),
    "--check",
  ], { encoding: "utf8", timeout: 20000 });
  assert.equal(run.status, 0, run.stderr);
  assert.match(run.stdout, /Service update inventory:/);
  assert.match(run.stdout, /production evidence not-evaluated/);
});
