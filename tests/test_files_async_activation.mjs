import test from "node:test";
import assert from "node:assert/strict";
import { listFirstPartyApps } from "../system/apps/catalog.mjs";
import { createAppRuntimeCatalog } from "../system/apps/runtime-catalog.mjs";
test("absent optional Files has no launchable or implicit activation fallback", () => {
  assert.equal(listFirstPartyApps().some(app=>app.id==="files"), false);
  const catalog=createAppRuntimeCatalog({external:[]});
  assert.equal(catalog.get("files"),null);
  assert.equal(catalog.list().some(app=>app.id==="files"),false);
});
