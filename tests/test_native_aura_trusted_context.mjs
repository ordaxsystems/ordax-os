import assert from "node:assert/strict";
import test from "node:test";
import { createNativeIntelligenceClientTrustedContextProvider, createNativeIntelligenceClientPendingBootstrap } from "../system/composition/native/intelligence-client-trusted-context.mjs";
import { NATIVE_COMPONENT_PROBATION_IDS, NATIVE_COMPONENT_PROBE_MODE_BY_ID } from "../system/services/components/probation-policy.generated.mjs";

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


// The real pending Aura mount is handled by the existing opaque-origin Native
// sandbox. This host supplies only an empty root + fixed offline lifecycle.
test("Aura pending probation uses the generic host but never leaks real host ports", async () => {
  class FakeElement {
    constructor(doc) {
      this.nodeType = 1; this.ownerDocument = doc;
      this.childNodes = []; this.dataset = {}; this.style = {};
      this.parentNode = null; this.hidden = false;
    }
    append(child) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
    remove() {
      if (this.parentNode) {
        this.parentNode.childNodes = this.parentNode.childNodes.filter((entry) => entry !== this);
        this.parentNode = null;
      }
    }
  }
  const doc = { createElement() { return new FakeElement(doc); } };
  const root = new FakeElement(doc);
  let provider = null;
  const bootstrap = createNativeIntelligenceClientPendingBootstrap({
    installProvider(candidate) { provider = candidate; },
  });
  assert.ok(bootstrap);
  assert.equal(NATIVE_COMPONENT_PROBATION_IDS.includes("assistant"), true);
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.assistant, "mount-contract");
  assert.equal(await provider("notes"), null);
  const pending = provider("assistant");
  assert.equal(root.childNodes.length, 0);
  // Supplying real ports is intentionally ignored by the synthetic adapter.
  bootstrap.bind({ root, ports });
  const context = await pending;
  assert.deepEqual(Object.keys(context).sort(), ["root", "surfaceLifecycle"]);
  assert.equal(context.surfaceLifecycle.schema, "ordax.surface-render-lifecycle/5");
  assert.equal(context.surfaceLifecycle.localization.getLocale(), "pt-BR");
  assert.equal(context.surfaceLifecycle.getAppTarget("assistant"), null);
  assert.throws(() => context.surfaceLifecycle.setAppTarget("assistant", "home"),
    /cannot control Surface/);
  assert.equal(root.childNodes.length, 1);
  assert.strictEqual(context.root, root.childNodes[0]);
  assert.equal(context.root.hidden, true);
  assert.equal(context.root.dataset.ordaxComponentProbationHost, "assistant");
  for (const key of ["intelligence", "identitySessionPort", "spaceSelectionPort",
    "memoryCapture", "personalOrdax", "appData"]) {
    assert.equal(Object.hasOwn(context, key), false, key);
  }
  bootstrap.destroy();
  assert.equal(root.childNodes.length, 0);
  await assert.rejects(() => provider("assistant"), /destroyed/);
});

test("Native Surface wires Aura's pending provider before async work and cleans up", async () => {
  const { readFile } = await import("node:fs/promises");
  const code = await readFile(new URL("../system/composition/native/main.mjs", import.meta.url), "utf8");
  const start = code.indexOf("async function start() {");
  const registered = code.indexOf("assistantPendingBootstrap = createNativeIntelligenceClientPendingBootstrap();", start);
  const firstAwait = code.indexOf("await ", start);
  const mounted = code.indexOf("const surface = mountSurface(", firstAwait);
  const bound = code.indexOf("assistantPendingBootstrap?.bind({ root, ports: {} });", mounted);
  const verified = code.indexOf("createNativeIntelligenceClientTrustedContextProvider({", bound);
  assert.ok(start >= 0 && registered > start && registered < firstAwait);
  assert.ok(mounted > firstAwait && bound > mounted && verified > bound);
  assert.ok(code.indexOf("assistantPendingBootstrap?.destroy();", verified) > verified);
  assert.ok(code.indexOf("assistantPendingBootstrap?.fail(error);", verified) > verified);
});
