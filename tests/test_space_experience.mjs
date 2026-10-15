import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  SPACE_CAPABILITY_PROVIDER_SCHEMA,
  SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
  assertSpaceCapabilityProvider,
} from "../system/contracts/space-experience.mjs";
import { validateSpace } from "../system/contracts/spaces.mjs";
import {
  SPACE_TYPE_CATALOG,
  composeSpaceExperience,
  createStudioProjectIntent,
  resolveSpaceType,
} from "../system/services/spaces/composition.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const type = (key) => SPACE_TYPE_CATALOG.types.find((entry) => entry.key === key);

function space(overrides = {}) {
  return {
    id: "space-1",
    ownerId: "owner-1",
    name: "Space",
    kind: "professional",
    state: "active",
    profilePack: null,
    ...overrides,
  };
}

function provider(capability, {
  state = "ready",
  metrics = {},
  auraContext = null,
  spaceId = null,
  spaceTypes = ["food.pizzeria", "fabrication.3d-printing"],
} = {}) {
  const listeners = new Set();
  return {
    schema: SPACE_CAPABILITY_PROVIDER_SCHEMA,
    capability,
    spaceTypes,
    getSnapshot(currentSpace) {
      return {
        schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
        state,
        spaceId: spaceId ?? currentSpace.id,
        metrics: state === "ready" ? metrics : {},
        auraContext: state === "ready" ? auraContext : null,
      };
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

test("food.pizzeria declares only its domain capabilities and ignores foreign providers", () => {
  const definition = type("food.pizzeria");
  assert.ok(definition);
  assert.ok(definition.capabilities.includes("orders"));
  assert.ok(definition.capabilities.includes("tables"));
  assert.equal(definition.capabilities.includes("printers"), false);
  assert.equal(definition.capabilities.includes("quotes"), false);
  const experience = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [
    provider("orders", { metrics: { "orders.today": 7 } }),
    provider("printers", { metrics: { "printers.active": 4 } }),
  ]);
  assert.deepEqual(experience.capabilities, ["orders"]);
  assert.deepEqual(experience.widgets.map((item) => item.id), ["orders.today"]);
});

test("capability providers are selected by exact Space type and never leak across domains", () => {
  let foodCalls = 0;
  let fabricationCalls = 0;
  const foodBase = provider("orders", {
    spaceTypes: ["food.pizzeria"],
    metrics: { "orders.today": 4 },
  });
  const fabricationBase = provider("orders", {
    spaceTypes: ["fabrication.3d-printing"],
    metrics: { "orders.today": 9 },
  });
  const foodOrders = {
    ...foodBase,
    getSnapshot(currentSpace) {
      foodCalls += 1;
      return foodBase.getSnapshot(currentSpace);
    },
  };
  const fabricationOrders = {
    ...fabricationBase,
    getSnapshot(currentSpace) {
      fabricationCalls += 1;
      return fabricationBase.getSnapshot(currentSpace);
    },
  };

  const food = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [foodOrders, fabricationOrders]);
  assert.deepEqual(food.widgets.map((item) => [item.id, item.value]), [["orders.today", 4]]);
  assert.equal(foodCalls, 1);
  assert.equal(fabricationCalls, 0);

  const fabrication = composeSpaceExperience(space({ profilePack: "impressao-3d-br" }), [foodOrders, fabricationOrders]);
  assert.deepEqual(
    fabrication.widgets.filter((item) => item.id === "orders.today").map((item) => item.value),
    [9],
  );
  assert.equal(foodCalls, 1);
  assert.equal(fabricationCalls, 1);
});

test("provider registry rejects overlapping scopes for the same capability", () => {
  const current = space({ profilePack: "pizzaria-br" });
  assert.throws(() => composeSpaceExperience(current, [
    provider("orders", { spaceTypes: ["food.pizzeria"] }),
    provider("orders", { spaceTypes: ["food.pizzeria", "fabrication.3d-printing"] }),
  ]), /Overlapping Space capability provider orders for food.pizzeria/);
});

test("provider contract requires explicit non-empty Space type scope", () => {
  assert.throws(() => assertSpaceCapabilityProvider(provider("orders", { spaceTypes: [] })), /spaceTypes must not be empty/);
  const { spaceTypes: _scope, ...missingScope } = provider("orders");
  assert.throws(() => assertSpaceCapabilityProvider(missingScope), /spaceTypes must be a bounded array/);
});

test("fabrication.3d-printing never receives tables by convenience", () => {
  const definition = type("fabrication.3d-printing");
  assert.ok(definition.capabilities.includes("printers"));
  assert.equal(definition.capabilities.includes("tables"), false);
  const experience = composeSpaceExperience(space({ profilePack: "impressao-3d-br" }), [
    provider("printers", { metrics: { "printers.active": 2 } }),
    provider("tables", { metrics: { "tables.occupancy": 90 } }),
  ]);
  assert.deepEqual(experience.capabilities, ["printers"]);
  assert.equal(experience.navigation.some((item) => item.id === "tables"), false);
});

test("territorial product operations never declares printers and stays deferred", () => {
  const definition = type("product-operations.territorial-platform");
  assert.equal(definition.capabilities.includes("printers"), false);
  assert.ok(definition.capabilities.includes("businesses"));
  const experience = composeSpaceExperience(space({
    domain: "product-operations",
    subtype: "territorial-platform",
  }), [provider("businesses", { metrics: { "businesses.active": 10 } })]);
  assert.equal(experience.state, "deferred");
  assert.deepEqual(experience.capabilities, []);
  assert.deepEqual(experience.widgets, []);
  assert.deepEqual(experience.navigation, []);
});

test("education.school never declares orders and remains a safe deferred contract", () => {
  const definition = type("education.school");
  assert.equal(definition.capabilities.includes("orders"), false);
  assert.ok(definition.capabilities.includes("students"));
  assert.ok(definition.capabilities.includes("guardians"));
  assert.ok(definition.capabilities.includes("transport"));
  assert.equal(definition.navigation.some((item) => item.id === "camera"), false);
});

test("dashboard widget is omitted when its capability is absent", () => {
  const experience = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [
    provider("orders", { metrics: { "orders.today": 5 } }),
  ]);
  assert.ok(experience.widgets.some((item) => item.id === "orders.today"));
  assert.equal(experience.widgets.some((item) => item.id === "finance.revenue_today"), false);
  assert.equal(experience.widgets.some((item) => item.id === "tables.occupancy"), false);
});

