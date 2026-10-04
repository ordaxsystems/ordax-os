import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDIO_ACTION_CATALOG,
  STUDIO_ACTION_CATALOG_SCHEMA,
  studioActionBinding,
  validateStudioActionBinding,
  validateStudioActionCatalog,
  validateStudioActionCatalogRequest,
} from "../system/contracts/studio-action-catalog.mjs";
import { DEVICE_ACTION_REQUEST_SCHEMA } from "../system/contracts/device-action-envelope.mjs";

function request(overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_SCHEMA,
    actionId: "studio-action-1",
    idempotencyKey: "studio-action-1",
    accountId: "account-1",
    spaceId: "space-1",
    projectId: "project-1",
    deviceId: "device-1",
    client: "ordax-desktop",
    capability: "files.read",
    operation: "text.read",
    parameters: { path: "/Projects/demo/README.md" },
    requestedAt: 100,
    expiresAt: 200,
    expectedDeviceRevision: null,
    ...overrides,
  };
}

test("Studio action catalog is descriptive and authority-free", () => {
  const catalog = validateStudioActionCatalog(STUDIO_ACTION_CATALOG);
  assert.equal(catalog.schema, STUDIO_ACTION_CATALOG_SCHEMA);
  assert.equal(catalog.authority, "none");
  assert.equal(catalog.entries.length, 14);

  for (const entry of catalog.entries) {
    for (const forbidden of ["execute", "localAction", "deviceAgent", "grant", "authorization", "provider"] ) {
      assert.equal(Object.hasOwn(entry, forbidden), false, `${entry.capability}/${entry.operation} leaked ${forbidden}`);
    }
    if (entry.mode === "write") assert.notEqual(entry.confirmation, "none");
  }
});

test("catalog keeps capability and operation as distinct semantics", () => {
  const binding = studioActionBinding("files.read", "text.read");
  assert.ok(binding);
  assert.equal(binding.capability, "files.read");
  assert.equal(binding.operation, "text.read");
  assert.equal(binding.mode, "read");
  assert.equal(studioActionBinding("files.read", "text.write"), null);
});

test("catalog validates request binding and bounded parameters before dispatch", () => {
  const valid = validateStudioActionCatalogRequest(request());
  assert.equal(valid.binding.capability, "files.read");
  assert.equal(valid.binding.operation, "text.read");

  assert.throws(
    () => validateStudioActionCatalogRequest(request({ operation: "unknown.read" })),
    /not in the Studio action catalog/,
  );
  assert.throws(
    () => validateStudioActionCatalogRequest(request({ parameters: { path: "README.md", raw: true } })),
    /unsupported Studio parameter/,
  );
  assert.throws(
    () => validateStudioActionCatalogRequest(request({ parameters: {} })),
    /missing required Studio parameter/,
  );
});

test("write bindings cannot silently avoid approval policy", () => {
  assert.throws(
    () => validateStudioActionBinding({
      capability: "files.write",
      operation: "text.write",
      mode: "write",
      scope: "project",
      confirmation: "none",
      parameters: [],
    }),
    /require policy or explicit confirmation/,
  );

  const write = studioActionBinding("files.write", "text.write");
  assert.equal(write.mode, "write");
  assert.equal(write.confirmation, "policy-gated");
});
