import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_INSTALL_REQUEST_PORT_SCHEMA,
  APP_INSTALL_REQUEST_RESULT_SCHEMA,
  APP_INSTALL_REQUEST_SCHEMA,
  assertAppInstallRequestPort,
  validateAppInstallRequest,
  validateAppInstallRequestResult,
} from "../system/contracts/app-install-request.mjs";

test("Store install request is presentation-only and authority-free", () => {
  const request = validateAppInstallRequest({
    schema: APP_INSTALL_REQUEST_SCHEMA,
    requestId: "store:notes:0001",
    appId: "notes",
    source: "store",
    authority: "none",
  });
  assert.equal(request.appId, "notes");
  assert.equal(request.source, "store");
  assert.equal(request.authority, "none");
});

test("launcher may request install without gaining install authority", () => {
  const request = validateAppInstallRequest({
    schema: APP_INSTALL_REQUEST_SCHEMA,
    requestId: "launcher:assistant:1",
    appId: "assistant",
    source: "launcher",
    authority: "none",
  });
  assert.equal(request.source, "launcher");
});

test("request cannot carry artifact, trust, permission or bypass fields", () => {
  for (const extra of [
    { artifactUrl: "https://example.invalid/app.pkg" },
    { sha256: "a".repeat(64) },
    { installPath: "/srv/ordax-system/apps/notes" },
    { permissions: ["filesystem.all"] },
    { signingKey: "secret" },
    { bypassTrust: true },
    { version: "9.9.9" },
  ]) {
    assert.throws(
      () => validateAppInstallRequest({
        schema: APP_INSTALL_REQUEST_SCHEMA,
        requestId: "store:notes:0002",
        appId: "notes",
        source: "store",
        authority: "none",
        ...extra,
      }),
      /fields are not canonical/,
    );
  }
});

test("request fails closed on malformed identity, source or authority", () => {
  const base = {
    schema: APP_INSTALL_REQUEST_SCHEMA,
    requestId: "store:notes:0003",
    appId: "notes",
    source: "store",
    authority: "none",
  };
  assert.throws(() => validateAppInstallRequest({ ...base, appId: "../notes" }), /invalid appId/);
  assert.throws(() => validateAppInstallRequest({ ...base, requestId: " bad " }), /invalid requestId/);
  assert.throws(() => validateAppInstallRequest({ ...base, source: "remote-admin" }), /invalid source/);
  assert.throws(() => validateAppInstallRequest({ ...base, authority: "install" }), /authority:none/);
});

test("install request port exposes request only, not lifecycle authority", () => {
  const port = assertAppInstallRequestPort({
    schema: APP_INSTALL_REQUEST_PORT_SCHEMA,
    authority: "none",
    requestInstall() {},
  });
  assert.equal(typeof port.requestInstall, "function");
  assert.equal(port.authority, "none");
  assert.equal("stage" in port, false);
  assert.equal("promote" in port, false);
  assert.equal("rollback" in port, false);
  assert.equal("installArtifact" in port, false);
  assert.equal("publish" in port, false);

  assert.throws(
    () => assertAppInstallRequestPort({
      schema: APP_INSTALL_REQUEST_PORT_SCHEMA,
      authority: "none",
      requestInstall() {},
      promote() {},
    }),
    /fields are not canonical|must not expose lifecycle authority/,
  );
});

test("install request receipt preserves request identity and remains authority-free", () => {
  const accepted = validateAppInstallRequestResult({
    schema: APP_INSTALL_REQUEST_RESULT_SCHEMA,
    requestId: "store:notes:7",
    appId: "notes",
    state: "accepted",
    reason: null,
    authority: "none",
  });
  assert.equal(accepted.requestId, "store:notes:7");
  assert.equal(accepted.authority, "none");

  assert.throws(
    () => validateAppInstallRequestResult({
      ...accepted,
      authority: "install",
    }),
    /authority:none/,
  );
  assert.throws(
    () => validateAppInstallRequestResult({
      ...accepted,
      state: "rejected",
      reason: null,
    }),
    /requires reason/,
  );
});

test("install request port rejects any extra enumerable surface", () => {
  assert.throws(
    () => assertAppInstallRequestPort({
      schema: APP_INSTALL_REQUEST_PORT_SCHEMA,
      authority: "none",
      requestInstall() {},
      metadata: {},
    }),
    /fields are not canonical/,
  );
});