test("contextual menu is omitted when its capability is absent", () => {
  const experience = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [
    provider("orders", { metrics: {} }),
  ]);
  assert.ok(experience.navigation.some((item) => item.id === "overview"));
  assert.ok(experience.navigation.some((item) => item.id === "orders"));
  assert.equal(experience.navigation.some((item) => item.id === "tables"), false);
  assert.equal(experience.navigation.some((item) => item.id === "finance"), false);
});

test("unavailable or failing provider degrades without breaking the Space projection", () => {
  const unavailable = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [
    provider("orders", { state: "error" }),
  ]);
  assert.equal(unavailable.state, "ready");
  assert.deepEqual(unavailable.capabilities, []);
  assert.deepEqual(unavailable.widgets, []);
  const throwing = {
    ...provider("tables"),
    getSnapshot() { throw new Error("offline"); },
  };
  assert.doesNotThrow(() => composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [throwing]));
  assert.deepEqual(composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [throwing]).capabilities, []);
});

test("Aura receives only a current-Space-scoped authorized context", () => {
  const current = space({ id: "pizza-1", profilePack: "pizzaria-br" });
  const valid = composeSpaceExperience(current, [
    provider("orders", {
      metrics: { "orders.today": 2 },
      auraContext: { spaceId: "pizza-1", delayedOrders: 1 },
    }),
    provider("aura", {
      metrics: { "aura.summary": "2 itens precisam de atenção" },
      auraContext: { spaceId: "pizza-1", summary: "2 itens precisam de atenção" },
    }),
  ]);
  assert.equal(valid.auraContext.spaceId, "pizza-1");
  assert.equal(valid.auraContext.domain, "food");
  assert.deepEqual(valid.auraContext.capabilities, ["orders", "aura"]);
  assert.deepEqual(valid.auraContext.fragments, [
    { capability: "orders", data: { delayedOrders: 1 } },
    { capability: "aura", data: { summary: "2 itens precisam de atenção" } },
  ]);
  const noAura = composeSpaceExperience(current, [
    provider("orders", {
      metrics: { "orders.today": 2 },
      auraContext: { spaceId: "pizza-1", delayedOrders: 1 },
    }),
  ]);
  assert.equal(noAura.auraContext, null);
  const foreign = composeSpaceExperience(current, [
    provider("aura", {
      spaceId: "other-space",
      metrics: { "aura.summary": "foreign" },
      auraContext: { spaceId: "other-space", summary: "foreign" },
    }),
  ]);
  assert.equal(foreign.auraContext, null);
  assert.deepEqual(foreign.widgets, []);
});

test("global sidebar stays outside Space contextual composition", () => {
  const shell = read("system/surface/ui/desktop-shell.mjs");
  const composition = read("system/services/spaces/composition.mjs");
  const catalog = read("system/services/spaces/type-catalog.mjs");
  assert.doesNotMatch(shell, /SPACE_TYPE_CATALOG|composeSpaceExperience|space-type-definition/);
  assert.doesNotMatch(composition, /desktop-shell|sidebar/i);
  assert.doesNotMatch(catalog, /desktop-shell|data-sidebar/i);
});

