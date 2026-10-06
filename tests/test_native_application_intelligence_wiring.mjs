import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mainSource = await readFile(
  new URL("../system/composition/native/main.mjs", import.meta.url),
  "utf8",
);

function between(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test("Native Application Intelligence is a non-critical consultative wrapper", () => {
  const appContextBlock = between(
    mainSource,
    "const applicationContextIntelligence = await optionalNativeProbe(",
    "const selectedSpaceIntelligence = memory === null",
  );
  const profileBlock = between(
    mainSource,
    "const profileContentIntelligence =",
    "const applicationContextIntelligence = await optionalNativeProbe(",
  );
  const memoryBlock = between(
    mainSource,
    "const selectedSpaceIntelligence = memory === null",
    "const personalOrdaxFileActions =",
  );

  assert.match(appContextBlock, /createNativeVerifiedApplicationContextIntelligence\(\{/);
  assert.match(appContextBlock, /intelligencePort: profileContentIntelligence/);
  assert.match(appContextBlock, /\?\? profileContentIntelligence;/);
  assert.match(profileBlock, /intelligencePort: intelligence/);
  assert.match(
    memoryBlock,
    /createIdentityBoundMemoryIntelligence\(\{[\s\S]*intelligencePort: applicationContextIntelligence/,
  );
});

test("Native Application Intelligence does not restore a dedicated semantics endpoint", () => {
  assert.doesNotMatch(mainSource, /__ordax\/native\/app-intelligence-manifest/);
  assert.doesNotMatch(mainSource, /__ordax\/native\/app-intelligence-awareness/);
});
