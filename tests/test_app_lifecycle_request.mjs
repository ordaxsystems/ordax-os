import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
  APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
  APP_LIFECYCLE_REQUEST_SCHEMA,
  assertAppLifecycleRequestPort,
  validateAppLifecycleRequest,
  validateAppLifecycleRequestResult,
  validateAppLifecycleRequestResultForRequest,
} from "../system/contracts/app-lifecycle-request.mjs";

function request(operation, source = "store") {
  return {
    schema: APP_LIFECYCLE_REQUEST_SCHEMA,
    requestId: `${source}:${operation}:notes:1`,
    appId: "notes",
    operation,
    source,
    authority: "none",
  };
}

test("Store lifecycle requests are authority-free for install, update and remove", () => {
  for (const operation of ["install", "update", "remove"]) {
    const value = validateAppLifecycleRequest(request(operation));
    assert.equal(value.operation, operation);
    assert.equal(value.authority, "none");
  }
});

test("launcher can request install but cannot request update or remove", () => {
  assert.equal(validateAppLifecycleRequest(request("install", "launcher")).source, "launcher");
  assert.throws(() => validateAppLifecycleRequest(request("update", "launcher")), /install only/);
  assert.throws(() => validateAppLifecycleRequest(request("remove", "launcher")), /install only/);
});

test("lifecycle request cannot select artifact, version, permissions, trust or data deletion", () => {
  for (const extra of [
    { artifactUrl: "https://example.invalid/app.pkg" },
    { sha256: "a".repeat(64) },
    { version: "9.9.9" },
    { installPath: "/srv/ordax-system/apps/notes" },
    { permissions: ["filesystem.all"] },
    { signingKey: "secret" },
    { trustAnchor: "other" },
    { bypassTrust: true },
    { deleteUserData: true },
  ]) {
    assert.throws(
      () => validateAppLifecycleRequest({ ...request("install"), ...extra }),
      /fields are not canonical/,
    );
  }
});

test("lifecycle request rejects malformed identity, operation, source or authority", () => {
  assert.throws(() => validateAppLifecycleRequest({ ...request("install"), appId: "../notes" }), /invalid appId/);
  assert.throws(() => validateAppLifecycleRequest({ ...request("install"), requestId: " bad " }), /invalid requestId/);
  assert.throws(() => validateAppLifecycleRequest({ ...request("install"), operation: "repair" }), /invalid operation/);
  assert.throws(() => validateAppLifecycleRequest({ ...request("install"), source: "remote-admin" }), /invalid source/);
  assert.throws(() => validateAppLifecycleRequest({ ...request("install"), authority: "install" }), /authority:none/);
});

test("request port exposes request only, never component lifecycle authority", () => {
  const port = assertAppLifecycleRequestPort({
    schema: APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
    authority: "none",
    requestLifecycle() {},
  });
  assert.equal(typeof port.requestLifecycle, "function");

  for (const forbidden of ["install", "update", "remove", "uninstall", "stage", "promote", "rollback", "deleteData"]) {
    assert.equal(forbidden in port, false);
  }

  assert.throws(
    () => assertAppLifecycleRequestPort({
      schema: APP_LIFECYCLE_REQUEST_PORT_SCHEMA,
      authority: "none",
      requestLifecycle() {},
      rollback() {},
    }),
    /fields are not canonical|must not expose lifecycle authority/,
  );
});

test("lifecycle request result is bound to operation, source and request identity", () => {
  const accepted = validateAppLifecycleRequestResult({
    schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
    requestId: "store:update:notes:7",
    appId: "notes",
    operation: "update",
    source: "store",
    state: "accepted",
    reason: null,
    authority: "none",
  });
  assert.equal(accepted.operation, "update");
  assert.equal(accepted.source, "store");

  assert.throws(
    () => validateAppLifecycleRequestResult({ ...accepted, authority: "install" }),
    /authority:none/,
  );
  assert.throws(
    () => validateAppLifecycleRequestResult({ ...accepted, state: "rejected", reason: null }),
    /requires reason/,
  );
});


test("lifecycle result correlation fails closed on stale or mismatched responses", () => {
  const original = request("update");
  const accepted = {
    schema: APP_LIFECYCLE_REQUEST_RESULT_SCHEMA,
    requestId: original.requestId,
    appId: original.appId,
    operation: original.operation,
    source: original.source,
    state: "accepted",
    reason: null,
    authority: "none",
  };

  assert.equal(
    validateAppLifecycleRequestResultForRequest(accepted, original).requestId,
    original.requestId,
  );

  for (const mismatch of [
    { requestId: "store:update:notes:stale" },
    { appId: "studio" },
    { operation: "remove" },
    { source: "launcher", operation: "install" },
  ]) {
    assert.throws(
      () => validateAppLifecycleRequestResultForRequest({ ...accepted, ...mismatch }, original),
      /identity mismatch|install only/,
    );
  }
});
