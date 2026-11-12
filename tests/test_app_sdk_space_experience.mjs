import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  SPACE_TYPE_DEFINITION_SCHEMA,
  SPACE_TYPE_CATALOG_SCHEMA,
  SPACE_CAPABILITY_PROVIDER_SCHEMA,
  SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
  SPACE_EXPERIENCE_SCHEMA,
  SPACE_EXPERIENCE_SOURCE_SCHEMA,
  validateSpaceCapabilitySnapshot,
  assertSpaceCapabilityProvider,
  assertSpaceExperienceSource,
} from "../system/contracts/space-experience.mjs";
import { getSpaceType } from "../system/services/spaces/type-catalog.mjs";

const bundle = JSON.parse(readFileSync(new URL("../sdk/app-sdk-v1/bundle.json", import.meta.url), "utf8"));
const canonicalBytes = readFileSync(new URL("../system/contracts/space-experience.mjs", import.meta.url));
const gitBlob = createHash("sha1")
  .update(`blob ${canonicalBytes.length}\0`)
  .update(canonicalBytes)
  .digest("hex");

test("Space Experience is published additively from one canonical, authority-free App SDK source", () => {
  assert.equal(bundle.bundle_version, "1.21.0");
  assert.equal(bundle.authority, "none");
  const required = new Map([
    ["space-type-definition", SPACE_TYPE_DEFINITION_SCHEMA],
    ["space-type-catalog", SPACE_TYPE_CATALOG_SCHEMA],
    ["space-capability-provider", SPACE_CAPABILITY_PROVIDER_SCHEMA],
    ["space-capability-snapshot", SPACE_CAPABILITY_SNAPSHOT_SCHEMA],
    ["space-experience", SPACE_EXPERIENCE_SCHEMA],
    ["space-experience-source", SPACE_EXPERIENCE_SOURCE_SCHEMA],
  ]);
  const entries = bundle.contracts.filter((contract) => required.has(contract.name));
  assert.equal(entries.length, required.size);
  for (const entry of entries) {
    assert.equal(entry.schema, required.get(entry.name));
    assert.equal(entry.major, Number(entry.schema.split("/").at(-1)));
    assert.equal(entry.source_git_blob, gitBlob);
    assert.equal(entry.source_path, "system/contracts/space-experience.mjs");
  }
  assert.equal(bundle.contracts.length, new Set(bundle.contracts.map(({ name }) => name)).size);
  const source = canonicalBytes.toString("utf8");
  for (const forbidden of ["system/services/", "localStorage", "fetch(", "process.env", "require("]) {
    assert.equal(source.includes(forbidden), false, `Public Space contract must not import or execute ${forbidden}`);
  }
});

test("Space snapshots fail closed across Spaces and when a capability is unavailable", () => {
  const spaceId = "space-pizzeria-a";
  const unavailable = validateSpaceCapabilitySnapshot({
    schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
    state: "unavailable",
    spaceId,
    metrics: {},
  }, spaceId);
  assert.equal(unavailable.state, "unavailable");
  assert.equal(Object.keys(unavailable.metrics).length, 0);
  assert.throws(() => validateSpaceCapabilitySnapshot({
    schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
    state: "ready",
    spaceId,
    metrics: { "orders.today": 12 },
  }, "space-pizzeria-b"), /another Space/);
  assert.throws(() => validateSpaceCapabilitySnapshot({
    schema: SPACE_CAPABILITY_SNAPSHOT_SCHEMA,
    state: "unavailable",
    spaceId,
    metrics: { "orders.today": 12 },
  }, spaceId), /cannot expose metrics while unavailable/);
});

test("typed Space provider/source definitions require host-supplied ports, not a capability grant", () => {
  const provider = assertSpaceCapabilityProvider({
    schema: SPACE_CAPABILITY_PROVIDER_SCHEMA,
    capability: "orders",
    spaceTypes: ["food.pizzeria"],
    getSnapshot() { return { state: "unavailable" }; },
    subscribe() { return () => {}; },
  });
  assert.equal(provider.capability, "orders");
  assert.throws(() => assertSpaceCapabilityProvider({ ...provider, subscribe: null }), /subscribe/);
  assert.throws(() => assertSpaceExperienceSource({
    schema: SPACE_EXPERIENCE_SOURCE_SCHEMA,
    get() {},
  }), /Compatible Space experience source/);
  const source = assertSpaceExperienceSource({
    schema: SPACE_EXPERIENCE_SOURCE_SCHEMA,
    get() { return null; },
    subscribe() { return () => {}; },
  });
  assert.equal(source.get(), null);
});

test("Food KDS appears only as a navigation module bound to the orders capability", () => {
  const food = getSpaceType("food", "pizzeria");
  assert.ok(food);
  assert.equal(food.navigation.filter(({ id }) => id === "kitchen").length, 1);
  assert.equal(food.navigation.find(({ id }) => id === "kitchen").capability, "orders");
  assert.equal(food.capabilities.includes("kitchen"), false);
  assert.equal(food.capabilities.includes("orders"), true);
  assert.equal(food.navigation.find(({ id }) => id === "inventory").capability, "inventory");
});
