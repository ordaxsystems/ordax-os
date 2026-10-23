import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
test("removed Files presentation identity does not shadow host File Space contract",()=>{
  assert.equal(existsSync(new URL("../system/surface/ui/file-space-response-identity.mjs",import.meta.url)),false);
  const contract=readFileSync(new URL("../system/contracts/file-space.mjs",import.meta.url),"utf8");
  assert.match(contract,/ordax.file-space/11/);
  assert.equal(existsSync(new URL("../system/adapters/native/file-space.mjs",import.meta.url)),true);
});
