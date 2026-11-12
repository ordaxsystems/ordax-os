import assert from "node:assert/strict";
import test from "node:test";

import { describeSpacePresentation } from "../system/services/spaces/presentation.mjs";
import { SPACE_TYPE_CATALOG, getSpaceType } from "../system/services/spaces/type-catalog.mjs";

function space(overrides = {}) {
  return {
    id: "space-1",
    ownerId: "account-1",
    name: "Meu Space",
    kind: "professional",
    state: "active",
    profilePack: null,
    ...overrides,
  };
}

test("Space type catalog owns localized semantic label ids", () => {
  assert.equal(SPACE_TYPE_CATALOG.schema, "ordax.space-type-catalog/2");
  assert.equal(getSpaceType("food", "pizzeria").labelId, "space.type.food.pizzeria");
  assert.equal(getSpaceType("fabrication", "3d-printing").labelId, "space.type.fabrication.3d-printing");
  assert.ok(SPACE_TYPE_CATALOG.types.every((definition) => definition.labelId.startsWith("space.type.")));
});

test("explicit Space semantics are the presentation authority even when Profile Pack disagrees", () => {
  assert.deepEqual(describeSpacePresentation(space({
    domain: "food",
    subtype: "pizzeria",
    profilePack: "developer",
  })), {
    typeKey: "food.pizzeria",
    typeLabelId: "space.type.food.pizzeria",
    semanticSource: "canonical-space",
  });
});

test("legacy Spaces may resolve semantic presentation from Profile Pack", () => {
  assert.deepEqual(describeSpacePresentation(space({ profilePack: "impressao-3d-br@1" })), {
    typeKey: "fabrication.3d-printing",
    typeLabelId: "space.type.fabrication.3d-printing",
    semanticSource: "legacy-profile-fallback",
  });
});

test("unknown explicit semantics never fall back to a Profile Pack", () => {
  assert.deepEqual(describeSpacePresentation(space({
    domain: "unknown-domain",
    subtype: "unknown-subtype",
    profilePack: "pizzaria-br",
  })), {
    typeKey: null,
    typeLabelId: null,
    semanticSource: "unknown",
  });
});

test("Space without canonical semantics or a known legacy binding stays generic", () => {
  assert.deepEqual(describeSpacePresentation(space()), {
    typeKey: null,
    typeLabelId: null,
    semanticSource: "unknown",
  });
});
