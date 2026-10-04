import test from "node:test";
import assert from "node:assert/strict";

import {
  NATIVE_STUDIO_HOST_COMPOSITION_SCHEMA,
  createNativeStudioHostComposition,
} from "../system/composition/native/studio-host.mjs";
import { STUDIO_RUNTIME_V2_PORT_SCHEMA } from "../system/contracts/studio-runtime-v2.mjs";
import { STUDIO_ACTION_CONTEXT_SCHEMA } from "../system/contracts/studio-action-context.mjs";
import {
  DEVICE_AGENT_CAPABILITIES_SCHEMA,
  DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
} from "../system/contracts/device-capabilities.mjs";
import { PROJECT_CATALOG_SCHEMA } from "../system/contracts/project-catalog.mjs";
import { MEMORY_PORT_SCHEMA } from "../system/contracts/memory.mjs";
import { INTELLIGENCE_PORT_SCHEMA } from "../system/contracts/intelligence.mjs";
import { LOCALIZATION_SCHEMA } from "../system/contracts/localization.mjs";

const noop = () => {};

function studioRuntime() {
  return {
    schema: STUDIO_RUNTIME_V2_PORT_SCHEMA,
    capabilityReader: {
      schema: DEVICE_AGENT_CAPABILITY_READER_SCHEMA,
      capabilities: async () => ({
        schema: DEVICE_AGENT_CAPABILITIES_SCHEMA,
        state: "ready",
        capabilities: [],
      }),
    },
    projectCatalog: {
      schema: PROJECT_CATALOG_SCHEMA,
      getSnapshot: () => ({ persistence: "device", projects: [] }),
      subscribe: noop,
      create: noop,
      rename: noop,
      recordOpened: noop,
      recordFileOpened: noop,
      clearLastFile: noop,
      relocateLastFilePath: noop,
      remove: noop,
    },
    getActionContext: async () => ({
      schema: STUDIO_ACTION_CONTEXT_SCHEMA,
      actor: { kind: "device-owner", subjectId: null },
      deviceId: "device-native",
      client: "ordax-native",
      spaceId: null,
    }),
    requestAction: async () => {
      throw new Error("not dispatched by composition test");
    },
  };
}

function memory() {
  return {
    schema: MEMORY_PORT_SCHEMA,
    search: noop,
    remember: noop,
    forget: noop,
    flush: noop,
  };
}

function intelligence() {
  return {
    schema: INTELLIGENCE_PORT_SCHEMA,
    getSnapshot: () => ({
      schema: INTELLIGENCE_PORT_SCHEMA,
      state: "degraded",
      inferenceAvailable: false,
      engineId: null,
      modelId: null,
      authority: "none",
      toolExecution: false,
    }),
    subscribe: noop,
    respond: noop,
  };
}

function localization() {
  return {
    schema: LOCALIZATION_SCHEMA,
    getLocale: () => "pt-BR",
    translate: (key) => key,
    subscribe: noop,
  };
}

function validInput() {
  return {
    studioRuntime: studioRuntime(),
    memory: memory(),
    intelligence: intelligence(),
    localization: localization(),
  };
}

test("native Studio host v2 composes only the four reviewed public facets", () => {
  const input = validInput();
  const host = createNativeStudioHostComposition(input);

  assert.equal(host.schema, NATIVE_STUDIO_HOST_COMPOSITION_SCHEMA);
  assert.equal(host.authority, "none");
  assert.equal(host.target, "ordax-os");
  assert.equal(host.studioRuntime, input.studioRuntime);
  assert.equal(host.studioRuntime.schema, STUDIO_RUNTIME_V2_PORT_SCHEMA);
  assert.equal(host.memory, input.memory);
  assert.equal(host.intelligence, input.intelligence);
  assert.equal(host.localization, input.localization);
  assert.equal(Object.isFrozen(host), true);
  assert.deepEqual(Object.keys(host).sort(), [
    "authority",
    "intelligence",
    "localization",
    "memory",
    "schema",
    "studioRuntime",
    "target",
  ]);
});

test("native Studio host rejects authority and implementation leaks", () => {
  for (const [field, value] of [
    ["execute", noop],
    ["deviceAgent", {}],
    ["controlPlane", {}],
    ["pairing", {}],
    ["computerPolicy", {}],
    ["provider", "openai"],
  ]) {
    const input = { ...validInput(), [field]: value };
    assert.throws(
      () => createNativeStudioHostComposition(input),
      /fields are incompatible/,
      field,
    );
  }
});

test("native Studio host refuses raw or generic dispatch hidden inside runtime v2", () => {
  for (const field of ["execute", "deviceAgent", "call"]) {
    const input = validInput();
    input.studioRuntime = { ...input.studioRuntime, [field]: noop };
    assert.throws(
      () => createNativeStudioHostComposition(input),
      /raw or generic dispatch/,
      field,
    );
  }
});

test("native Studio host requires runtime v2 action context", () => {
  const input = validInput();
  delete input.studioRuntime.getActionContext;
  assert.throws(
    () => createNativeStudioHostComposition(input),
    /must implement getActionContext/,
  );
});

test("native Studio host validates every public owner independently", () => {
  const cases = [
    ["studioRuntime", { schema: STUDIO_RUNTIME_V2_PORT_SCHEMA }],
    ["memory", { schema: MEMORY_PORT_SCHEMA }],
    ["intelligence", { schema: INTELLIGENCE_PORT_SCHEMA }],
    ["localization", { schema: LOCALIZATION_SCHEMA }],
  ];
  for (const [field, invalid] of cases) {
    const input = validInput();
    input[field] = invalid;
    assert.throws(() => createNativeStudioHostComposition(input), TypeError, field);
  }
});
