import assert from "node:assert/strict";
import test from "node:test";

import {
  APP_ARTIFACT_ACQUISITION_SOURCE_SCHEMA,
  assertAppArtifactAcquisitionSource,
  createUnavailableAppArtifactAcquisitionSource,
} from "../system/contracts/app-artifact-acquisition-source.mjs";
import {
  validateAppArtifactIdentity,
} from "../system/contracts/app-artifact-identity.mjs";

const IDENTITY = Object.freeze({
  name: "notes.zip",
  sha256: "a".repeat(64),
  size: 123,
});

test("artifact acquisition identity contains content identity only", () => {
  assert.deepEqual(validateAppArtifactIdentity(IDENTITY), IDENTITY);
  for (const smuggled of [
    { ...IDENTITY, url: "https://example.invalid/notes.zip" },
    { ...IDENTITY, version: "0.4.3" },
    { ...IDENTITY, appId: "notes" },
    { ...IDENTITY, trustAnchor: "other-key" },
  ]) {
    assert.throws(() => validateAppArtifactIdentity(smuggled), /fields are not canonical/);
  }
});

test("artifact acquisition source owns byte transport only, never lifecycle authority", () => {
  const source = {
    schema: APP_ARTIFACT_ACQUISITION_SOURCE_SCHEMA,
    authority: "content-fetch-only",
    transport: "https",
    async load(identity) {
      validateAppArtifactIdentity(identity);
      return new Uint8Array(identity.size);
    },
  };
  assert.equal(assertAppArtifactAcquisitionSource(source), source);
  for (const forbidden of [
    "install", "update", "remove", "stage", "promote", "rollback",
    "selectVersion", "selectArtifact", "grant", "authorize",
  ]) {
    assert.equal(source[forbidden], undefined);
  }
});

test("unconfigured acquisition source fails closed after validating identity", async () => {
  const source = createUnavailableAppArtifactAcquisitionSource();
  assert.equal(source.schema, APP_ARTIFACT_ACQUISITION_SOURCE_SCHEMA);
  assert.equal(source.authority, "content-fetch-only");
  assert.equal(source.transport, "unconfigured");
  await assert.rejects(() => source.load(IDENTITY), /transport is unconfigured/);
  await assert.rejects(
    () => source.load({ ...IDENTITY, url: "https://example.invalid" }),
    TypeError,
  );
});


test("artifact identity rejects payloads larger than the runtime verifier ceiling", () => {
  assert.throws(
    () => validateAppArtifactIdentity({
      ...IDENTITY,
      size: (32 * 1024 * 1024) + 1,
    }),
    /identity is invalid/,
  );
});
