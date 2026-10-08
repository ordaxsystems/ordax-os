import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_LIFECYCLE_DELEGATE_SCHEMA,
} from "../system/services/apps/store-lifecycle-request-service.mjs";
import {
  createNativeAppLifecycleDelegate,
} from "../system/adapters/native/app-lifecycle-delegate.mjs";

const COMMIT = "a".repeat(40);

function artifact(name, char) {
  return { name, sha256: char.repeat(64), size: 123 };
}

function plan(operation = "install") {
  return {
    schema: "ordax.app-lifecycle-plan/1",
    request: {
      schema: "ordax.app-lifecycle-request/1",
      requestId: `store:${operation}:notes:native-test`,
      appId: "notes",
      operation,
      source: "store",
      authority: "none",
    },
    catalogSequence: 9,
    catalogSha256: "f".repeat(64),
    catalogSourceCommit: COMMIT,
    candidate: operation === "remove" ? null : {
      appId: "notes",
      version: "0.4.3",
      sourceCommit: COMMIT,
      artifacts: {
        package: artifact("notes.zip", "b"),
        release: artifact("notes.release.json", "c"),
        compatibility: artifact("notes.compatibility.json", "d"),
        componentEnvelope: artifact("notes.runtime-component-envelope.json", "e"),
      },
    },
    authority: "none",
  };
}

function acceptedFor(value) {
  return {
    schema: "ordax.app-lifecycle-request-result/1",
    requestId: value.request.requestId,
    appId: value.request.appId,
    operation: value.request.operation,
    source: value.request.source,
    state: "accepted",
    reason: null,
    authority: "none",
  };
}

function response(payload, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    async json() {
      return payload;
    },
  };
}

test("Native lifecycle delegate exposes only platform lifecycle authority", async () => {
  const calls = [];
  const value = plan();
  const delegate = createNativeAppLifecycleDelegate({
    async fetch(url, options) {
      calls.push({ url, options });
      return response(acceptedFor(value));
    },
  });

  assert.equal(delegate.schema, APP_LIFECYCLE_DELEGATE_SCHEMA);
  assert.equal(delegate.authority, "platform-component-lifecycle");
  assert.equal(typeof delegate.executeLifecycle, "function");
  for (const forbidden of [
    "install", "update", "remove", "stage", "promote", "rollback",
    "setTrustAnchor", "selectVersion", "selectArtifact",
  ]) {
    assert.equal(delegate[forbidden], undefined);
  }

  const result = await delegate.executeLifecycle(value);
  assert.equal(result.state, "accepted");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "/__ordax/native/store-lifecycle");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.cache, "no-store");
  assert.equal(calls[0].options.credentials, "same-origin");
  assert.equal(calls[0].options.redirect, "error");
  assert.deepEqual(JSON.parse(calls[0].options.body), value);
});

test("Native lifecycle delegate validates plan before transport", async () => {
  let calls = 0;
  const delegate = createNativeAppLifecycleDelegate({
    async fetch() {
      calls += 1;
      return response({});
    },
  });
  const value = plan();
  value.authority = "platform-component-lifecycle";
  await assert.rejects(
    () => delegate.executeLifecycle(value),
    /must remain authority:none/,
  );
  assert.equal(calls, 0);
});

test("Native lifecycle delegate fails closed on HTTP or identity drift", async () => {
  const value = plan();
  for (const fetchImpl of [
    async () => response({}, { ok: false, status: 503 }),
    async () => response({
      ...acceptedFor(value),
      appId: "studio",
    }),
  ]) {
    const delegate = createNativeAppLifecycleDelegate({ fetch: fetchImpl });
    await assert.rejects(() => delegate.executeLifecycle(value));
  }
});

test("remove plan carries no remote candidate or artifact identity", async () => {
  const calls = [];
  const value = plan("remove");
  const delegate = createNativeAppLifecycleDelegate({
    async fetch(_url, options) {
      calls.push(JSON.parse(options.body));
      return response(acceptedFor(value));
    },
  });
  await delegate.executeLifecycle(value);
  assert.equal(calls[0].candidate, null);
});


