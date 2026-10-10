import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { assertSpaceSelectionPort } from "../system/contracts/space-selection.mjs";
import { createUnavailableWebSpaceSelection } from "../system/adapters/web/space-selection.mjs";

test("Web Assistant uses canonical, explicitly unavailable Space port without a second selector", () => {
  const port = createUnavailableWebSpaceSelection();
  assert.equal(assertSpaceSelectionPort(port), port);
  assert.equal(port.getSnapshot().state, "unavailable");
  assert.equal(port.getSnapshot().subjectId, null);
  assert.equal(port.getSnapshot().selectedSpace, null);
  assert.throws(() => port.select("space-1"), /not available/);
  assert.equal(port.clear().state, "unavailable");
  const seen = [];
  const unsubscribe = port.subscribe((value) => seen.push(value.state));
  unsubscribe();
  assert.deepEqual(seen, ["unavailable"]);
});

test("Web composition mounts the same Assistant UI and never invents model inference", async () => {
  const source = await readFile(new URL("../system/composition/web/main.mjs", import.meta.url), "utf8");
  assert.match(source, /componentId: "assistant"/);
  assert.match(source, /identitySessionPort: identitySession/);
  assert.match(source, /spaceSelectionPort: createUnavailableWebSpaceSelection\(\)/);
  assert.match(source, /intelligence: null/);
  assert.doesNotMatch(source, /fakeIntelligence|mockModel|createAssistantConversationRuntime\(/);
});
