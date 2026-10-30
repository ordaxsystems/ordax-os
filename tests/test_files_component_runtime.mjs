import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
test("optional Files UI cannot become a native boot prerequisite",()=>{
  const base=new URL("../system/surface/ui/",import.meta.url);
  for(const moduleName of ["files-component-runtime.mjs","file-space-controls.mjs","files.css"])
    assert.equal(existsSync(new URL(moduleName,base)),false,moduleName);
  const composition=readFileSync(new URL("../system/composition/native/main.mjs",import.meta.url),"utf8");
  assert.doesNotMatch(composition,/mountFileSpaceControls/);
  assert.match(composition,/createNativeFileSpace/);
});
