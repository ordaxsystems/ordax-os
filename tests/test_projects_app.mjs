import assert from "node:assert/strict";
import test from "node:test";
import { existsSync } from "node:fs";
import { getFirstPartyApp } from "../system/apps/catalog.mjs";
import { getSystemComponent } from "../system/apps/component-catalog.mjs";
import { createAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";

test("Projects cannot be displayed or restored from a removed bundled source", () => {
  assert.equal(existsSync(new URL("../system/apps/projects/", import.meta.url)), false);
  assert.equal(getFirstPartyApp("projects"), null);
  assert.equal(getSystemComponent("projects"), null);
  const runtimeCatalog = createAppRuntimeCatalog();
  assert.equal(runtimeCatalog.get("projects"), null);
});
