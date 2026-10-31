import assert from "node:assert/strict";
import test from "node:test";
import { createNativeIntelligenceClientTrustedContextProvider } from "../system/composition/native/intelligence-client-trusted-context.mjs";

const CURRENT = Object.freeze({
  componentId: "assistant", state: "current", source: "slot",
  revision: 4, version: "0.1.2", sourceCommit: "a".repeat(40),
  entrypoint: "system/apps/assistant/src/runtime.mjs", pendingHealth: null,
});
const SUBSCRIBE = () => () => {};
const identitySessionPort = Object.freeze({
  schema: "ordax.identity-session/1",
  getSnapshot: () => ({ state: "unavailable", subjectId: null, displayName: null }),
  subscribe: SUBSCRIBE,
});
const spaceSelectionPort = Object.freeze({
  schema: "ordax.space-selection/1",
  getSnapshot: () => ({
    schema: "ordax.space-selection/1", state: "unavailable", subjectId: null, selectedSpace: null,
  }),
  subscribe: SUBSCRIBE, select() { throw Error("not tested"); }, clear() { throw Error("not tested"); },
});
const intelligencePort = Object.freeze({
  schema: "ordax.intelligence/1",
  getSnapshot: () => ({
    schema: "ordax.intelligence/1", state: "degraded", inferenceAvailable: false,
    authority: "none", toolExecution: false, engineId: null, modelId: null,
  }),
  subscribe: SUBSCRIBE, respond() { throw Error("not tested"); },
});
const ports = Object.freeze({ identitySessionPort, spaceSelectionPort, intelligencePort });

test("Aura's host-owned context uses three existing public ports and exact signed current slot", () => {
  const provider = createNativeIntelligenceClientTrustedContextProvider({ ...ports, verifiedCurrent: CURRENT });
  const context = provider("assistant");
  assert.equal(Object.isFrozen(context), true);
  assert.deepEqual(Object.keys(context).sort(), ["identitySessionPort", "intelligence", "spaceSelectionPort"]);
  assert.strictEqual(context.identitySessionPort, identitySessionPort);
  assert.strictEqual(context.spaceSelectionPort, spaceSelectionPort);
  assert.strictEqual(context.intelligence, intelligencePort);
  for (const id of ["studio", "files", "calculator", "aura", "../assistant"]) {
    assert.equal(provider(id), null);
  }
});

test("Aura cannot receive trusted ports from absent, removed, pending or bundled slots", () => {
  assert.throws(() => createNativeIntelligenceClientTrustedContextProvider(ports)("assistant"), /verified current/);
  for (const current of [
    { ...CURRENT, source: "absent", version: null, sourceCommit: null, entrypoint: null },
    { ...CURRENT, source: "removed", version: null, sourceCommit: null, entrypoint: null },
    { ...CURRENT, source: "bundled" },
    { ...CURRENT, state: "pending", pendingHealth: "unknown" },
    { ...CURRENT, componentId: "another-app" },
    { ...CURRENT, revision: -1 },
  ]) {
    assert.throws(
      () => createNativeIntelligenceClientTrustedContextProvider({ ...ports, verifiedCurrent: current })("assistant"),
      /current|installed|slot|metadata|revision/i,
    );
  }
  for (const missing of ["identitySessionPort", "spaceSelectionPort", "intelligencePort"]) {
    const invalid = { ...ports, verifiedCurrent: CURRENT, [missing]: null };
    assert.throws(() => createNativeIntelligenceClientTrustedContextProvider(invalid)("assistant"), /required|compatible|port/i);
  }
});

test("Native composition installs only this verified binding; it is not an app or new authority", async () => {
  const { readFile } = await import("node:fs/promises");
  const composition = await readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");
  assert.match(composition, /installTrustedComponentContextProvider\(\s*createNativeIntelligenceClientTrustedContextProvider/);
  assert.match(composition, /hasNativeExternalFirstPartyModuleRead\("assistant"\)/);
  assert.match(composition, /verifiedCurrent: installedAppCatalog\?\.installed\.find/);
  assert.match(composition, /intelligencePort: selectedSpaceIntelligence/);
});
