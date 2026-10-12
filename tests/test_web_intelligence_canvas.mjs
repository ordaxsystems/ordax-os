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

test("Canonical Web preserves Intelligence entry without executing providers", async () => {
  const source = await readFile(new URL("../system/composition/web/main.tsx", import.meta.url), "utf8");
  const stub = await readFile(new URL("../system/surface/workspace/lib/intelligence/ai.functions.ts", import.meta.url), "utf8");
  assert.match(source, /RouterProvider/);
  assert.match(source, /StoreCatalogProvider/);
  assert.match(source, /SessionWorkspace/);
  assert.match(source, /WebAccountProvider/);
  assert.match(source, /<Central\b/);
  assert.doesNotMatch(source, /WebShell/);
  assert.match(stub, /status: 503/);
  assert.doesNotMatch(stub, /fetch\(|process.env|apiKey/);
  assert.doesNotMatch(source, /adapters\/native|createAssistantConversationRuntime\(/);
});
