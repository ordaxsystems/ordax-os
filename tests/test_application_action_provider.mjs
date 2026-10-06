import assert from "node:assert/strict";
import test from "node:test";

import {
  APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA,
  APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
  APPLICATION_ACTION_PROVIDER_SCHEMA,
  assertApplicationActionProvider,
  validateApplicationActionProviderInvocation,
  validateApplicationActionProviderResult,
} from "../system/contracts/application-action-provider.mjs";

function provider(overrides = {}) {
  return {
    schema: APPLICATION_ACTION_PROVIDER_SCHEMA,
    appId: "notes",
    adapterId: "notes-native",
    revision: "1",
    actions: [
      "notes.inspect-notes",
      "notes.create-note",
    ],
    async invoke() {
      return {
        schema: APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
        status: "succeeded",
        summary: "ok",
        output: null,
        artifactRefs: [],
      };
    },
    ...overrides,
  };
}

test("Application Action provider declares exact app/adapter/actions without carrying authority", () => {
  const value = provider();
  const normalized = assertApplicationActionProvider(value);
  assert.notEqual(normalized, value);
  assert.equal(Object.isFrozen(normalized), true);
  assert.equal(Object.isFrozen(normalized.actions), true);
  assert.equal(normalized.invoke, value.invoke);
  assert.deepEqual([...normalized.actions], [...value.actions]);

  value.actions.push("notes.update-note");
  assert.deepEqual([...normalized.actions], [
    "notes.inspect-notes",
    "notes.create-note",
  ]);
  assert.throws(
    () => assertApplicationActionProvider({
      ...value,
      grant() {},
    }),
    /fields are not canonical/,
  );
  assert.throws(
    () => assertApplicationActionProvider(provider({
      actions: ["studio.list-projects"],
    })),
    /namespaced to notes/,
  );
  assert.throws(
    () => assertApplicationActionProvider(provider({
      actions: ["notes.create-note", "notes.create-note"],
    })),
    /must be unique/,
  );
});

test("provider invocation contains semantic arguments but no raw authority or credentials", () => {
  const invocation = validateApplicationActionProviderInvocation({
    schema: APPLICATION_ACTION_PROVIDER_INVOCATION_SCHEMA,
    workItemId: "work-1",
    resourceRef: "application-action:prep-1",
    appId: "notes",
    actionId: "notes.create-note",
    arguments: {
      title: "Ideias",
      body: "Texto",
    },
  }, {
    appId: "notes",
    actionIds: provider().actions,
  });

  assert.deepEqual({ ...invocation.arguments }, {
    title: "Ideias",
    body: "Texto",
  });
  assert.equal(invocation.resourceRef, "application-action:prep-1");

  for (const key of [
    "command",
    "token",
    "session-token",
    "password",
    "secret",
    "api-key",
    "access-token",
    "refresh-token",
    "client-secret",
    "authorization",
    "cookie",
    "credential",
    "grant-ref",
    "approval-id",
  ]) {
    assert.throws(
      () => validateApplicationActionProviderInvocation({
        ...invocation,
        arguments: { [key]: "secret" },
      }),
      /raw authority or credentials/,
      `provider invocation must reject sensitive argument ${key}`,
    );
  }
  assert.throws(
    () => validateApplicationActionProviderInvocation({
      ...invocation,
      actionId: "notes.trash-note",
    }, {
      appId: "notes",
      actionIds: provider().actions,
    }),
    /not declared by provider/,
  );
  assert.throws(
    () => validateApplicationActionProviderInvocation({
      ...invocation,
      resourceRef: "/tmp/raw-path",
    }),
    /resource ref is invalid/,
  );
});

test("provider result allows bounded JSON output but rejects credential/authority fields", () => {
  const result = validateApplicationActionProviderResult({
    schema: APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
    status: "succeeded",
    summary: "2 notas encontradas",
    output: {
      notes: [
        { id: "note-1", title: "A" },
        { id: "note-2", title: "B" },
      ],
    },
    artifactRefs: [],
  });

  assert.equal(result.status, "succeeded");
  assert.equal(result.output.notes.length, 2);

  for (const key of ["token", "approvalId", "grantRef", "__proto__"]) {
    const output = Object.create(null);
    Object.defineProperty(output, key, {
      value: "secret",
      enumerable: true,
      configurable: true,
      writable: true,
    });
    assert.throws(
      () => validateApplicationActionProviderResult({
        schema: APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
        status: "succeeded",
        summary: "bad",
        output,
        artifactRefs: [],
      }),
      /cannot expose authority or credential field/,
    );
  }
});

test("failed provider result cannot expose output and artifact refs stay unique", () => {
  assert.throws(
    () => validateApplicationActionProviderResult({
      schema: APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
      status: "failed",
      summary: "falhou",
      output: { reason: "x" },
      artifactRefs: [],
    }),
    /must not expose output/,
  );

  assert.throws(
    () => validateApplicationActionProviderResult({
      schema: APPLICATION_ACTION_PROVIDER_RESULT_SCHEMA,
      status: "succeeded",
      summary: "ok",
      output: null,
      artifactRefs: ["artifact:1", "artifact:1"],
    }),
    /must be unique/,
  );
});
