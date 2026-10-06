import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../system/composition/native/main.mjs", import.meta.url),
  "utf8",
);

test("Native Application Intelligence is a non-critical consultative wrapper", () => {
  assert.match(
    mainSource,
    /const applicationContextIntelligence = await optionalNativeProbe\([\s\S]*createNativeVerifiedApplicationContextIntelligence\([\s\S]*\)\s*\)\s*\?\? profileContentIntelligence;/,
  );
  assert.match(
    mainSource,
    /const profileContentIntelligence = [\s\S]*intelligencePort: intelligence/,
  );
  assert.match(
    mainSource,
    /createIdentityBoundMemoryIntelligence\(\{\s*intelligencePort: applicationContextIntelligence,/,
  );
});

test("Native Application Intelligence does not restore a dedicated semantics endpoint", () => {
  assert.doesNotMatch(mainSource, /__ordax\/native\/app-intelligence-manifest/);
  assert.doesNotMatch(mainSource, /__ordax\/native\/app-intelligence-awareness/);
});