test("Profile Pack composition and Space semantics stay separate owners", () => {
  for (const path of [
    "system/profile-packs/pizzaria-br/v1/manifest.json",
    "system/profile-packs/impressao-3d-br/v1/manifest.json",
    "system/profile-packs/developer/v1/manifest.json",
  ]) {
    const manifest = JSON.parse(read(path));
    assert.equal("navigation" in manifest, false);
    assert.equal("dashboard" in manifest, false);
    assert.equal("data_providers" in manifest, false);
  }
  for (const definition of SPACE_TYPE_CATALOG.types) {
    assert.equal("apps" in definition, false);
    assert.equal("templates" in definition, false);
    assert.equal("knowledge" in definition, false);
  }
});

test("Spaces overview metrics are domain-specific and provider-backed", () => {
  const pizza = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [
    provider("orders", { metrics: { "orders.today": 12 } }),
    provider("tables", { metrics: { "tables.occupancy": 75 } }),
    provider("finance", { metrics: { "finance.revenue_today": 840 } }),
  ]);
  assert.deepEqual(pizza.spaceCardMetrics.map((item) => item.id), [
    "orders.today", "tables.occupancy", "finance.revenue_today",
  ]);
  const fabrication = composeSpaceExperience(space({ profilePack: "impressao-3d-br" }), [
    provider("jobs", { metrics: { "jobs.queue": 4 } }),
    provider("printers", { metrics: { "printers.active": 3 } }),
    provider("models", { metrics: { "models.active": 18 } }),
    provider("materials", { metrics: { "materials.alerts": 1 } }),
  ]);
  assert.deepEqual(fabrication.spaceCardMetrics.map((item) => item.id), [
    "jobs.queue", "printers.active", "models.active", "materials.alerts",
  ]);
  assert.equal(fabrication.spaceCardMetrics.some((item) => item.id === "orders.today"), false);
});

test("missing provider metric never creates an invented number", () => {
  const experience = composeSpaceExperience(space({ profilePack: "pizzaria-br" }), [
    provider("orders", { metrics: {} }),
    provider("tables", { metrics: { "tables.occupancy": 0 } }),
  ]);
  assert.equal(experience.widgets.some((item) => item.id === "orders.today"), false);
  assert.deepEqual(experience.spaceCardMetrics.map((item) => [item.id, item.value]), [
    ["tables.occupancy", 0],
  ]);
});

test("Development models many Projects inside one Space instead of one Space per repo", () => {
  const definition = type("development.software");
  assert.equal(definition.lifecycle, "deferred");
  const projectResource = definition.resources.find((item) => item.kind === "project");
  assert.deepEqual(projectResource, {
    kind: "project",
    multiplicity: "many",
    owner: "space",
    openWith: "studio",
  });
  assert.ok(definition.capabilities.includes("projects"));
  assert.ok(definition.capabilities.includes("repositories"));
});

test("Studio opens selected Project context and is not the Project owner", () => {
  const devSpace = space({
    id: "development-space",
    domain: "development",
    subtype: "software",
  });
  assert.deepEqual(createStudioProjectIntent(devSpace, "achegue-se"), {
    appId: "studio",
    ownership: "space",
    spaceId: "development-space",
    projectId: "achegue-se",
  });
});

test("Space type resolution supports current Profile bindings and future explicit semantics", () => {
  assert.equal(resolveSpaceType(space({ profilePack: "pizzaria-br" })).key, "food.pizzeria");
  assert.equal(resolveSpaceType(space({ profilePack: "impressao-3d-br@1" })).key, "fabrication.3d-printing");
  assert.equal(resolveSpaceType(space({ domain: "education", subtype: "school" })).key, "education.school");
  assert.throws(() => validateSpace(space({ domain: "food" })), /supplied together/);
});


test("Spaces page consumes generic provider-backed metrics without vertical hardcoding", () => {
  const account = read("system/surface/ui/account-overview-controls.mjs");
  const native = read("system/composition/native/main.mjs");
  assert.match(account, /spaceExperiencePort\?\.get\(space\)/);
  assert.match(account, /experience\.spaceCardMetrics/);
  assert.match(account, /metric\.label/);
  assert.match(account, /metric\.value/);
  assert.doesNotMatch(account, /orders\.today|printers\.active|students\.total|businesses\.active/);
  assert.match(native, /createSelectedSpaceAuraCapabilityProvider/);
  assert.match(native, /providers: \[selectedSpaceAuraCapability\]/);
  assert.match(native, /Transactional vertical capabilities remain unavailable/);
});
