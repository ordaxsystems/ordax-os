import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { COMPONENT_RUNTIME_SCHEMA } from "../system/contracts/component-runtime.mjs";
import { createLocaleProfile } from "../system/contracts/locale-profile.mjs";
import { createNativeComponentSlotSource } from "../system/adapters/native/component-slot-source.mjs";
import {
  NATIVE_COMPONENT_PROBATION_IDS,
  NATIVE_COMPONENT_PROBE_MODE_BY_ID,
} from "../system/services/components/probation-policy.generated.mjs";
import { COMPONENT_MOUNT_HEALTH_PROBE_MODE } from "../system/services/components/runtime-mount-health-probe.mjs";
import { runSystemPendingComponentProbation } from "../system/services/components/probation-orchestrator.mjs";

const COMMIT = "a".repeat(40);

function windowRef() {
  return {
    location: {
      href: "http://127.0.0.1:8765/composition/native/index.html",
    },
  };
}

function metadataResponse(componentId = "notes") {
  return {
    ok: true,
    status: 200,
    async json() {
      return {
        componentId,
        state: "pending",
        source: "slot",
        revision: 9,
        version: componentId === "notes" ? "0.4.1" : "0.1.0",
        sourceCommit: COMMIT,
        entrypoint: componentId === "notes"
          ? "system/apps/notes/src/runtime.mjs"
          : "system/surface/ui/files-component-runtime.mjs",
        pendingHealth: "unknown",
      };
    },
  };
}

function notesRuntime() {
  return {
    componentRuntime: Object.freeze({
      schema: COMPONENT_RUNTIME_SCHEMA,
      componentId: "notes",
      version: "0.4.1",
      async mount() {
        throw new Error("import-contract must never mount Notes");
      },
    }),
  };
}

class FakeElement {
  constructor(documentObject) {
    this.nodeType = 1;
    this.ownerDocument = documentObject;
    this.parentNode = null;
    this.childNodes = [];
    this.dataset = {};
    this.style = {};
    this.removed = false;
  }
  append(child) {
    child.parentNode?.remove();
    child.parentNode = this;
    this.childNodes.push(child);
  }
  remove() {
    this.parentNode?.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
    this.parentNode = null;
    this.removed = true;
  }
}

function filesMountContext() {
  const documentObject = { createElement: () => new FakeElement(documentObject) };
  const root = new FakeElement(documentObject);
  const localization = Object.freeze({
    schema: "ordax.localization/2",
    getLocale: () => "pt-BR",
    getProfile: () => createLocaleProfile("pt-BR"),
    translate: (id) => id,
    subscribe: () => () => {},
  });
  return Object.freeze({
    root,
    surfaceLifecycle: Object.freeze({
      schema: "ordax.surface-render-lifecycle/5",
      localization,
      getAppTarget: () => null,
      setAppTarget() { throw new Error("read-only mount context"); },
      subscribeRender: () => () => {},
    }),
  });
}

test("mount-contract policy grants a transient Files mount and keeps Notes import-only", async () => {
  assert.equal(COMPONENT_MOUNT_HEALTH_PROBE_MODE, "mount-contract");
  assert.equal(NATIVE_COMPONENT_PROBATION_IDS.includes("files"), true);
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.files, "mount-contract");
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.notes, "import-contract");

  const orchestrator = readFileSync(
    new URL("../system/services/components/probation-orchestrator.mjs", import.meta.url),
    "utf8",
  );
  const nativeComposition = readFileSync(
    new URL("../system/composition/native/component-probation.mjs", import.meta.url),
    "utf8",
  );
  const browserHost = readFileSync(
    new URL("../system/surface/runtime/ordax_browser_host.py", import.meta.url),
    "utf8",
  );
  assert.match(orchestrator, /createRuntimeMountHealthCheck/);
  assert.match(orchestrator, /mode === COMPONENT_MOUNT_HEALTH_PROBE_MODE/);
  assert.match(orchestrator, /mountContext/);
  assert.match(nativeComposition, /composeComponentProbationContext/);
  assert.match(nativeComposition, /probeMode === mountProbeMode/);
  const nativeSignature = nativeComposition.match(
    /runNativePendingComponentProbation\(\{([\s\S]*?)\}\s*=\s*\{\}\)/,
  );
  assert.ok(nativeSignature, "Native probation function signature must remain explicit");
  assert.doesNotMatch(nativeSignature[1], /mountContext/);
  assert.doesNotMatch(browserHost, /mountContext/);

  const fetched = [];
  await assert.rejects(
    () => runSystemPendingComponentProbation({
      componentId: "files",
      source: createNativeComponentSlotSource(windowRef()),
      fetchImpl: async (url) => {
        fetched.push(url);
        throw new Error("Missing mount context must fail before fetch");
      },
      importModule: async () => { throw new Error("must not import"); },
      timeoutMs: 500,
    }),
    /context must be a plain object/,
  );
  assert.deepEqual(fetched, []);
});

test("Files probation mounts once in an isolated transient root and always destroys it", async () => {
  const context = filesMountContext();
  let mounts = 0;
  let destroys = 0;
  const result = await runSystemPendingComponentProbation({
    componentId: "files",
    source: createNativeComponentSlotSource(windowRef()),
    mountContext: context,
    fetchImpl: async () => metadataResponse("files"),
    importModule: async () => ({
      componentRuntime: Object.freeze({
        schema: COMPONENT_RUNTIME_SCHEMA,
        componentId: "files",
        version: "0.1.0",
        async mount({ root, surfaceLifecycle }) {
          mounts += 1;
          assert.notStrictEqual(root, context.root);
          assert.strictEqual(root.parentNode, context.root);
          assert.equal(root.dataset.ordaxComponentRoot, "files");
          assert.equal(root.style.display, "contents");
          assert.strictEqual(surfaceLifecycle, context.surfaceLifecycle);
          return { destroy() { destroys += 1; } };
        },
      }),
    }),
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "files");
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "mount-contract");
  assert.equal(mounts, 1);
  assert.equal(destroys, 1);
  assert.equal(context.root.childNodes.length, 0);
});

test("import-contract probation cannot be upgraded by injecting mount context", async () => {
  assert.equal(NATIVE_COMPONENT_PROBE_MODE_BY_ID.notes, "import-contract");
  const imported = [];
  const result = await runSystemPendingComponentProbation({
    componentId: "notes",
    source: createNativeComponentSlotSource(windowRef()),
    mountContext: Object.freeze({ root: "invalid-on-purpose" }),
    fetchImpl: async () => metadataResponse(),
    importModule: async (url) => {
      imported.push(url);
      return notesRuntime();
    },
    timeoutMs: 500,
  });

  assert.equal(result.componentId, "notes");
  assert.equal(result.health, "healthy");
  assert.equal(result.probeMode, "import-contract");
  assert.equal(imported.length, 1);
});