test("accepted install requests platform-owned probation for supported components", async () => {
  const value = plan("install");
  const messages = [];
  const delegate = createNativeAppLifecycleDelegate({
    async fetch() {
      return response(acceptedFor(value));
    },
    webkit: {
      messageHandlers: {
        ordaxBrowser: {
          postMessage(message) {
            messages.push(JSON.parse(message));
          },
        },
      },
    },
  });

  const result = await delegate.executeLifecycle(value);
  assert.equal(result.state, "accepted");
  assert.deepEqual(messages, [{
    type: "component.probation.request",
    componentId: "notes",
  }]);
});

test("remove and unsupported apps never request probation", async () => {
  const unsupported = plan("install");
  unsupported.request = {
    ...unsupported.request,
    requestId: "store:install:studio:native-test",
    appId: "studio",
  };
  unsupported.candidate = {
    ...unsupported.candidate,
    appId: "studio",
    artifacts: {
      package: artifact("studio.zip", "b"),
      release: artifact("studio.release.json", "c"),
      compatibility: artifact("studio.compatibility.json", "d"),
      componentEnvelope: artifact("studio.runtime-component-envelope.json", "e"),
    },
  };

  for (const value of [plan("remove"), unsupported]) {
    const messages = [];
    const delegate = createNativeAppLifecycleDelegate({
      async fetch() {
        return response(acceptedFor(value));
      },
      webkit: {
        messageHandlers: {
          ordaxBrowser: {
            postMessage(message) {
              messages.push(JSON.parse(message));
            },
          },
        },
      },
    });
    const result = await delegate.executeLifecycle(value);
    assert.equal(result.state, "accepted");
    assert.deepEqual(messages, []);
  }
});

test("missing probation bridge never rewrites an accepted staged result", async () => {
  const value = plan("update");
  const delegate = createNativeAppLifecycleDelegate({
    async fetch() {
      return response(acceptedFor(value));
    },
  });

  const result = await delegate.executeLifecycle(value);
  assert.equal(result.state, "accepted");
  assert.equal(result.operation, "update");
});


test("rejected or identity-drifted lifecycle replies never dispatch probation", async () => {
  const value = plan("install");
  const messages = [];
  const windowRef = {
    webkit: {
      messageHandlers: {
        ordaxBrowser: {
          postMessage(message) { messages.push(message); },
        },
      },
    },
  };

  const denied = createNativeAppLifecycleDelegate({
    ...windowRef,
    async fetch() {
      return response({
        ...acceptedFor(value),
        state: "rejected",
        reason: "platform-policy-blocked",
      });
    },
  });
  const deniedResult = await denied.executeLifecycle(value);
  assert.equal(deniedResult.state, "rejected");
  assert.deepEqual(messages, []);

  const mismatched = createNativeAppLifecycleDelegate({
    ...windowRef,
    async fetch() {
      return response({ ...acceptedFor(value), appId: "studio" });
    },
  });
  await assert.rejects(() => mismatched.executeLifecycle(value), /identity mismatch/);
  assert.deepEqual(messages, []);
});

test("probation bridge exception cannot change a platform-accepted staging receipt", async () => {
  const value = plan("install");
  let warnings = 0;
  const originalWarn = console.warn;
  const delegate = createNativeAppLifecycleDelegate({
    async fetch() {
      return response(acceptedFor(value));
    },
    webkit: {
      messageHandlers: {
        ordaxBrowser: {
          postMessage() { throw new Error("bridge is temporarily unavailable"); },
        },
      },
    },
  });
  try {
    console.warn = () => { warnings += 1; };
    const result = await delegate.executeLifecycle(value);
    assert.deepEqual(result, acceptedFor(value));
    assert.equal(warnings, 1);
  } finally {
    console.warn = originalWarn;
  }
});
