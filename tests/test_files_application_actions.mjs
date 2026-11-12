import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { listBundledFirstPartyIntelligenceManifests } from "../system/apps/intelligence-catalog.mjs";
test("no bundled Files action provider or intelligence manifest remains",()=>{
  assert.equal(existsSync(new URL("../system/apps/files/actions/",import.meta.url)),false);
  assert.equal(existsSync(new URL("../system/apps/files/ai/",import.meta.url)),false);
  assert.equal(listBundledFirstPartyIntelligenceManifests().some(m=>m.appId==="files"),false);
  assert.equal(existsSync(new URL("../system/contracts/file-space.mjs",import.meta.url)),true);
});
