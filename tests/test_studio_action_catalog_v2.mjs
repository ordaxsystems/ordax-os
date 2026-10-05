import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import { DEVICE_ACTION_REQUEST_V2_SCHEMA } from "../system/contracts/device-action-envelope-v2.mjs";
import {
  STUDIO_ACTION_CATALOG_V2,
  STUDIO_ACTION_CATALOG_V2_SCHEMA,
  STUDIO_ACTION_CATALOG_V2_SOURCE,
  studioActionCatalogV2Entry,
  validateStudioActionCatalogV2,
  validateStudioActionCatalogV2Request,
} from "../system/contracts/studio-action-catalog-v2.mjs";

function request(overrides = {}) {
  return {
    schema: DEVICE_ACTION_REQUEST_V2_SCHEMA,
    actionId: "action-1",
    idempotencyKey: "idem-1",
    actor: { kind: "device-owner", subjectId: null },
    spaceId: null,
    projectId: "project-1",
    deviceId: "device-1",
    client: "ordax-desktop",
    capability: "project.text_read",
    parameters: { path: "README.md" },
    requestedAt: 100,
    expiresAt: 200,
    expectedDeviceRevision: null,
    ...overrides,
  };
}

test("catalog v2 is authority-free, unique and capability-only", () => {
  const catalog = validateStudioActionCatalogV2(STUDIO_ACTION_CATALOG_V2);
  assert.equal(catalog.schema, STUDIO_ACTION_CATALOG_V2_SCHEMA);
  assert.equal(catalog.authority, "none");
  assert.equal(new Set(catalog.entries.map(({ capability }) => capability)).size, catalog.entries.length);
  for (const entry of catalog.entries) {
    assert.equal(Object.hasOwn(entry, "operation"), false);
    assert.equal(Object.hasOwn(entry, "localAction"), false);
    assert.equal(Object.hasOwn(entry, "grant"), false);
    assert.equal(Object.hasOwn(entry, "authorization"), false);
    assert.equal(entry.parameters.includes("project"), false);
  }
});

test("catalog provenance matches the pinned Studio runtime source lock", () => {
  const lock = JSON.parse(fs.readFileSync(
    new URL("../system/services/device-agent/studio-runtime-source-lock.json", import.meta.url),
    "utf8",
  ));
  assert.equal(lock.source.repository, `https://github.com/${STUDIO_ACTION_CATALOG_V2_SOURCE.repository}`);
  assert.equal(lock.source.commit, STUDIO_ACTION_CATALOG_V2_SOURCE.commit);
  assert.equal(lock.source.compatibility_contract.product_version, STUDIO_ACTION_CATALOG_V2_SOURCE.productVersion);
  assert.equal(STUDIO_ACTION_CATALOG_V2_SOURCE.path, "ordax_dev_agent/product_gateway.py");
});

test("project action uses top-level projectId and allows only catalog parameters", () => {
  const validated = validateStudioActionCatalogV2Request(request());
  assert.equal(validated.entry.capability, "project.text_read");
  assert.equal(validated.entry.scope, "project");

  assert.throws(
    () => validateStudioActionCatalogV2Request(request({ projectId: null })),
    /requires top-level projectId/,
  );
  assert.throws(
    () => validateStudioActionCatalogV2Request(request({ parameters: { path: "README.md", project: "other" } })),
    /project scope must come from top-level projectId/,
  );
  assert.throws(
    () => validateStudioActionCatalogV2Request(request({ parameters: { path: "README.md", shell: "cmd" } })),
    /unsupported Studio parameter/,
  );
});

test("device action cannot smuggle a project scope", () => {
  const deviceRequest = request({
    capability: "projects.list",
    projectId: null,
    parameters: {},
  });
  assert.equal(validateStudioActionCatalogV2Request(deviceRequest).entry.scope, "device");
  assert.throws(
    () => validateStudioActionCatalogV2Request({ ...deviceRequest, projectId: "project-1" }),
    /must not carry projectId/,
  );
});

test("unknown capabilities fail closed and write mode is explicit data only", () => {
  assert.throws(
    () => validateStudioActionCatalogV2Request(request({ capability: "project.raw_execute" })),
    /not in the Studio action catalog v2/,
  );
  const write = studioActionCatalogV2Entry("project.text_write");
  assert.equal(write.mode, "write");
  assert.equal(write.scope, "project");
  assert.deepEqual(write.parameters, ["content", "create", "expected_sha256", "path"]);
});

test("catalog validation rejects old capability-plus-operation shape", () => {
  const entry = STUDIO_ACTION_CATALOG_V2.entries[0];
  assert.throws(
    () => validateStudioActionCatalogV2({
      ...STUDIO_ACTION_CATALOG_V2,
      entries: [{ ...entry, operation: "list" }],
    }),
    /fields are incompatible/,
  );
});
